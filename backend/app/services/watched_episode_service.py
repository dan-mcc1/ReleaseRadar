# app/services/episode_watched_service.py
from sqlalchemy.orm import Session
from datetime import datetime
from app.models.episode_watched import EpisodeWatched
from app.models.episode import Episode
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.services.episode_service import (
    get_or_create_episode,
    sync_season_episodes,
    ensure_show_in_db,
)
from app.services.watched_service import add_to_watched
from app.services.watchlist_service import remove_from_watchlist
from app.services.currently_watching_service import remove_from_currently_watching


def add_episode_watched(
    db: Session,
    user_id: str,
    show_id: int,
    season_number: int,
    episode_number: int,
    rating: float = None,
):
    """
    Mark an episode as watched.
    Ensures the episode row exists in the episode table (fetching from TMDB
    if needed) and links episode_watched to it via episode_id.
    After recording the episode, auto-moves the show to Watched if all episodes
    have now been seen.
    """
    existing = (
        db.query(EpisodeWatched)
        .filter_by(
            user_id=user_id,
            show_id=show_id,
            season_number=season_number,
            episode_number=episode_number,
        )
        .first()
    )
    if existing:
        return existing

    # Ensure the show and episode rows exist (satisfies FK constraints)
    ensure_show_in_db(db, show_id)
    episode = get_or_create_episode(db, show_id, season_number, episode_number)

    entry = EpisodeWatched(
        user_id=user_id,
        show_id=show_id,
        episode_id=episode.id if episode else None,
        season_number=season_number,
        episode_number=episode_number,
        watched_at=datetime.utcnow(),
        rating=rating,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)

    _maybe_auto_complete_show(db, user_id, show_id)

    return entry


def remove_episode_watched(
    db: Session,
    user_id: str,
    show_id: int,
    season_number: int,
    episode_number: int,
):
    """
    Remove an episode from watched list.
    """
    entry = (
        db.query(EpisodeWatched)
        .filter_by(
            user_id=user_id,
            show_id=show_id,
            season_number=season_number,
            episode_number=episode_number,
        )
        .first()
    )
    if entry:
        db.delete(entry)
        db.commit()
        return {"message": "Removed from watched episodes"}
    return {"message": "Episode not found in watched list"}


def get_watched_episodes(db: Session, user_id: str):
    """
    Get all watched episodes for a user.
    """
    items = db.query(EpisodeWatched).filter_by(user_id=user_id).all()
    return [
        {
            "show_id": item.show_id,
            "season_number": item.season_number,
            "episode_number": item.episode_number,
            "watched_at": item.watched_at.isoformat(),
            "rating": item.rating,
        }
        for item in items
    ]


def add_season_watched(db: Session, user_id: str, show_id: int, season_number: int):
    """
    Mark every episode in a season as watched (idempotent).
    Always syncs from TMDB first so that episodes watched individually before
    this call don't leave gaps in the episode table.
    """
    # Always sync — idempotent, skips rows that already exist.
    # This ensures we have the full episode list even if only some episodes
    # were previously watched (and therefore only partially in the episode table).
    sync_season_episodes(db, show_id, season_number)

    episodes = (
        db.query(Episode).filter_by(show_id=show_id, season_number=season_number).all()
    )
    already_watched = {
        ep_num
        for (ep_num,) in db.query(EpisodeWatched.episode_number).filter_by(
            user_id=user_id, show_id=show_id, season_number=season_number
        ).all()
    }
    for ep in episodes:
        if ep.episode_number not in already_watched:
            db.add(
                EpisodeWatched(
                    user_id=user_id,
                    show_id=show_id,
                    episode_id=ep.id,
                    season_number=season_number,
                    episode_number=ep.episode_number,
                    watched_at=datetime.utcnow(),
                )
            )
    db.commit()

    _maybe_auto_complete_show(db, user_id, show_id)

    return {"message": f"Season {season_number} marked as watched"}


