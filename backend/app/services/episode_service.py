# app/services/episode_service.py
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.season import Season
from app.models.show import Show
from app.models.currently_watching import CurrentlyWatching
from app.models.user import User
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.email_service import send_new_season_available_email
from app.services.tmdb_client import get

logger = logging.getLogger(__name__)


def _update_season_end_date(db: Session, show_id: int, season_number: int) -> None:
    """Recompute and persist season.end_date as MAX(episode.air_date) for the season.
    Caller is responsible for committing."""
    season = (
        db.query(Season)
        .filter(Season.show_id == show_id, Season.season_number == season_number)
        .first()
    )
    if not season:
        return
    max_air = (
        db.query(func.max(Episode.air_date))
        .filter(
            Episode.show_id == show_id,
            Episode.season_number == season_number,
            Episode.air_date.isnot(None),
        )
        .scalar()
    )
    if season.end_date != max_air:
        season.end_date = max_air


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

    # NOTE: previously this called db.close() before the TMDB fetch to release
    # the pool connection, then reused the closed session for db.query/add/commit.
    # SQLAlchemy will resurrect the session, but it's implicit behavior we
    # shouldn't rely on. We hold the connection across the HTTP call instead;
    # if pool exhaustion becomes a problem, refactor callers to do the TMDB
    # fetch outside the request session.
    try:
        show_data = get(f"/tv/{show_id}")
    except Exception:
        logger.exception("Failed to fetch show %s from TMDB", show_id)
        return False

    if not show_data or not show_data.get("name"):
        return False

    # Re-check: another worker may have inserted the row while we fetched.
    if db.query(Show).filter_by(id=show_id).first():
        return True

    show = Show(
        id=show_data["id"],
        name=show_data["name"],
        backdrop_path=show_data.get("backdrop_path"),
        logo_path=None,
        last_air_date=show_data.get("last_air_date") or None,
        homepage=show_data.get("homepage"),
        in_production=show_data.get("in_production"),
        number_of_seasons=show_data.get("number_of_seasons"),
        number_of_episodes=show_data.get("number_of_episodes"),
        status=show_data.get("status"),
        tagline=show_data.get("tagline"),
        overview=show_data.get("overview"),
        type=show_data.get("type"),
        first_air_date=show_data.get("first_air_date") or None,
        poster_path=show_data.get("poster_path"),
        tracking_count=0,
    )
    db.add(show)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
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

    # Fast path: if the Season row's episode_count matches the Episode rows we
    # already have cached, the season is fully synced — skip the TMDB call.
    # Big win for repeat imports where we'd otherwise re-fetch every season.
    season_row = (
        db.query(Season)
        .filter(Season.show_id == show_id, Season.season_number == season_number)
        .first()
    )
    if season_row and season_row.episode_count:
        cached_count = (
            db.query(func.count(Episode.id))
            .filter(Episode.show_id == show_id, Episode.season_number == season_number)
            .scalar()
        )
        if cached_count >= season_row.episode_count:
            return

    try:
        season_data = get(f"/tv/{show_id}/season/{season_number}")
    except Exception:
        logger.exception("Failed to fetch show %s season %s from TMDB", show_id, season_number)
        return

    for ep in season_data.get("episodes", []):
        ep_id = ep.get("id")
        if not ep_id:
            continue

        if db.query(Episode).filter_by(id=ep_id).first():
            continue

        ep_num = ep.get("episode_number")
        db.add(
            Episode(
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
                episode_type=_compute_episode_type(
                    ep_num, season_number, ep.get("episode_type"), in_production
                ),
            )
        )

    db.flush()
    _update_season_end_date(db, show_id, season_number)
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
            logger.exception("Failed to fetch show %s season %s from TMDB", show_id, sn)
            return sn, None

    max_workers = min(8, len(season_numbers)) if season_numbers else 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        season_results = dict(executor.map(_fetch_season, season_numbers))

    # Collect IDs already in DB to skip existing episodes efficiently
    existing_ids = {
        ep_id
        for (ep_id,) in db.query(Episode.id).filter(Episode.show_id == show_id).all()
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
                episode_type=_compute_episode_type(
                    ep_num, season_number, ep.get("episode_type"), show.in_production
                ),
            )
            db.add(episode)
            existing_ids.add(ep_id)

    db.flush()
    for sn in season_numbers:
        _update_season_end_date(db, show_id, sn)
    db.commit()


