from slowapi import Limiter
from starlette.requests import Request


def get_client_ip(request: Request) -> str:
    # X-Real-IP is set by nginx to $remote_addr — cannot be spoofed by the client
    # because nginx overwrites it, not appends to it.
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    # X-Forwarded-For is a comma-separated list; take the last entry, which is
    # the IP added by your own trusted proxy (not client-controlled).
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[-1].strip()
    return request.client.host


limiter = Limiter(key_func=get_client_ip)
