import requests

TVMAZE_BASE = "https://api.tvmaze.com"


def fetch_show_air_time(show_name: str) -> tuple[str | None, str | None]:
    """
    Look up a show on TVmaze by name.
    Returns (air_time, air_timezone) where air_time is "HH:MM" (24h) and
    air_timezone is an IANA timezone string (e.g. "America/New_York").
    Returns (None, None) on no match or error.
    """
    try:
        resp = requests.get(
            f"{TVMAZE_BASE}/search/shows",
            params={"q": show_name},
            timeout=5,
        )
        if not resp.ok:
            return None, None
        results = resp.json()
        if not results:
            return None, None
        show = results[0]["show"]
        air_time = show.get("schedule", {}).get("time") or None
        network = show.get("network") or {}
        web = show.get("webChannel") or {}
        country = network.get("country") or web.get("country") or {}
        air_timezone = country.get("timezone") or None
        return air_time, air_timezone
    except Exception:
        return None, None
