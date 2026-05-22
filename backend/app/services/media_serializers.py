# app/services/media_serializers.py
from sqlalchemy.orm import selectinload
from app.models.show import Show
from app.models.movie import Movie
from app.models.provider import ShowProvider, MovieProvider
from app.services.provider_utils import canonical_provider_id, canonical_provider_name


def serialize_providers(junction_rows):
    """
    Convert ShowProvider/MovieProvider rows into the
    {flatrate: [...], rent: [...], buy: [...]} shape the frontend expects.
    Provider variants (e.g. "Netflix basic with ads") are collapsed to their
    canonical entry so duplicates never reach the frontend.
    """
    sections: dict[str, dict[int, dict]] = {}
    for row in junction_rows:
        p = row.provider
        cpid = canonical_provider_id(p.id)
        entry = {
            "provider_id": cpid,
            "provider_name": canonical_provider_name(p.id, p.name),
            "logo_path": p.logo_path,
        }
        for ptype in ("flatrate", "rent", "buy"):
            if getattr(row, ptype):
                section = sections.setdefault(ptype, {})
                if cpid not in section or p.id == cpid:
                    section[cpid] = entry
    result = {ptype: list(entries.values()) for ptype, entries in sections.items()}
    return result or None


def serialize_season(s):
    return {
        "id": s.id,
        "season_number": s.season_number,
        "name": s.name,
        "overview": s.overview,
        "air_date": str(s.air_date) if s.air_date else None,
        "episode_count": s.episode_count,
        "poster_path": s.poster_path,
        "vote_average": s.vote_average,
    }


def serialize_show(show):
    return {
        "id": show.id,
        "name": show.name,
        "backdrop_path": show.backdrop_path,
        "logo_path": show.logo_path,
        "first_air_date": show.first_air_date,
        "last_air_date": show.last_air_date,
        "homepage": show.homepage,
        "in_production": show.in_production,
        "number_of_seasons": show.number_of_seasons,
        "number_of_episodes": show.number_of_episodes,
        "overview": show.overview,
        "poster_path": show.poster_path,
        "status": show.status,
        "tagline": show.tagline,
        "type": show.type,
        "tracking_count": show.tracking_count,
        "air_time": show.air_time,
        "air_timezone": show.air_timezone,
        "vote_average": show.vote_average,
        "certification": show.certification,
        "seasons": [serialize_season(s) for s in show.seasons],
        "genres": [{"id": g.id, "name": g.name} for g in show.genres],
        "providers": serialize_providers(show.show_providers),
    }


def serialize_movie(movie):
    return {
        "id": movie.id,
        "imdb_id": movie.imdb_id,
        "backdrop_path": movie.backdrop_path,
        "logo_path": movie.logo_path,
        "budget": movie.budget,
        "homepage": movie.homepage,
        "overview": movie.overview,
        "tagline": movie.tagline,
        "poster_path": movie.poster_path,
        "release_date": movie.release_date,
        "revenue": movie.revenue,
        "runtime": movie.runtime,
        "status": movie.status,
        "title": movie.title,
        "tracking_count": movie.tracking_count,
        "vote_average": movie.vote_average,
        "certification": movie.certification,
        "genres": [{"id": g.id, "name": g.name} for g in movie.genres],
        "providers": serialize_providers(movie.movie_providers),
    }


def serialize_show_calendar(show):
    """Minimal show shape for calendar views — only fields rendered by calendar components."""
    return {
        "id": show.id,
        "name": show.name,
        "poster_path": show.poster_path,
        "backdrop_path": show.backdrop_path,
        "logo_path": show.logo_path,
        "air_time": show.air_time,
        "air_timezone": show.air_timezone,
    }


def serialize_movie_calendar(movie):
    """Minimal movie shape for calendar views — scalar columns only, no JOINs needed."""
    return {
        "id": movie.id,
        "title": movie.title,
        "overview": movie.overview,
        "poster_path": movie.poster_path,
        "backdrop_path": movie.backdrop_path,
        "logo_path": movie.logo_path,
        "release_date": movie.release_date,
        "runtime": movie.runtime,
        "status": movie.status,
        "vote_average": movie.vote_average,
    }


def serialize_show_list(show):
    """Serialize a show for list views — omits full season/provider detail."""
    return {
        "id": show.id,
        "name": show.name,
        "backdrop_path": show.backdrop_path,
        "logo_path": show.logo_path,
        "first_air_date": show.first_air_date,
        "last_air_date": show.last_air_date,
        "in_production": show.in_production,
        "number_of_seasons": show.number_of_seasons,
        "number_of_episodes": show.number_of_episodes,
        "overview": show.overview,
        "poster_path": show.poster_path,
        "status": show.status,
        "tracking_count": show.tracking_count,
        "vote_average": show.vote_average,
        "certification": show.certification,
        "genres": [{"id": g.id, "name": g.name} for g in show.genres],
        "flatrate_provider_ids": [sp.provider_id for sp in show.show_providers if sp.flatrate],
    }


def serialize_movie_list(movie):
    """Serialize a movie for list views — omits full provider detail."""
    return {
        "id": movie.id,
        "backdrop_path": movie.backdrop_path,
        "logo_path": movie.logo_path,
        "overview": movie.overview,
        "poster_path": movie.poster_path,
        "release_date": movie.release_date,
        "runtime": movie.runtime,
        "status": movie.status,
        "title": movie.title,
        "tracking_count": movie.tracking_count,
        "vote_average": movie.vote_average,
        "certification": movie.certification,
        "genres": [{"id": g.id, "name": g.name} for g in movie.genres],
        "flatrate_provider_ids": [mp.provider_id for mp in movie.movie_providers if mp.flatrate],
    }


def _show_query_options():
    """Full show relationships — for detail pages."""
    return [
        selectinload(Show.seasons),
        selectinload(Show.genres),
        selectinload(Show.show_providers).selectinload(ShowProvider.provider),
    ]


def _movie_query_options():
    """Full movie relationships — for detail pages."""
    return [
        selectinload(Movie.genres),
        selectinload(Movie.movie_providers).selectinload(MovieProvider.provider),
    ]


def _show_query_options_list():
    """Lightweight show options for list views — genres and flatrate provider IDs only."""
    return [
        selectinload(Show.genres),
        selectinload(Show.show_providers),
    ]


def _movie_query_options_list():
    """Lightweight movie options for list views — genres and flatrate provider IDs only."""
    return [
        selectinload(Movie.genres),
        selectinload(Movie.movie_providers),
    ]
