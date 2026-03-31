# app/services/episode_service.py
import threading
from concurrent.futures import ThreadPoolExecutor
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
