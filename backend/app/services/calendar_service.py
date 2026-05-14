# backend/app/services/calendar_service.py
from collections import defaultdict
from sqlalchemy import select, union_all, literal
from sqlalchemy.orm import Session, aliased

from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.models.watched import Watched
from app.models.show import Show
from app.models.movie import Movie
from app.services.watchlist_service import (
    serialize_show_calendar,
    serialize_movie_calendar,
)


def get_calendar(
    db: Session,
    user_id: str,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    # ── Single UNION ALL replaces 3 separate list queries ────────────────────
    all_rows = db.execute(
        union_all(
            select(
                Watchlist.content_id,
                Watchlist.content_type,
                literal("watchlist").label("source"),
            ).where(Watchlist.user_id == user_id),
            select(
                CurrentlyWatching.content_id,
                CurrentlyWatching.content_type,
                literal("cw").label("source"),
            ).where(
                CurrentlyWatching.user_id == user_id,
                CurrentlyWatching.content_type.in_(["tv", "movie"]),
            ),
            select(
                Watched.content_id,
                literal("movie").label("content_type"),
                literal("watched").label("source"),
            ).where(Watched.user_id == user_id, Watched.content_type == "movie"),
        )
    ).all()

    show_ids = list({r.content_id for r in all_rows if r.content_type == "tv"})
    wl_movie_ids = {r.content_id for r in all_rows if r.content_type == "movie" and r.source == "watchlist"}
    cw_movie_ids = {r.content_id for r in all_rows if r.content_type == "movie" and r.source == "cw"}
    watched_movie_ids = {r.content_id for r in all_rows if r.source == "watched"}
    all_movie_ids = list(wl_movie_ids | cw_movie_ids | watched_movie_ids)

    tv_result = []
    if show_ids:
        # Project only the columns serialize_show_calendar needs — avoids full ORM hydration
        shows = db.query(
            Show.id, Show.name, Show.poster_path,
            Show.backdrop_path, Show.logo_path,
            Show.air_time, Show.air_timezone,
        ).filter(Show.id.in_(show_ids)).all()

        # LEFT JOIN EpisodeWatched so is_watched is computed in Postgres, not Python
        ew = aliased(EpisodeWatched)
        eps_q = (
            db.query(
                Episode.id,
                Episode.show_id,
                Episode.season_number,
                Episode.episode_number,
                Episode.name,
                Episode.air_date,
                Episode.runtime,
                Episode.still_path,
                Episode.overview,
                Episode.episode_type,
                ew.id.isnot(None).label("is_watched"),
            )
            .outerjoin(
                ew,
                (ew.show_id == Episode.show_id)
                & (ew.season_number == Episode.season_number)
                & (ew.episode_number == Episode.episode_number)
                & (ew.user_id == user_id),
            )
            .filter(Episode.show_id.in_(show_ids))
        )
        if from_date:
            eps_q = eps_q.filter(Episode.air_date >= from_date)
        if to_date:
            eps_q = eps_q.filter(Episode.air_date <= to_date)
        episodes = eps_q.order_by(
            Episode.show_id, Episode.season_number, Episode.episode_number
        ).all()

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
                    "episode_type": ep.episode_type,
                    "is_watched": ep.is_watched,
                }
            )

        filtering = bool(from_date or to_date)
        tv_result = [
            {"show": serialize_show_calendar(show), "episodes": eps_by_show[show.id]}
            for show in shows
            if not filtering or eps_by_show[show.id]
        ]

    # ── Movies: project only columns serialize_movie_calendar needs ───────────
    movies_result = []
    if all_movie_ids:
        movies = db.query(
            Movie.id, Movie.title, Movie.overview, Movie.poster_path,
            Movie.backdrop_path, Movie.logo_path, Movie.release_date,
            Movie.runtime, Movie.status, Movie.vote_average,
        ).filter(Movie.id.in_(all_movie_ids)).all()
        for movie in movies:
            serialized = serialize_movie_calendar(movie)
            serialized["is_watched"] = movie.id in watched_movie_ids
            movies_result.append(serialized)

    return {"shows": tv_result, "movies": movies_result}
