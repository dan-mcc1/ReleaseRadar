"""Keeping a show's Season rows to one per season number."""
from sqlalchemy.orm import Session

from app.models.season import Season


def drop_superseded_seasons(db: Session, show_id: int, tmdb_seasons: list[dict]) -> set[int]:
    """
    Delete the show's stored Season rows that TMDb now lists under a different
    id for the same season number, and return their ids.

    Season rows are keyed by TMDb's season id, and TMDb sometimes deletes and
    recreates a season (a placeholder for an upcoming one especially) under a
    new id. Without this the show keeps a row for each, and everything that
    walks its seasons walks that one twice. Seasons TMDb doesn't list are left
    alone. Nothing references Season.id, so deleting a row loses only cached
    metadata the caller re-adds from TMDb. Flushes; the caller commits.
    """
    current_ids = {
        s["season_number"]: s["id"]
        for s in tmdb_seasons
        if s.get("id") and s.get("season_number") is not None
    }
    if not current_ids:
        return set()
    stale = [
        season
        for season in db.query(Season).filter(
            Season.show_id == show_id, Season.season_number.in_(list(current_ids))
        )
        if season.id != current_ids[season.season_number]
    ]
    stale_ids = {season.id for season in stale}
    for season in stale:
        db.delete(season)
    if stale:
        db.flush()
    return stale_ids
