# backend/app/services/calendar_service.py
from collections import defaultdict
from sqlalchemy.orm import Session

from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.models.watched import Watched
from app.models.show import Show
from app.models.movie import Movie
from app.services.watchlist_service import (
    serialize_show,
    serialize_movie,
    _show_query_options,
    _movie_query_options,
)


def get_calendar(
    db: Session,
    user_id: str,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    """
    Return all calendar data for a user in one query:
    - TV shows from watchlist + currently-watching, with episodes in the
      optional date window, each episode annotated with is_watched.
    - Movies from watchlist + watched + currently-watching, each annotated
      with is_watched.
    """
    # ── Fetch all user list IDs in 3 queries (one per table) ─────────────────
    watchlist_rows = (
        db.query(Watchlist.content_id, Watchlist.content_type)
        .filter(
            Watchlist.user_id == user_id,
            Watchlist.content_type.in_(["tv", "movie"]),
        )
        .all()
    )
    watchlist_show_ids = {r.content_id for r in watchlist_rows if r.content_type == "tv"}
    watchlist_movie_ids = {r.content_id for r in watchlist_rows if r.content_type == "movie"}

    cw_rows = (
        db.query(CurrentlyWatching.content_id, CurrentlyWatching.content_type)
        .filter(
            CurrentlyWatching.user_id == user_id,
            CurrentlyWatching.content_type.in_(["tv", "movie"]),
        )
        .all()
    )
    cw_show_ids = {r.content_id for r in cw_rows if r.content_type == "tv"}
    cw_movie_ids = {r.content_id for r in cw_rows if r.content_type == "movie"}

    watched_movie_ids = {
        row.content_id
        for row in db.query(Watched.content_id)
        .filter(Watched.user_id == user_id, Watched.content_type == "movie")
        .all()
    }

    show_ids = list(watchlist_show_ids | cw_show_ids)

    tv_result = []
    if show_ids:
        shows = (
            db.query(Show)
            .options(*_show_query_options())
            .filter(Show.id.in_(show_ids))
            .all()
        )

        eps_query = db.query(Episode).filter(Episode.show_id.in_(show_ids))
        if from_date:
            eps_query = eps_query.filter(Episode.air_date >= from_date)
        if to_date:
            eps_query = eps_query.filter(Episode.air_date <= to_date)
        episodes = eps_query.order_by(
            Episode.show_id, Episode.season_number, Episode.episode_number
        ).all()

        watched_ep_keys = {
            (row.show_id, row.season_number, row.episode_number)
            for row in db.query(
                EpisodeWatched.show_id,
                EpisodeWatched.season_number,
                EpisodeWatched.episode_number,
            )
            .filter(
                EpisodeWatched.user_id == user_id,
                EpisodeWatched.show_id.in_(show_ids),
            )
            .all()
        }

        eps_by_show: dict[int, list] = defaultdict(list)
        for ep in episodes:
            eps_by_show[ep.show_id].append(
                {
                    "id": ep.id,
                    "show_id": ep.show_id,
                    "season_number": ep.season_number,
                    "episode_number": ep.episode_number,
                    "name": ep.name,
                    "air_date": str(ep.air_date) if ep.air_date else None,
                    "runtime": ep.runtime,
                    "still_path": ep.still_path,
                    "overview": ep.overview,
                    "vote_average": ep.vote_average,
                    "episode_type": ep.episode_type,
                    "is_watched": (
                        ep.show_id,
                        ep.season_number,
                        ep.episode_number,
                    )
                    in watched_ep_keys,
                }
            )

        filtering = bool(from_date or to_date)
        tv_result = [
            {"show": serialize_show(show), "episodes": eps_by_show[show.id]}
            for show in shows
            if not filtering or eps_by_show[show.id]
        ]

    # ── Movies ────────────────────────────────────────────────────────────────
    all_movie_ids = list(watchlist_movie_ids | watched_movie_ids | cw_movie_ids)

    movies_result = []
    if all_movie_ids:
        movies = (
            db.query(Movie)
            .options(*_movie_query_options())
            .filter(Movie.id.in_(all_movie_ids))
            .all()
        )
        for movie in movies:
            serialized = serialize_movie(movie)
            serialized["is_watched"] = movie.id in watched_movie_ids
            movies_result.append(serialized)

    return {"shows": tv_result, "movies": movies_result}
