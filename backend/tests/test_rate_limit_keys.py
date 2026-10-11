"""Who a request is counted against for rate limiting.

Forwarded-for headers are only believed when the request came from our own
proxy; anyone else could put any address there and get a fresh budget per
request. Signed-in requests are counted per user, so people sharing an IP
(mobile carrier NAT, offices) don't use up each other's limits.
"""

from types import SimpleNamespace
from unittest.mock import patch

from starlette.requests import Request

from app.core.limiter import get_rate_limit_key
from app.dependencies.auth import get_token_claims


def _request(client_ip: str, headers: dict | None = None) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (client_ip, 50000),
        "query_string": b"",
    }
    return Request(scope)


class TestClientAddress:
    def test_spoofed_header_from_a_direct_client_is_ignored(self):
        req = _request("203.0.113.5", {"X-Real-IP": "1.2.3.4", "X-Forwarded-For": "5.6.7.8"})
        assert get_rate_limit_key(req) == "ip:203.0.113.5"

    def test_real_ip_header_from_local_proxy_is_used(self):
        req = _request("127.0.0.1", {"X-Real-IP": "198.51.100.7"})
        assert get_rate_limit_key(req) == "ip:198.51.100.7"

    def test_forwarded_for_from_private_network_proxy_uses_last_hop(self):
        # The last entry is the one our proxy appended; earlier ones are
        # whatever the client sent.
        req = _request("10.0.3.9", {"X-Forwarded-For": "1.1.1.1, 198.51.100.8"})
        assert get_rate_limit_key(req) == "ip:198.51.100.8"


class TestSignedInRequests:
    def test_signed_in_request_is_keyed_by_user(self):
        req = _request("203.0.113.5")
        req.state.uid = "user-abc"
        assert get_rate_limit_key(req) == "user:user-abc"

    def test_auth_dependency_records_the_uid(self, db):
        req = _request("203.0.113.5")
        creds = SimpleNamespace(credentials="token")
        with patch("app.dependencies.auth.verify_token",
                   return_value={"uid": "test-uid-1", "email": ""}):
            get_token_claims(req, creds, db)
        assert req.state.uid == "test-uid-1"
