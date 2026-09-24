from functools import lru_cache
import httpx
from app.config import settings


@lru_cache(maxsize=2048)
def get_omdb_scores(imdb_id: str) -> dict:
    """
    Fetch ratings from OMDB (Rotten Tomatoes, Metacritic, IMDb score).
    Returns an empty dict if OMDB_API_KEY is not set or the request fails.
    """
    api_key = getattr(settings, "OMDB_API_KEY", None)
    if not api_key or not imdb_id:
        return {}
    try:
        r = httpx.get(
            f"{settings.OMDB_BASE_URL}/",
            params={"i": imdb_id, "apikey": api_key},
            timeout=5,
        )
        if not r.is_success:
            return {}
        data = r.json()
        if data.get("Response") != "True":
            return {}
        scores = {}
        for rating in data.get("Ratings", []):
            source = rating.get("Source", "")
            value = rating.get("Value", "")
            if source == "Internet Movie Database":
                scores["imdb"] = value  # e.g. "8.5/10"
            elif source == "Rotten Tomatoes":
                scores["rotten_tomatoes"] = value  # e.g. "94%"
            elif source == "Metacritic":
                scores["metacritic"] = value  # e.g. "88/100"
        return scores
    except Exception:
        return {}
