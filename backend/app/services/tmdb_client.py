import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from app.config import settings

BASE_URL = "https://api.themoviedb.org/3"

HEADERS = {
    "Authorization": f"Bearer {settings.TMDB_BEARER_TOKEN}",
    "Accept": "application/json",
}

# Retry on transient network errors and 5xx responses (not 4xx — those are caller errors).
# Backoff: 0s, 1s, 2s between attempts (backoff_factor=1 → 0, 1*2^1, 1*2^2... capped at 3 tries).
_retry = Retry(
    total=3,
    backoff_factor=1,
    status_forcelist=[500, 502, 503, 504],
    allowed_methods=["GET"],
    raise_on_status=False,
)

# Session with redirects disabled so the Authorization header can't leak to a
# third-party host via a MITM or unexpected TMDb redirect.
_session = requests.Session()
_session.max_redirects = 0
_session.mount("https://", HTTPAdapter(max_retries=_retry))


def get(path: str, params: dict | None = None):
    res = _session.get(
        f"{BASE_URL}{path}",
        headers=HEADERS,
        params=params or {},
        timeout=10,
        allow_redirects=False,
    )
    res.raise_for_status()
    return res.json()