def maybe_sync_show_episodes(db: Session, show_id: int):
    """
    Sync episodes only if none are stored yet for this show.
    """
    existing = db.query(Episode).filter_by(show_id=show_id).first()
    if existing:
        return
    sync_show_episodes(db, show_id)


def maybe_sync_show_episodes_background(show_id: int):
    """
    Background task: sync a show's episodes (own DB session) only if none are
    stored yet. Stored episodes are kept current by the nightly refresh, and
    populate_show_bg already syncs brand-new shows, so re-fetching every
    season on each add only cost TMDb calls.
    """
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        maybe_sync_show_episodes(db, show_id)
    except Exception:
        logger.exception("Error syncing episodes for show %s", show_id)
    finally:
        db.close()


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

    # ensure_show_in_db releases the connection internally before its TMDB
    # call, so no connection is held during that fetch.
    ensure_show_in_db(db, show_id)

    # Release the connection again before the second TMDB call.
    db.close()

    try:
        ep_data = get(f"/tv/{show_id}/season/{season_number}/episode/{episode_number}")
    except Exception:
        logger.exception(
            "Failed to fetch show %s S%sE%s from TMDB", show_id, season_number, episode_number
        )
        return None

    ep_id = ep_data.get("id")
    if not ep_id:
        return None

    # Re-check: another worker may have inserted the episode while we fetched.
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

    show = db.query(Show).filter_by(id=show_id).first()
    in_production = show.in_production if show else None

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
        episode_type=_compute_episode_type(
            episode_number, season_number, ep_data.get("episode_type"), in_production
        ),
    )
    db.add(episode)
    try:
        db.flush()
        _update_season_end_date(db, show_id, season_number)
        db.commit()
        db.refresh(episode)
    except IntegrityError:
        db.rollback()
        episode = (
            db.query(Episode)
            .filter_by(
                show_id=show_id,
                season_number=season_number,
                episode_number=episode_number,
            )
            .first()
        )
    return episode


def get_episodes_for_season(db: Session, show_id: int, season_number: int):
    return (
        db.query(Episode)
        .filter_by(show_id=show_id, season_number=season_number)
        .order_by(Episode.episode_number)
        .all()
    )


