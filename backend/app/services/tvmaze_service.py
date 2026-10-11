import requests

from app.config import settings

TVMAZE_BASE = settings.TVMAZE_BASE_URL


def _get(path: str, params: dict):
    resp = requests.get(f"{TVMAZE_BASE}{path}", params=params, timeout=5)
    return resp.json() if resp.ok else None


def _schedule(show: dict) -> tuple[str | None, str | None]:
    air_time = (show.get("schedule") or {}).get("time") or None
    network = show.get("network") or {}
    web = show.get("webChannel") or {}
    country = network.get("country") or web.get("country") or {}
    return air_time, country.get("timezone") or None


def fetch_show_air_time(show: dict) -> tuple[str | None, str | None]:
    """
    Find a TMDb show on TVmaze and return (air_time, air_timezone), where
    air_time is "HH:MM" (24h) and air_timezone an IANA name.

    Matched by TVDB id, then IMDb id (from TMDb's external_ids). A bare name
    search returns the most popular show with that name — often a different
    one — so the fallback only accepts an exact name and premiere-year match.
    Returns (None, None) when nothing matches.
    """
    try:
        ids = show.get("external_ids") or {}
        for param, value in (("thetvdb", ids.get("tvdb_id")), ("imdb", ids.get("imdb_id"))):
            if value:
                match = _get("/lookup/shows", {param: value})
                if match:
                    return _schedule(match)

        name = show.get("name") or ""
        year = (show.get("first_air_date") or "")[:4]
        for result in _get("/search/shows", {"q": name}) or []:
            candidate = result.get("show") or {}
            if (
                (candidate.get("name") or "").casefold() == name.casefold()
                and (candidate.get("premiered") or "")[:4] == year
            ):
                return _schedule(candidate)
        return None, None
    except Exception:
        return None, None
