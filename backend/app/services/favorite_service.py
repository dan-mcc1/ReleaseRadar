from sqlalchemy.orm import Session
from sqlalchemy import and_
from app.models.favorite import Favorite
from app.models.movie import Movie
from app.models.show import Show
from app.services.watchlist_service import (
    serialize_movie_list,
    serialize_show_list,
    _movie_query_options_list,
    _show_query_options_list,
)


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


def remove_from_favorites(db: Session, user_id: str, content_type: str, content_id: int):
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
    return {
        "movies": [serialize_movie_list(m) for m in movies],
        "shows": [serialize_show_list(s) for s in shows],
    }


def is_favorited(db: Session, user_id: str, content_type: str, content_id: int) -> bool:
    return (
        db.query(Favorite)
        .filter_by(user_id=user_id, content_type=content_type, content_id=content_id)
        .first()
    ) is not None
