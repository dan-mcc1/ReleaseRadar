# app/services/episode_service.py
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from sqlalchemy.orm import Session
from app.models.episode import Episode
from app.models.show import Show
from app.services.tmdb_client import get


def _compute_episode_type(
    episode_number: int,
    season_number: int,
    tmdb_type: str | None,
    in_production: bool | None,
) -> str | None:
    if episode_number == 1:
        return "show_premiere" if season_number == 1 else "season_premiere"
    if tmdb_type == "finale":
        return "series_finale" if in_production is False else "season_finale"
    if tmdb_type == "mid_season":
        return "mid_season"
    return None


def ensure_show_in_db(db: Session, show_id: int) -> bool:
    """
    Ensure the show row exists in the show table so episode FKs are satisfied.
    Returns True if show exists or was created, False if TMDB fetch failed.
    """
    if db.query(Show).filter_by(id=show_id).first():
        return True

    try:
        show_data = get(f"/tv/{show_id}")
    except Exception:
        return False

    if not show_data or not show_data.get("name"):
        return False

    show = Show(
        id=show_data["id"],
        name=show_data["name"],
        backdrop_path=show_data.get("backdrop_path"),
        logo_path=None,
        last_air_date=show_data.get("last_air_date"),
        homepage=show_data.get("homepage"),
        in_production=show_data.get("in_production"),
        number_of_seasons=show_data.get("number_of_seasons"),
        number_of_episodes=show_data.get("number_of_episodes"),
        status=show_data.get("status"),
        tagline=show_data.get("tagline"),
        overview=show_data.get("overview"),
        type=show_data.get("type"),
        first_air_date=show_data.get("first_air_date"),
        poster_path=show_data.get("poster_path"),
        tracking_count=0,
    )
    db.add(show)
    db.commit()
    return True


def sync_season_episodes(db: Session, show_id: int, season_number: int):
    """
    Fetch all episodes for a single season from TMDB and upsert into the
    episode table. Ensures the show row exists first.
    """
    if not ensure_show_in_db(db, show_id):
        return

    show = db.query(Show).filter_by(id=show_id).first()
    in_production = show.in_production if show else None

    try:
        season_data = get(f"/tv/{show_id}/season/{season_number}")
    except Exception:
        return

    for ep in season_data.get("episodes", []):
        ep_id = ep.get("id")
        if not ep_id:
            continue

        if db.query(Episode).filter_by(id=ep_id).first():
            continue

        ep_num = ep.get("episode_number")
        db.add(Episode(
            id=ep_id,
            show_id=show_id,
            season_number=season_number,
            episode_number=ep_num,
            name=ep.get("name"),
            overview=ep.get("overview"),
            air_date=ep.get("air_date") or None,
            runtime=ep.get("runtime"),
            still_path=ep.get("still_path"),
            vote_average=ep.get("vote_average"),
            episode_type=_compute_episode_type(ep_num, season_number, ep.get("episode_type"), in_production),
        ))

    db.commit()


