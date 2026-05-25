import time
import httpx
from app.config import settings

_cache: dict[str, tuple[float, dict]] = {}
# Bump to invalidate cached responses after a query change.
_cache_version = 3
CACHE_TTL = 3600  # 1 hour — conserves the 100 req/day free tier limit

NEWSAPI_BASE = "https://newsapi.org/v2"

# Entertainment trade press + reputable film/TV outlets. NewsAPI accepts up to
# 20 comma-separated domains; restricting to this set is the single biggest
# precision win — it cuts almost all sports/politics/gossip noise on its own.
_ENTERTAINMENT_DOMAINS = ",".join(
    [
        "variety.com",
        "hollywoodreporter.com",
        "deadline.com",
        "indiewire.com",
        "collider.com",
        "ew.com",
        "thewrap.com",
        "screenrant.com",
        "vulture.com",
        "avclub.com",
        "slashfilm.com",
        "empireonline.com",
        "rogerebert.com",
        "comingsoon.net",
        "comicbook.com",
    ]
)

# Belt-and-suspenders: even if a whitelisted outlet runs a sports/gaming piece,
# drop the most common sports + gambling outlets explicitly. Used by the
# fall-through search endpoint where we can't apply a positive whitelist.
_EXCLUDE_DOMAINS = ",".join(
    [
        "espn.com",
        "bleacherreport.com",
        "sbnation.com",
        "cbssports.com",
        "nbcsports.com",
        "foxsports.com",
        "si.com",
        "theathletic.com",
        "actionnetwork.com",
        "draftkings.com",
    ]
)


def _fetch(cache_key: str, endpoint: str, params: dict) -> dict:
    now = time.time()
    if cache_key in _cache:
        ts, data = _cache[cache_key]
        if now - ts < CACHE_TTL:
            return data

    api_key = settings.NEWS_API_KEY
    if not api_key:
        return {"articles": [], "totalResults": 0}

    try:
        r = httpx.get(
            f"{NEWSAPI_BASE}/{endpoint}",
            params={**params, "apiKey": api_key},
            timeout=10,
        )
        if not r.is_success:
            return {"articles": [], "totalResults": 0}
        data = r.json()
        if data.get("status") != "ok":
            return {"articles": [], "totalResults": 0}
        _cache[cache_key] = (now, data)
        return data
    except Exception:
        return {"articles": [], "totalResults": 0}


def get_entertainment_news(page: int = 1, page_size: int = 20) -> dict:
    # Drop top-headlines/category=entertainment — NewsAPI's entertainment bucket
    # is too loose (music, gossip, gaming, occasional sports). Pull from the
    # trade-press whitelist and let category-agnostic title terms match film+TV.
    return _fetch(
        f"entertainment:{page}:{page_size}:v{_cache_version}",
        "everything",
        {
            "domains": _ENTERTAINMENT_DOMAINS,
            "qInTitle": (
                "movie OR film OR series OR season OR trailer OR showrunner "
                "OR streaming OR Netflix OR HBO OR Hulu OR Disney OR Paramount"
            ),
            "language": "en",
            "sortBy": "publishedAt",
            "page": page,
            "pageSize": page_size,
        },
    )


def get_movie_news(page: int = 1, page_size: int = 20) -> dict:
    # qInTitle = headline-only matching. Avoids articles that just mention
    # "film" once in passing.
    return _fetch(
        f"movies:{page}:{page_size}:v{_cache_version}",
        "everything",
        {
            "domains": _ENTERTAINMENT_DOMAINS,
            "qInTitle": (
                "movie OR film OR \"box office\" OR sequel OR remake "
                "OR director OR Hollywood OR Pixar OR Marvel OR \"A24\""
            ),
            "language": "en",
            "sortBy": "publishedAt",
            "page": page,
            "pageSize": page_size,
        },
    )


def get_tv_news(page: int = 1, page_size: int = 20) -> dict:
    return _fetch(
        f"tv:{page}:{page_size}:v{_cache_version}",
        "everything",
        {
            "domains": _ENTERTAINMENT_DOMAINS,
            "qInTitle": (
                "series OR \"TV show\" OR season OR episode OR finale "
                "OR premiere OR showrunner OR renewed OR canceled OR cancelled "
                "OR Netflix OR HBO OR Hulu OR \"Apple TV\""
            ),
            "language": "en",
            "sortBy": "publishedAt",
            "page": page,
            "pageSize": page_size,
        },
    )


def search_news(query: str, page: int = 1, page_size: int = 20) -> dict:
    # User-driven — keep the term broad but drop the obvious sports/gambling
    # outlets so a search like "Knicks" doesn't bury legit show results.
    return _fetch(
        f"search:{query}:{page}:{page_size}:v{_cache_version}",
        "everything",
        {
            "qInTitle": query,
            "excludeDomains": _EXCLUDE_DOMAINS,
            "language": "en",
            "sortBy": "publishedAt",
            "page": page,
            "pageSize": page_size,
        },
    )
