from concurrent.futures import ThreadPoolExecutor
from sqlalchemy.orm import Session
from app.models.show import Show
from app.models.movie import Movie
from app.services.tmdb_client import get


def _fetch_show_vote(show_id: int) -> tuple[int, float | None]:
    try:
        data = get(f"/tv/{show_id}")
        return show_id, data.get("vote_average")
    except Exception:
        return show_id, None


def _fetch_movie_vote(movie_id: int) -> tuple[int, float | None]:
    try:
        data = get(f"/movie/{movie_id}")
        return movie_id, data.get("vote_average")
    except Exception:
        return movie_id, None


def update_all_vote_averages(db: Session):
    """
    Fetch the latest vote_average from TMDB for every show and movie
    currently stored in the database and update the rows in bulk.
    Uses a thread pool so all requests run in parallel.
    """
    print("Updating vote averages")
    show_ids = [r[0] for r in db.query(Show.id).all()]
    movie_ids = [r[0] for r in db.query(Movie.id).all()]

    updated_shows = 0
    updated_movies = 0

    if show_ids:
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(_fetch_show_vote, show_ids))
        show_updates = [{"id": sid, "vote_average": v} for sid, v in results if v is not None]
        updated_shows = len(show_updates)
        if show_updates:
            db.bulk_update_mappings(Show, show_updates)
            db.commit()

    if movie_ids:
        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(_fetch_movie_vote, movie_ids))
        movie_updates = [{"id": mid, "vote_average": v} for mid, v in results if v is not None]
        updated_movies = len(movie_updates)
        if movie_updates:
            db.bulk_update_mappings(Movie, movie_updates)
            db.commit()

    print(f"[vote update] Updated {updated_shows} shows and {updated_movies} movies")
