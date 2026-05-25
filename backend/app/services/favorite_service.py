from sqlalchemy.orm import Session
from sqlalchemy import and_, literal
from app.models.collection import Collection
from app.models.favorite import Favorite
from app.models.movie import Movie
from app.models.show import Show
from app.services.media_serializers import (
    serialize_movie_list,
    serialize_show_list,
    _movie_query_options_list,
    _show_query_options_list,
)


def get_favorites_preview(db: Session, user_id: str) -> dict:
    """Lightweight favorites for list/profile views — poster, title, id only. No selectinload."""
    movie_q = (
        db.query(literal("movie").label("type"), Movie.id, Movie.title.label("display_name"), Movie.poster_path)
        .select_from(Favorite)
        .join(Movie, and_(
            Favorite.content_id == Movie.id,
            Favorite.content_type == "movie",
            Favorite.user_id == user_id,
        ))
    )
    show_q = (
        db.query(literal("tv").label("type"), Show.id, Show.name.label("display_name"), Show.poster_path)
        .select_from(Favorite)
        .join(Show, and_(
            Favorite.content_id == Show.id,
            Favorite.content_type == "tv",
            Favorite.user_id == user_id,
        ))
    )
    rows = movie_q.union_all(show_q).all()
    return {
        "movies": [{"id": r.id, "title": r.display_name, "poster_path": r.poster_path} for r in rows if r.type == "movie"],
        "shows": [{"id": r.id, "name": r.display_name, "poster_path": r.poster_path} for r in rows if r.type == "tv"],
    }


def add_to_favorites(db: Session, user_id: str, content_type: str, content_id: int):
    existing = (
        db.query(Favorite)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if existing:
        return existing

    entry = Favorite(user_id=user_id, content_type=content_type, content_id=content_id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def remove_from_favorites(
    db: Session, user_id: str, content_type: str, content_id: int
):
    entry = (
        db.query(Favorite)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if not entry:
        return {"message": "Item not found in favorites"}
    db.delete(entry)
    db.commit()
    return {"message": "Removed from favorites"}


def get_favorites(db: Session, user_id: str):
    movies = (
        db.query(Movie)
        .options(*_movie_query_options_list())
        .select_from(Favorite)
        .join(
            Movie,
            and_(
                Favorite.content_id == Movie.id,
                Favorite.content_type == "movie",
                Favorite.user_id == user_id,
            ),
        )
        .all()
    )
    shows = (
        db.query(Show)
        .options(*_show_query_options_list())
        .select_from(Favorite)
        .join(
            Show,
            and_(
                Favorite.content_id == Show.id,
                Favorite.content_type == "tv",
                Favorite.user_id == user_id,
            ),
        )
        .all()
    )
    collections = (
        db.query(Collection)
        .select_from(Favorite)
        .join(
            Collection,
            and_(
                Favorite.content_id == Collection.id,
                Favorite.content_type == "collection",
                Favorite.user_id == user_id,
            ),
        )
        .all()
    )
    return {
        "movies": [serialize_movie_list(m) for m in movies],
        "shows": [serialize_show_list(s) for s in shows],
        "collections": [
            {
                "id": c.id,
                "name": c.name,
                "poster_path": c.poster_path,
                "backdrop_path": c.backdrop_path,
            }
            for c in collections
        ],
    }


def is_favorited(db: Session, user_id: str, content_type: str, content_id: int) -> bool:
    return (
        db.query(Favorite)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    ) is not None
