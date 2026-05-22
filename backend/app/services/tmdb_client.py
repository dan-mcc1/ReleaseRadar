import threading
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from app.config import settings

BASE_URL = "https://api.themoviedb.org/3"

HEADERS = {
    "Authorization": f"Bearer {settings.TMDB_BEARER_TOKEN}",
    "Accept": "application/json",
}

# Retry on transient network errors, 5xx responses, and 429 rate-limit responses.
# For 429, urllib3 reads the Retry-After header and sleeps that many seconds before
# retrying, so the ThreadPoolExecutor burst in the nightly refresh loop is self-healing.
# Backoff applies when no Retry-After header is present: 0s, 2s, 4s between attempts.
_retry = Retry(
    total=5,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"],
    raise_on_status=False,
    respect_retry_after_header=True,
)

_local = threading.local()


def _session() -> requests.Session:
    s = getattr(_local, "session", None)
    if s is None:
        s = requests.Session()
        # Redirects disabled so the Authorization header can't leak to a
        # third-party host via a MITM or unexpected TMDb redirect.
        s.max_redirects = 0
        s.mount("https://", HTTPAdapter(max_retries=_retry))
        _local.session = s
    return s


def get(path: str, params: dict | None = None):
    res = _session().get(
        f"{BASE_URL}{path}",
        headers=HEADERS,
        params=params or {},
        timeout=10,
        allow_redirects=False,
    )
    res.raise_for_status()
    return res.json()
