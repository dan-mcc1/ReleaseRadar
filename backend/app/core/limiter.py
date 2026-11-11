import ipaddress
import math
import time

from fastapi import Depends, HTTPException
from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import FixedWindowRateLimiter
from slowapi import Limiter
from starlette.requests import Request

from app.config import settings
from app.dependencies.auth import get_current_user

_TRUSTED_PROXIES = [
    ipaddress.ip_network(cidr.strip(), strict=False)
    for cidr in settings.TRUSTED_PROXY_CIDRS
    if cidr.strip()
]


def _is_trusted_proxy(host: str | None) -> bool:
    try:
        addr = ipaddress.ip_address(host or "")
    except ValueError:
        return False
    return any(addr in net for net in _TRUSTED_PROXIES)


def get_client_ip(request: Request) -> str:
    """The client's address. X-Real-IP / X-Forwarded-For are only believed
    when the request arrived from our own proxy (TRUSTED_PROXY_CIDRS);
    a client talking to the API directly could put anything in them."""
    peer = request.client.host if request.client else ""
    if _is_trusted_proxy(peer):
        # nginx sets X-Real-IP to $remote_addr (overwritten, not appended).
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
        # The last X-Forwarded-For entry is the one our proxy appended.
        xff = request.headers.get("X-Forwarded-For")
        if xff:
            return xff.split(",")[-1].strip()
    return peer


def get_rate_limit_key(request: Request) -> str:
    """Signed-in requests count against the user (the auth dependency records
    request.state.uid), so people sharing an IP don't share a budget."""
    uid = getattr(request.state, "uid", None)
    if uid:
        return f"user:{uid}"
    return f"ip:{get_client_ip(request)}"


limiter = Limiter(key_func=get_rate_limit_key)


# Budgets for unauthenticated, TMDb-backed routes. Separate from slowapi's
# per-route decorators so a whole router can share one budget per client.
_public_storage = MemoryStorage()
_public_window = FixedWindowRateLimiter(_public_storage)


def _enforce(scope: str, setting: str, key: str) -> None:
    item = parse(getattr(settings, setting))
    if _public_window.hit(item, scope, key):
        return
    reset_at, _ = _public_window.get_window_stats(item, scope, key)
    retry_after = max(1, math.ceil(reset_at - time.time()))
    raise HTTPException(
        status_code=429,
        detail="Too many requests. Please slow down.",
        headers={"Retry-After": str(retry_after)},
    )


def rate_limit(scope: str, setting: str):
    """Router/route dependency enforcing settings.<setting> (e.g. "300/minute")
    per client within `scope`. Follows limiter.enabled, like slowapi."""

    def check_rate_limit(request: Request) -> None:
        if limiter.enabled:
            _enforce(scope, setting, get_rate_limit_key(request))

    check_rate_limit.rate_limit_scope = scope
    return check_rate_limit


def user_rate_limit(scope: str, setting: str):
    """Like rate_limit, but counted per signed-in user (never per IP) and
    shared by every route that depends on it. It depends on the auth
    dependency, so the user is known before the budget is checked."""

    def check_user_rate_limit(uid: str = Depends(get_current_user)) -> None:
        if limiter.enabled:
            _enforce(scope, setting, f"user:{uid}")

    check_user_rate_limit.rate_limit_scope = scope
    check_user_rate_limit.rate_limit_per_user = True
    return check_user_rate_limit


# One budget for everything that adds a title or marks something watched,
# since each can make us fetch it from TMDb and insert rows for it.
track_budget = user_rate_limit("track", "TRACK_RATE_LIMIT")