def _refresh_show_metadata(db: Session, show: Show):
    """
    Re-fetch show-level metadata from TMDB and persist any changes.
    Specifically updates number_of_seasons, in_production, and adds any
    Season rows that don't exist yet. This ensures refresh_episodes_for_show
    discovers seasons that were announced after the show was first added.
    """
    try:
        data = get(f"/tv/{show.id}")
    except Exception:
        logger.exception("Failed to fetch metadata for show %s from TMDB", show.id)
        return

    if not data:
        return

    changed = False

    new_num_seasons = data.get("number_of_seasons")
    if new_num_seasons and new_num_seasons != show.number_of_seasons:
        show.number_of_seasons = new_num_seasons
        changed = True

    new_in_production = data.get("in_production")
    if new_in_production is not None and new_in_production != show.in_production:
        show.in_production = new_in_production
        changed = True

    # Add Season rows for any seasons TMDB has that we don't yet have stored
    existing_season_ids = {s.id for s in show.seasons}
    for s in data.get("seasons", []):
        sn = s.get("season_number", 0)
        sid = s.get("id")
        if sn <= 0 or not sid or sid in existing_season_ids:
            continue
        db.add(
            Season(
                id=sid,
                show_id=show.id,
                season_number=sn,
                name=s.get("name"),
                overview=s.get("overview"),
                air_date=s.get("air_date") or None,
                episode_count=s.get("episode_count"),
                poster_path=s.get("poster_path"),
                vote_average=s.get("vote_average"),
            )
        )
        changed = True

    if changed:
        db.commit()
        db.refresh(show)  # Ensure show.seasons reflects new rows


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

    # Only refresh seasons that have upcoming episodes, unknown air dates,
    # or episodes with missing metadata (name/still_path not yet filled in by TMDB)
    today = date.today()
    active_seasons = set()
    for (sn,) in (
        db.query(Episode.season_number)
        .filter(
            Episode.show_id == show_id,
            (Episode.air_date == None)
            | (Episode.air_date >= today)
            | (Episode.name == None)
            | (Episode.still_path == None),
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
            logger.exception("Failed to fetch show %s season %s from TMDB", show_id, sn)
            return sn, None

    max_workers = min(8, len(seasons_to_refresh))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        season_results = dict(executor.map(_fetch_season, seasons_to_refresh))

    existing_rows = (
        db.query(Episode)
        .filter(
            Episode.show_id == show_id,
            Episode.season_number.in_(seasons_to_refresh),
        )
        .all()
    )
    existing = {ep.id: ep for ep in existing_rows}
    # Fallback lookup: TMDB occasionally reissues an episode under a new id
    # while keeping the same (season, episode_number). Without this we'd try to
    # INSERT a "new" episode that collides with the unique constraint.
    existing_by_pos = {(ep.season_number, ep.episode_number): ep for ep in existing_rows}

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
            new_type = _compute_episode_type(
                ep_num, sn, ep.get("episode_type"), show.in_production
            )

            row = existing.get(ep_id) or existing_by_pos.get((sn, ep_num))
            if row is not None:
                if (
                    str(row.air_date) != str(new_air_date)
                    or row.name != new_name
                    or row.overview != new_overview
                    or row.runtime != new_runtime
                    or row.still_path != new_still
                    or row.vote_average != new_vote
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
                db.add(
                    Episode(
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
                    )
                )
                changed = True

    if changed:
        db.flush()
        for sn in seasons_to_refresh:
            _update_season_end_date(db, show_id, sn)
        db.commit()


def _refresh_one_show(show_id: int, show_name: str) -> None:
    """Worker executed in a thread pool: refresh metadata + episodes for one show."""
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        show = db.query(Show).filter_by(id=show_id).first()
        if not show:
            return
        _refresh_show_metadata(db, show)
        refresh_episodes_for_show(db, show_id)
    except Exception:
        logger.exception("Failed to refresh show %s (%s)", show_id, show_name)
    finally:
        db.close()


def refresh_episodes_for_active_shows(db: Session):
    """
    Refresh episode data for all tracked shows (watchlist, currently watching,
    and watched) that are still in production. Intended to run nightly.
    Runs up to 8 shows in parallel, each with its own DB session.
    """
    tracked_ids = (
        {
            r.content_id
            for r in db.query(Watchlist.content_id).filter_by(content_type="tv").all()
        }
        | {
            r.content_id
            for r in db.query(CurrentlyWatching.content_id)
            .filter_by(content_type="tv")
            .all()
        }
        | {
            r.content_id
            for r in db.query(Watched.content_id).filter_by(content_type="tv").all()
        }
    )

    if not tracked_ids:
        return

    # Only refresh shows that are in production (finished shows don't change)
    shows = (
        db.query(Show)
        .filter(Show.id.in_(tracked_ids), Show.in_production == True)  # noqa: E712
        .all()
    )

    logger.info("Refreshing %d in-production shows...", len(shows))
    with ThreadPoolExecutor(max_workers=8) as pool:
        for show in shows:
            pool.submit(_refresh_one_show, show.id, show.name)
    logger.info("Episode refresh done")


def _reactivation_candidates(db: Session, today: date):
    """One row per Watched, in-production show that now has a new episode for
    that user: (watched_id, user_id, show_id, season_number, air_date) of the
    first new episode (lowest season, then episode number).

    A new episode is one the user hasn't marked that is either in a season
    past the latest one they've watched, or has already aired. Computed in SQL
    so the nightly run doesn't load every episode of every watched show, and
    every user's watched-episode rows, into Python.
    """
    pairs = (
        select(
            Watched.id.label("watched_id"),
            Watched.user_id.label("user_id"),
            Watched.content_id.label("show_id"),
        )
        .join(Show, and_(Show.id == Watched.content_id, Watched.content_type == "tv"))
        .where(Show.in_production == True)  # noqa: E712
        .cte("pairs")
    )
    max_watched = (
        select(
            EpisodeWatched.user_id,
            EpisodeWatched.show_id,
            func.max(EpisodeWatched.season_number).label("max_season"),
        )
        .join(pairs, and_(
            pairs.c.user_id == EpisodeWatched.user_id,
            pairs.c.show_id == EpisodeWatched.show_id,
        ))
        .group_by(EpisodeWatched.user_id, EpisodeWatched.show_id)
        .subquery("max_watched")
    )
    marked = aliased(EpisodeWatched)
    position = func.row_number().over(
        partition_by=pairs.c.watched_id,
        order_by=(Episode.season_number, Episode.episode_number),
    ).label("position")
    new_episodes = (
        select(
            pairs.c.watched_id, pairs.c.user_id, pairs.c.show_id,
            Episode.season_number, Episode.air_date, position,
        )
        .select_from(pairs)
        .join(Episode, and_(Episode.show_id == pairs.c.show_id, Episode.season_number > 0))
        .outerjoin(max_watched, and_(
            max_watched.c.user_id == pairs.c.user_id,
            max_watched.c.show_id == pairs.c.show_id,
        ))
        .where(
            ~exists().where(
                marked.user_id == pairs.c.user_id,
                marked.show_id == pairs.c.show_id,
                marked.season_number == Episode.season_number,
                marked.episode_number == Episode.episode_number,
            ),
            or_(
                Episode.season_number > func.coalesce(max_watched.c.max_season, 0),
                and_(Episode.air_date.isnot(None), Episode.air_date <= today),
            ),
        )
        .subquery("new_episodes")
    )
    return db.execute(
        select(
            new_episodes.c.watched_id, new_episodes.c.user_id, new_episodes.c.show_id,
            new_episodes.c.season_number, new_episodes.c.air_date,
        ).where(new_episodes.c.position == 1)
    ).all()


def check_and_reactivate_watched_shows(db: Session):
    """
    After episode refresh, find users who have a show in Watched status but now
    have unwatched episodes (because new episodes were added). Move those shows
    back to Watchlist and send an email notification.
    Intended to run nightly after refresh_episodes_for_active_shows.
    """
    rows = _reactivation_candidates(db, date.today())
    if not rows:
        return

    show_ids = list({row.show_id for row in rows})
    user_ids = list({row.user_id for row in rows})
    shows_by_id = {s.id: s for s in db.query(Show).filter(Show.id.in_(show_ids)).all()}
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}

    # Bulk-load existing watchlist entries to avoid duplicate inserts
    existing_watchlist = {
        (w.user_id, w.content_id)
        for w in db.query(Watchlist.user_id, Watchlist.content_id)
        .filter(
            Watchlist.user_id.in_(user_ids),
            Watchlist.content_id.in_(show_ids),
            Watchlist.content_type == "tv",
        )
        .all()
    }

    # No emails until the DB work is committed — keep the session free of
    # email latency.
    pending_emails: list[dict] = []  # {user_id, user, show, new_season_number, premiere_date}

    for row in rows:
        user_id, show_id = row.user_id, row.show_id
        premiere_date = str(row.air_date) if row.air_date else None
        show = shows_by_id.get(show_id)

        if (user_id, show_id) not in existing_watchlist:
            db.add(
                Watchlist(
                    user_id=user_id,
                    content_type="tv",
                    content_id=show_id,
                    added_at=datetime.now(timezone.utc),
                )
            )
            existing_watchlist.add((user_id, show_id))

        show_name = show.name if show else str(show_id)
        logger.info(
            "Reactivated '%s' for user %s — Season %s premieres %s",
            show_name, user_id, row.season_number, premiere_date or "TBD",
        )

        user = users_by_id.get(user_id)
        if user and user.email_notifications and user.email:
            pending_emails.append(
                {
                    "user_id": user_id,
                    "user": user,
                    "show": show,
                    "show_id": show_id,
                    "new_season_number": row.season_number,
                    "premiere_date": premiere_date,
                }
            )

    db.query(Watched).filter(Watched.id.in_([row.watched_id for row in rows])).delete(
        synchronize_session=False
    )
    reactivated = len(rows)

    # Single commit for all watchlist inserts + watched deletions.
    db.commit()

    if reactivated:
        logger.info("Reactivated %d show(s) with new seasons", reactivated)

    # Send emails after the session is closed — failures don't roll back DB work.
    for item in pending_emails:
        try:
            send_new_season_available_email(
                to_email=item["user"].email,
                username=item["user"].username or "",
                shows=[
                    {
                        "show_name": item["show"].name if item["show"] else "Unknown",
                        "show_id": item["show_id"],
                        "poster_path": item["show"].poster_path if item["show"] else None,
                        "season_number": item["new_season_number"],
                        "premiere_date": item["premiere_date"],
                    }
                ],
                uid=item["user_id"],
            )
        except Exception:
            logger.exception("Failed to send reactivation email to user %s", item["user_id"])