def sync_show_episodes(db: Session, show_id: int):
    """
    Fetch all episodes for a show from TMDB and insert any that are not
    already stored. Skips season 0 (specials). Safe to call multiple times.
    """
    if not ensure_show_in_db(db, show_id):
        return

    show = db.query(Show).filter_by(id=show_id).first()
    if not show:
        return

    # Use the season table if populated, otherwise fall back to number_of_seasons
    if show.seasons:
        season_numbers = [s.season_number for s in show.seasons if s.season_number > 0]
    else:
        n = show.number_of_seasons or 0
        season_numbers = list(range(1, n + 1))

    # Fetch all seasons from TMDB in parallel
    def _fetch_season(sn):
        try:
            return sn, get(f"/tv/{show_id}/season/{sn}")
        except Exception:
            return sn, None

    max_workers = min(8, len(season_numbers)) if season_numbers else 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        season_results = dict(executor.map(_fetch_season, season_numbers))

    # Collect IDs already in DB to skip existing episodes efficiently
    existing_ids = {
        ep_id for (ep_id,) in db.query(Episode.id).filter(Episode.show_id == show_id).all()
    }

    for season_number in season_numbers:
        season_data = season_results.get(season_number)
        if not season_data:
            continue

        for ep in season_data.get("episodes", []):
            ep_id = ep.get("id")
            if not ep_id or ep_id in existing_ids:
                continue

            ep_num = ep.get("episode_number")
            episode = Episode(
                id=ep_id,
                show_id=show_id,
                season_number=season_number,
                episode_number=ep_num,
                name=ep.get("name"),
                overview=ep.get("overview"),
                air_date=ep.get("air_date") or None,
                runtime=ep.get("runtime"),
                still_path=ep.get("still_path"),
                vote_average=ep.get("vote_average"),
                episode_type=_compute_episode_type(ep_num, season_number, ep.get("episode_type"), show.in_production),
            )
            db.add(episode)
            existing_ids.add(ep_id)

    db.commit()


def maybe_sync_show_episodes(db: Session, show_id: int):
    """
    Sync episodes only if none are stored yet for this show.
    """
    existing = db.query(Episode).filter_by(show_id=show_id).first()
    if existing:
        return
    sync_show_episodes(db, show_id)


def sync_show_episodes_background(show_id: int):
    """
    Fire-and-forget: sync all episodes for a show in a daemon thread.
    The calling request returns immediately; episodes appear in the DB shortly after.
    """
    from app.db.session import SessionLocal

    def _run():
        db = SessionLocal()
        try:
            maybe_sync_show_episodes(db, show_id)
        except Exception as e:
            print(f"[episode sync] Error syncing show {show_id}: {e}")
        finally:
            db.close()

    threading.Thread(target=_run, daemon=True).start()


def get_or_create_episode(
    db: Session, show_id: int, season_number: int, episode_number: int
) -> Episode | None:
    """
    Return the Episode row for the given show/season/episode, fetching from
    TMDB and inserting it if it isn't already stored.
    """
    episode = (
        db.query(Episode)
        .filter_by(
            show_id=show_id,
            season_number=season_number,
            episode_number=episode_number,
        )
        .first()
    )
    if episode:
        return episode

    ensure_show_in_db(db, show_id)
    show = db.query(Show).filter_by(id=show_id).first()
    in_production = show.in_production if show else None

    try:
        ep_data = get(f"/tv/{show_id}/season/{season_number}/episode/{episode_number}")
    except Exception:
        return None

    ep_id = ep_data.get("id")
    if not ep_id:
        return None

    episode = Episode(
        id=ep_id,
        show_id=show_id,
        season_number=season_number,
        episode_number=episode_number,
        name=ep_data.get("name"),
        overview=ep_data.get("overview"),
        air_date=ep_data.get("air_date") or None,
        runtime=ep_data.get("runtime"),
        still_path=ep_data.get("still_path"),
        vote_average=ep_data.get("vote_average"),
        episode_type=_compute_episode_type(episode_number, season_number, ep_data.get("episode_type"), in_production),
    )
    db.add(episode)
    db.commit()
    db.refresh(episode)
    return episode


def get_episodes_for_season(db: Session, show_id: int, season_number: int):
    return (
        db.query(Episode)
        .filter_by(show_id=show_id, season_number=season_number)
        .order_by(Episode.episode_number)
        .all()
    )


