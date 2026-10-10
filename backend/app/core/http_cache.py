"""Cache-Control for public GET routes whose response is the same for everyone
(title details, search, trending lists...). Browsers and the iOS app reuse a
response for max-age; a CDN in front of the API can share it for s-maxage.

`public` is load-bearing: the frontend sends its Firebase token on every
request, and a shared cache won't reuse a response to a request that carried
Authorization unless the response is marked public. So only use these on
routes that never look at who is asking (tests/test_http_cache.py enforces
that no login-protected route uses them).

Error responses (HTTPException) are built fresh and don't carry the header,
so a 404 is never cached.
"""

from fastapi import Depends, Response

# Title, person, season and collection details.
DETAIL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
# Search results and trending / popular / upcoming lists.
LIST = "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600"
# Reference data that rarely changes (genre and provider lists).
STATIC = "public, max-age=86400, s-maxage=86400"


def _cache_control(policy: str):
    def set_cache_control(response: Response) -> None:
        response.headers["Cache-Control"] = policy

    set_cache_control.cache_control_policy = policy
    return set_cache_control


def public_cache_policy(call) -> str | None:
    """The Cache-Control policy a route dependency sets, if it is one of these."""
    return getattr(call, "cache_control_policy", None)


DETAIL_CACHE = Depends(_cache_control(DETAIL))
LIST_CACHE = Depends(_cache_control(LIST))
STATIC_CACHE = Depends(_cache_control(STATIC))