def remove_season_watched(db: Session, user_id: str, show_id: int, season_number: int):
    """
    Remove all episode_watched entries for a season.
    """
    db.query(EpisodeWatched).filter_by(
        user_id=user_id,
        show_id=show_id,
        season_number=season_number,
    ).delete()
    db.commit()
    return {"message": f"Season {season_number} removed from watched"}


def get_next_unwatched_episode(db: Session, user_id: str, show_id: int) -> dict:
    """
    Return the next episode the user hasn't watched for a given show.
    Returns {"finished": True} if all known episodes are watched.
    Syncs the next un-synced season from TMDb if needed.
    """
    from app.models.show import Show
    from app.services.episode_service import sync_season_episodes

    watched_set = {
        (w.season_number, w.episode_number)
        for w in db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=show_id).all()
    }

    def _query_episodes():
        return (
            db.query(Episode)
            .filter(Episode.show_id == show_id, Episode.season_number > 0)
            .order_by(Episode.season_number, Episode.episode_number)
            .all()
        )

    episodes = _query_episodes()

    # If we have no episode data at all, sync season 1 first
    if not episodes:
        sync_season_episodes(db, show_id, 1)
        episodes = _query_episodes()

    # Find first unwatched episode
    for ep in episodes:
        if (ep.season_number, ep.episode_number) not in watched_set:
            return {
                "finished": False,
                "season_number": ep.season_number,
                "episode_number": ep.episode_number,
                "name": ep.name,
                "still_path": ep.still_path,
                "overview": ep.overview,
                "air_date": str(ep.air_date) if ep.air_date else None,
            }

    # All synced episodes watched — check if there are more seasons to sync
    show = db.query(Show).filter_by(id=show_id).first()
    max_synced = max((ep.season_number for ep in episodes), default=0)
    total_seasons = show.number_of_seasons if show else None

    if total_seasons and max_synced < total_seasons:
        sync_season_episodes(db, show_id, max_synced + 1)
        new_episodes = (
            db.query(Episode)
            .filter(Episode.show_id == show_id, Episode.season_number == max_synced + 1)
            .order_by(Episode.episode_number)
            .all()
        )
        for ep in new_episodes:
            if (ep.season_number, ep.episode_number) not in watched_set:
                return {
                    "finished": False,
                    "season_number": ep.season_number,
                    "episode_number": ep.episode_number,
                    "name": ep.name,
                    "still_path": ep.still_path,
                    "overview": ep.overview,
                    "air_date": str(ep.air_date) if ep.air_date else None,
                }

    return {"finished": True}


def get_next_unwatched_episodes_bulk(db: Session, user_id: str, show_ids: list[int]) -> dict:
    """
    Return next unwatched episode for each show_id in one pass.
    Avoids one round-trip per show.
    """
    if not show_ids:
        return {}

    # Load all watched episodes for the user + these shows in one query
    watched_rows = (
        db.query(EpisodeWatched.show_id, EpisodeWatched.season_number, EpisodeWatched.episode_number)
        .filter(EpisodeWatched.user_id == user_id, EpisodeWatched.show_id.in_(show_ids))
        .all()
    )
    watched_by_show: dict[int, set] = {sid: set() for sid in show_ids}
    for row in watched_rows:
        watched_by_show[row.show_id].add((row.season_number, row.episode_number))

    # Load all episodes for these shows in one query
    episodes_rows = (
        db.query(Episode)
        .filter(Episode.show_id.in_(show_ids), Episode.season_number > 0)
        .order_by(Episode.show_id, Episode.season_number, Episode.episode_number)
        .all()
    )
    episodes_by_show: dict[int, list] = {sid: [] for sid in show_ids}
    for ep in episodes_rows:
        episodes_by_show[ep.show_id].append(ep)

    result = {}
    for show_id in show_ids:
        watched = watched_by_show[show_id]
        episodes = episodes_by_show[show_id]

        # If no episodes synced yet, fall back to per-show logic (rare for already-tracked shows)
        if not episodes:
            result[show_id] = get_next_unwatched_episode(db, user_id, show_id)
            continue

        next_ep = None
        for ep in episodes:
            if (ep.season_number, ep.episode_number) not in watched:
                next_ep = ep
                break

        if next_ep is None:
            result[show_id] = {"finished": True}
        else:
            result[show_id] = {
                "finished": False,
                "season_number": next_ep.season_number,
                "episode_number": next_ep.episode_number,
                "name": next_ep.name,
                "still_path": next_ep.still_path,
                "overview": next_ep.overview,
                "air_date": str(next_ep.air_date) if next_ep.air_date else None,
            }

    return result