def refresh_episodes_for_show(db: Session, show_id: int):
    """
    Re-fetch all seasons from TMDB for a show and upsert episode data.
    Updates air_date, name, overview, runtime, and episode_type for existing
    episodes. Inserts any new episodes that weren't stored yet.
    Only fetches seasons that have at least one upcoming or unaired episode.
    """
    show = db.query(Show).filter_by(id=show_id).first()
    if not show:
        return

    if show.seasons:
        season_numbers = [s.season_number for s in show.seasons if s.season_number > 0]
    else:
        n = show.number_of_seasons or 0
        season_numbers = list(range(1, n + 1))

    if not season_numbers:
        return

    # Only refresh seasons that have upcoming episodes or unknown air dates
    today = date.today()
    active_seasons = set()
    for (sn,) in (
        db.query(Episode.season_number)
        .filter(
            Episode.show_id == show_id,
            (Episode.air_date == None) | (Episode.air_date >= today),
        )
        .distinct()
        .all()
    ):
        active_seasons.add(sn)

    # Always include the latest season in case new episodes were added
    if season_numbers:
        active_seasons.add(max(season_numbers))

    seasons_to_refresh = [sn for sn in season_numbers if sn in active_seasons]
    if not seasons_to_refresh:
        return

    def _fetch_season(sn):
        try:
            return sn, get(f"/tv/{show_id}/season/{sn}")
        except Exception:
            return sn, None

    max_workers = min(8, len(seasons_to_refresh))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        season_results = dict(executor.map(_fetch_season, seasons_to_refresh))

    existing = {
        ep.id: ep
        for ep in db.query(Episode).filter(
            Episode.show_id == show_id,
            Episode.season_number.in_(seasons_to_refresh),
        ).all()
    }

    changed = False
    for sn in seasons_to_refresh:
        season_data = season_results.get(sn)
        if not season_data:
            continue

        for ep in season_data.get("episodes", []):
            ep_id = ep.get("id")
            if not ep_id:
                continue

            ep_num = ep.get("episode_number")
            new_air_date = ep.get("air_date") or None
            new_name = ep.get("name")
            new_overview = ep.get("overview")
            new_runtime = ep.get("runtime")
            new_still = ep.get("still_path")
            new_vote = ep.get("vote_average")
            new_type = _compute_episode_type(ep_num, sn, ep.get("episode_type"), show.in_production)

            if ep_id in existing:
                row = existing[ep_id]
                if (
                    str(row.air_date) != str(new_air_date)
                    or row.name != new_name
                    or row.overview != new_overview
                    or row.runtime != new_runtime
                    or row.episode_type != new_type
                ):
                    row.air_date = new_air_date
                    row.name = new_name
                    row.overview = new_overview
                    row.runtime = new_runtime
                    row.still_path = new_still
                    row.vote_average = new_vote
                    row.episode_type = new_type
                    changed = True
            else:
                db.add(Episode(
                    id=ep_id,
                    show_id=show_id,
                    season_number=sn,
                    episode_number=ep_num,
                    name=new_name,
                    overview=new_overview,
                    air_date=new_air_date,
                    runtime=new_runtime,
                    still_path=new_still,
                    vote_average=new_vote,
                    episode_type=new_type,
                ))
                changed = True

    if changed:
        db.commit()


def refresh_episodes_for_active_shows(db: Session):
    """
    Refresh episode data for all tracked shows that are still in production.
    Intended to run nightly.
    """
    from app.models.watchlist import Watchlist
    from app.models.currently_watching import CurrentlyWatching

    tracked_ids = {
        r.content_id
        for r in db.query(Watchlist.content_id)
        .filter_by(content_type="tv")
        .all()
    } | {
        r.content_id
        for r in db.query(CurrentlyWatching.content_id)
        .filter_by(content_type="tv")
        .all()
    }

    if not tracked_ids:
        return

    # Only refresh shows that are in production (finished shows don't change)
    shows = (
        db.query(Show)
        .filter(Show.id.in_(tracked_ids), Show.in_production == True)  # noqa: E712
        .all()
    )

    print(f"[episode refresh] Refreshing {len(shows)} in-production shows...")
    for show in shows:
        try:
            refresh_episodes_for_show(db, show.id)
        except Exception as e:
            print(f"[episode refresh] Failed for show {show.id} ({show.name}): {e}")
    print("[episode refresh] Done")
