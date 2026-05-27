# backend/app/services/calendar_service.py
from collections import defaultdict
from typing import Literal
from sqlalchemy import select, union_all, literal
from sqlalchemy.orm import Session, aliased

from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.models.watched import Watched
from app.models.show import Show
from app.models.movie import Movie
from app.services.media_serializers import (
    serialize_show_calendar,
    serialize_movie_calendar,
)

WatchedFilter = Literal["all", "watched", "unwatched"]


def get_calendar(
    db: Session,
    user_id: str,
    from_date: str | None = None,
    to_date: str | None = None,
    watched_filter: WatchedFilter = "all",
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
    watched_movie_ids: set[int] = set()
    all_movie_ids_set: set[int] = set()
    for r in all_rows:
        if r.content_type == "movie":
            all_movie_ids_set.add(r.content_id)
            if r.source == "watched":
                watched_movie_ids.add(r.content_id)

    tv_result = []
    if show_ids:
        date_filtering = bool(from_date or to_date)
        watch_filtering = watched_filter != "all"

        # Only fetch shows that actually have an episode in the date/watch window.
        shows_q = db.query(
            Show.id,
            Show.name,
            Show.poster_path,
            Show.backdrop_path,
            Show.logo_path,
            Show.air_time,
            Show.air_timezone,
        ).filter(Show.id.in_(show_ids))

        if date_filtering or watch_filtering:
            ep_exists = select(Episode.id).where(Episode.show_id == Show.id)
            if from_date:
                ep_exists = ep_exists.where(Episode.air_date >= from_date)
            if to_date:
                ep_exists = ep_exists.where(Episode.air_date <= to_date)
            if watch_filtering:
                ew_corr = select(EpisodeWatched.id).where(
                    EpisodeWatched.user_id == user_id,
                    EpisodeWatched.show_id == Episode.show_id,
                    EpisodeWatched.season_number == Episode.season_number,
                    EpisodeWatched.episode_number == Episode.episode_number,
                )
                if watched_filter == "watched":
                    ep_exists = ep_exists.where(ew_corr.exists())
                else:  # "unwatched"
                    ep_exists = ep_exists.where(~ew_corr.exists())
            shows_q = shows_q.filter(ep_exists.exists())

        shows = shows_q.all()

        # When filtering, every episode in the response shares the same is_watched
        # value, so we can skip the LEFT JOIN entirely.
        if watch_filtering:
            is_w_value = watched_filter == "watched"
            eps_q = db.query(
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
                literal(is_w_value).label("is_watched"),
            ).filter(Episode.show_id.in_([s.id for s in shows]))

            ew_corr = select(EpisodeWatched.id).where(
                EpisodeWatched.user_id == user_id,
                EpisodeWatched.show_id == Episode.show_id,
                EpisodeWatched.season_number == Episode.season_number,
                EpisodeWatched.episode_number == Episode.episode_number,
            )
            if watched_filter == "watched":
                eps_q = eps_q.filter(ew_corr.exists())
            else:  # "unwatched"
                eps_q = eps_q.filter(~ew_corr.exists())
        else:
            # LEFT JOIN EpisodeWatched so is_watched is computed in Postgres
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
                .filter(Episode.show_id.in_([s.id for s in shows]))
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

        tv_result = [
            {
                "show": serialize_show_calendar(show),
                "episodes": eps_by_show.get(show.id, []),
            }
            for show in shows
        ]

    # ── Movies: filter the ID set by watched state before hitting the DB ─────
    movies_result = []
    if watched_filter == "watched":
        movie_ids_to_fetch = watched_movie_ids
    elif watched_filter == "unwatched":
        movie_ids_to_fetch = all_movie_ids_set - watched_movie_ids
    else:
        movie_ids_to_fetch = all_movie_ids_set

    if movie_ids_to_fetch:
        movies_q = db.query(
            Movie.id,
            Movie.title,
            Movie.overview,
            Movie.poster_path,
            Movie.backdrop_path,
            Movie.logo_path,
            Movie.release_date,
            Movie.runtime,
        ).filter(Movie.id.in_(movie_ids_to_fetch))
        if from_date:
            movies_q = movies_q.filter(Movie.release_date >= from_date)
        if to_date:
            movies_q = movies_q.filter(Movie.release_date <= to_date)
        movies = movies_q.all()
        for movie in movies:
            serialized = serialize_movie_calendar(movie)
            if watched_filter == "all":
                serialized["is_watched"] = movie.id in watched_movie_ids
            else:
                serialized["is_watched"] = watched_filter == "watched"
            movies_result.append(serialized)

    return {"shows": tv_result, "movies": movies_result}
