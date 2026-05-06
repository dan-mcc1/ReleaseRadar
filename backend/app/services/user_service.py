# app/services/user_service.py
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import datetime
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.watched import Watched
from app.models.movie import Movie
from app.models.show import Show


def create_user(
    db: Session,
    user_id: str,
    email: str = None,
    username: str = None,
    avatar_key: str = None,
):
    """
    Create a user in the database if they don't exist.
    """
    existing = db.query(User).filter_by(id=user_id).first()
    if existing:
        return existing

    db_user = User(
        id=user_id,
        email=email,
        username=username,
        created_at=datetime.utcnow(),
        avatar_key=avatar_key,
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def get_user(db: Session, user_id: str):
    """
    Get a user by ID.
    """
    return db.query(User).filter_by(id=user_id).first()


def update_user_email(db: Session, user_id: str, new_email: str):
    """
    Update the email of a user.
    """
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        return None

    user.email = new_email
    db.commit()
    db.refresh(user)
    return user


def update_username(db: Session, user_id: str, new_username: str):
    """
    Set or update the username of a user. Returns None if username is taken.
    """
    taken = (
        db.query(User).filter(User.username == new_username, User.id != user_id).first()
    )
    if taken:
        return None

    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        return None

    user.username = new_username
    db.commit()
    db.refresh(user)
    return user


def update_avatar_key(db: Session, user_id: str, avatar_key: str | None):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        return None
    user.avatar_key = avatar_key
    db.commit()
    db.refresh(user)
    return user


def is_username_available(db: Session, username: str) -> bool:
    """
    Check whether a username is available.
    """
    return db.query(User).filter(User.username == username).first() is None


def get_profile_watchlist(db: Session, user_id: str) -> dict:
    """
    Return a user's watchlist sorted by most recently added.
    Returns lightweight objects (id, title/name, poster_path, added_at) only.
    """
    movies = (
        db.query(Movie.id, Movie.title, Movie.poster_path, Watchlist.added_at)
        .join(
            Watchlist,
            and_(
                Watchlist.content_id == Movie.id,
                Watchlist.content_type == "movie",
                Watchlist.user_id == user_id,
            ),
        )
        .order_by(Watchlist.added_at.desc())
        .all()
    )
    shows = (
        db.query(Show.id, Show.name, Show.poster_path, Watchlist.added_at)
        .join(
            Watchlist,
            and_(
                Watchlist.content_id == Show.id,
                Watchlist.content_type == "tv",
                Watchlist.user_id == user_id,
            ),
        )
        .order_by(Watchlist.added_at.desc())
        .all()
    )
    return {
        "movies": [
            {
                "id": r.id,
                "title": r.title,
                "poster_path": r.poster_path,
                "added_at": r.added_at,
            }
            for r in movies
        ],
        "shows": [
            {
                "id": r.id,
                "name": r.name,
                "poster_path": r.poster_path,
                "added_at": r.added_at,
            }
            for r in shows
        ],
    }


def get_profile_watchlist_preview(db: Session, user_id: str, limit: int = 5) -> dict:
    """
    Return a preview of a user's watchlist with limited items and total counts.
    Returns lightweight objects (id, title/name, poster_path, added_at) only.
    """
    total_movies = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type="movie")
        .count()
    )
    total_shows = (
        db.query(Watchlist)
        .filter_by(user_id=user_id, content_type="tv")
        .count()
    )
    movies = (
        db.query(Movie.id, Movie.title, Movie.poster_path, Watchlist.added_at)
        .join(
            Watchlist,
            and_(
                Watchlist.content_id == Movie.id,
                Watchlist.content_type == "movie",
                Watchlist.user_id == user_id,
            ),
        )
        .order_by(Watchlist.added_at.desc())
        .limit(limit)
        .all()
    )
    shows = (
        db.query(Show.id, Show.name, Show.poster_path, Watchlist.added_at)
        .join(
            Watchlist,
            and_(
                Watchlist.content_id == Show.id,
                Watchlist.content_type == "tv",
                Watchlist.user_id == user_id,
            ),
        )
        .order_by(Watchlist.added_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "movies": [
            {
                "id": r.id,
                "title": r.title,
                "poster_path": r.poster_path,
                "added_at": r.added_at,
            }
            for r in movies
        ],
        "shows": [
            {
                "id": r.id,
                "name": r.name,
                "poster_path": r.poster_path,
                "added_at": r.added_at,
            }
            for r in shows
        ],
        "total_movies": total_movies,
        "total_shows": total_shows,
    }


def get_profile_watched(db: Session, user_id: str) -> dict:
    """
    Return a user's watched list sorted by most recently watched.
    Returns lightweight objects (id, title/name, poster_path, watched_at) only.
    """
    movies = (
        db.query(Movie.id, Movie.title, Movie.poster_path, Watched.watched_at)
        .join(
            Watched,
            and_(
                Watched.content_id == Movie.id,
                Watched.content_type == "movie",
                Watched.user_id == user_id,
            ),
        )
        .order_by(Watched.watched_at.desc())
        .all()
    )
    shows = (
        db.query(Show.id, Show.name, Show.poster_path, Watched.watched_at)
        .join(
            Watched,
            and_(
                Watched.content_id == Show.id,
                Watched.content_type == "tv",
                Watched.user_id == user_id,
            ),
        )
        .order_by(Watched.watched_at.desc())
        .all()
    )
    return {
        "movies": [
            {
                "id": r.id,
                "title": r.title,
                "poster_path": r.poster_path,
                "watched_at": r.watched_at,
            }
            for r in movies
        ],
        "shows": [
            {
                "id": r.id,
                "name": r.name,
                "poster_path": r.poster_path,
                "watched_at": r.watched_at,
            }
            for r in shows
        ],
    }


def get_profile_watched_preview(db: Session, user_id: str, limit: int = 5) -> dict:
    """
    Return a preview of a user's watched list with limited items and total counts.
    Returns lightweight objects (id, title/name, poster_path, watched_at) only.
    """
    total_movies = (
        db.query(Watched)
        .filter_by(user_id=user_id, content_type="movie")
        .count()
    )
    total_shows = (
        db.query(Watched)
        .filter_by(user_id=user_id, content_type="tv")
        .count()
    )
    movies = (
        db.query(Movie.id, Movie.title, Movie.poster_path, Watched.watched_at)
        .join(
            Watched,
            and_(
                Watched.content_id == Movie.id,
                Watched.content_type == "movie",
                Watched.user_id == user_id,
            ),
        )
        .order_by(Watched.watched_at.desc())
        .limit(limit)
        .all()
    )
    shows = (
        db.query(Show.id, Show.name, Show.poster_path, Watched.watched_at)
        .join(
            Watched,
            and_(
                Watched.content_id == Show.id,
                Watched.content_type == "tv",
                Watched.user_id == user_id,
            ),
        )
        .order_by(Watched.watched_at.desc())
        .limit(limit)
        .all()
    )
    return {
        "movies": [
            {
                "id": r.id,
                "title": r.title,
                "poster_path": r.poster_path,
                "watched_at": r.watched_at,
            }
            for r in movies
        ],
        "shows": [
            {
                "id": r.id,
                "name": r.name,
                "poster_path": r.poster_path,
                "watched_at": r.watched_at,
            }
            for r in shows
        ],
        "total_movies": total_movies,
        "total_shows": total_shows,
    }


def search_users_by_username(
    db: Session, query: str, current_user_id: str, limit: int = 10
):
    """
    Search users by partial username match, excluding the current user.
    """
    return (
        db.query(User)
        .filter(
            User.username.ilike(f"%{query}%"),
            User.id != current_user_id,
            User.username.isnot(None),
        )
        .limit(limit)
        .all()
    )