def get_watched_episodes_by_show(db: Session, user_id: str, show_id: int):
    """
    Get all watched episodes for a user for a specific show.
    """
    items = db.query(EpisodeWatched).filter_by(user_id=user_id, show_id=show_id).all()
    return [
        {
            "season_number": item.season_number,
            "episode_number": item.episode_number,
            "watched_at": item.watched_at.isoformat(),
            "rating": item.rating,
        }
        for item in items
    ]


def _maybe_auto_complete_show(db: Session, user_id: str, show_id: int) -> bool:
    """
    After marking episode(s) as watched, auto-move the show to Watched status
    if all episodes have been seen. Returns True if auto-completed.
    Only triggers if the show is currently in Watchlist or Currently Watching.

    For in-production shows, only auto-completes when a season is genuinely
    finished — either the last available episode is tagged as a season/series/
    mid-season finale, or the user has watched all of the season's planned
    episode count. This prevents the show from bouncing between Watched and
    Watchlist for every week's episode on a currently-airing season.
    """
    from app.models.show import Show
    from app.models.season import Season

    in_watchlist = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type="tv", content_id=show_id)
        .first()
    )
    in_currently_watching = (
        db.query(CurrentlyWatching)
        .filter_by(user_id=user_id, content_type="tv", content_id=show_id)
        .first()
    )
    if not in_watchlist and not in_currently_watching:
        return False

    # Quick count check — skip expensive TMDB sync if episodes are clearly remaining
    stored_count = (
        db.query(Episode)
        .filter(Episode.show_id == show_id, Episode.season_number > 0)
        .count()
    )
    watched_count = (
        db.query(EpisodeWatched)
        .filter_by(user_id=user_id, show_id=show_id)
        .count()
    )
    if watched_count < stored_count:
        return False

    # Full check — may sync unseen seasons from TMDB to confirm nothing is left
    result = get_next_unwatched_episode(db, user_id, show_id)
    if not result.get("finished"):
        return False

    # For in-production shows, only auto-complete when a season is truly finished.
    # This prevents the weekly-airing bounce where the user watches the latest
    # available episode but more are still coming in the same season.
    show = db.query(Show).filter_by(id=show_id).first()
    if show and show.in_production:
        last_episode = (
            db.query(Episode)
            .filter(Episode.show_id == show_id, Episode.season_number > 0)
            .order_by(Episode.season_number.desc(), Episode.episode_number.desc())
            .first()
        )
        if not last_episode:
            return False

        # Primary: TMDB explicitly tagged the last episode as a finale
        finale_types = ("season_finale", "series_finale", "mid_season")
        is_season_complete = last_episode.episode_type in finale_types

        if not is_season_complete:
            # Fallback: user has watched all of the season's planned episode count
            season_row = (
                db.query(Season)
                .filter_by(show_id=show_id, season_number=last_episode.season_number)
                .first()
            )
            if season_row and season_row.episode_count:
                watched_in_season = (
                    db.query(EpisodeWatched)
                    .filter_by(user_id=user_id, show_id=show_id, season_number=last_episode.season_number)
                    .count()
                )
                is_season_complete = watched_in_season >= season_row.episode_count

        if not is_season_complete:
            return False

    # Add to Watched first so the subsequent removes see it still tracked
    # and leave tracking_count unchanged
    add_to_watched(db, user_id, "tv", show_id)

    if in_watchlist:
        remove_from_watchlist(db, user_id, "tv", show_id)
    if in_currently_watching:
        remove_from_currently_watching(db, user_id, "tv", show_id)

    print(f"[auto-complete] Show {show_id} auto-moved to Watched for user {user_id}")
    return True
