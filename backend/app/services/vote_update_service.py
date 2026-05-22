import logging
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import union, select
from sqlalchemy.orm import Session
from app.models.currently_watching import CurrentlyWatching
from app.models.show import Show
from app.models.movie import Movie
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.tmdb_client import get

logger = logging.getLogger(__name__)


def _fetch_show_vote(show_id: int) -> tuple[int, float | None]:
    try:
        data = get(f"/tv/{show_id}")
        return show_id, data.get("vote_average")
    except Exception:
        logger.exception("Failed to fetch vote_average for show %s from TMDB", show_id)
        return show_id, None


def _fetch_movie_vote(movie_id: int) -> tuple[int, float | None]:
    try:
        data = get(f"/movie/{movie_id}")
        return movie_id, data.get("vote_average")
    except Exception:
        logger.exception("Failed to fetch vote_average for movie %s from TMDB", movie_id)
        return movie_id, None


def _tracked_ids(db: Session, content_type: str) -> list[int]:
    """Distinct content IDs of the given type that at least one user is tracking."""
    ct = content_type
    q = union(
        select(Watchlist.content_id).where(Watchlist.content_type == ct),
        select(CurrentlyWatching.content_id).where(CurrentlyWatching.content_type == ct),
        select(Watched.content_id).where(Watched.content_type == ct),
    )
    return list(db.execute(q).scalars())


def update_all_vote_averages(db: Session):
    """
    Fetch the latest vote_average from TMDb for every tracked show and movie
    and update the rows in bulk. Only content tracked by at least one user is
    refreshed — untracked cache rows are skipped to conserve TMDb quota.
    """
    logger.info("Updating vote averages")
    show_ids = _tracked_ids(db, "tv")
    movie_ids = _tracked_ids(db, "movie")

    updated_shows = 0
    updated_movies = 0

    if show_ids:
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(_fetch_show_vote, show_ids))
        show_updates = [
            {"id": sid, "vote_average": v} for sid, v in results if v is not None
        ]
        updated_shows = len(show_updates)
        if show_updates:
            db.bulk_update_mappings(Show, show_updates)
            db.commit()

    if movie_ids:
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(_fetch_movie_vote, movie_ids))
        movie_updates = [
            {"id": mid, "vote_average": v} for mid, v in results if v is not None
        ]
        updated_movies = len(movie_updates)
        if movie_updates:
            db.bulk_update_mappings(Movie, movie_updates)
            db.commit()

    logger.info("[vote update] Updated %d shows and %d movies", updated_shows, updated_movies)
