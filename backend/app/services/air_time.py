"""
When an episode airs, as a UTC instant. Shows store the network's local clock
time ("21:00") and its IANA zone, both from TVmaze. Every place that turns
those into an instant (iCal, episode alerts) goes through here so they agree.
"""
from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# TVmaze leaves the zone blank for some web channels; most of what we track is
# US, so assume Eastern rather than UTC (which would put a 9 PM show at 5 PM).
DEFAULT_AIR_TIMEZONE = "America/New_York"


def parse_air_time(value: str | None) -> time | None:
    """ "HH:MM" or "HH:MM:SS" as a time; None when blank or malformed."""
    if not value:
        return None
    parts = value.split(":")
    try:
        hour = int(parts[0])
        minute = int(parts[1]) if len(parts) > 1 else 0
        return time(hour=hour, minute=minute)
    except (ValueError, IndexError):
        return None


def air_zone(air_timezone: str | None) -> ZoneInfo:
    """The show's zone, or DEFAULT_AIR_TIMEZONE when it's blank or unknown."""
    try:
        return ZoneInfo(air_timezone or DEFAULT_AIR_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_AIR_TIMEZONE)


def air_datetime_utc(
    air_time: str | None, air_timezone: str | None, air_date: date
) -> datetime | None:
    """The UTC instant an episode on air_date airs, or None with no air time."""
    t = parse_air_time(air_time)
    if t is None:
        return None
    local = datetime.combine(air_date, t, tzinfo=air_zone(air_timezone))
    return local.astimezone(timezone.utc)
