# app/services/user_service.py
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func, literal
from datetime import datetime, timezone
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.watched import Watched
from app.models.movie import Movie
from app.models.show import Show
from app.models.block import Block


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
        created_at=datetime.now(timezone.utc),
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
    return db.get(User, user_id)


def update_user_email(db: Session, user_id: str, new_email: str):
    """
    Update the email of a user.
    """
    user = db.get(User, user_id)
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

    user = db.get(User, user_id)
    if not user:
        return None

    user.username = new_username
    db.commit()
    db.refresh(user)
    return user


def update_avatar_key(db: Session, user_id: str, avatar_key: str | None):
    user = db.get(User, user_id)
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
    movie_q = (
        db.query(
            literal("movie").label("type"),
            Movie.id,
            Movie.title.label("display_name"),
            Movie.poster_path,
            Watchlist.added_at,
            func.count(Movie.id).over().label("total"),
        )
        .join(Watchlist, and_(
            Watchlist.content_id == Movie.id,
            Watchlist.content_type == "movie",
            Watchlist.user_id == user_id,
        ))
        .order_by(Watchlist.added_at.desc())
        .limit(limit)
    )
    show_q = (
        db.query(
            literal("tv").label("type"),
            Show.id,
            Show.name.label("display_name"),
            Show.poster_path,
            Watchlist.added_at,
            func.count(Show.id).over().label("total"),
        )
        .join(Watchlist, and_(
            Watchlist.content_id == Show.id,
            Watchlist.content_type == "tv",
            Watchlist.user_id == user_id,
        ))
        .order_by(Watchlist.added_at.desc())
        .limit(limit)
    )
    movie_rows = movie_q.all()
    show_rows = show_q.all()
    return {
        "movies": [{"id": r.id, "title": r.display_name, "poster_path": r.poster_path, "added_at": r.added_at} for r in movie_rows],
        "shows": [{"id": r.id, "name": r.display_name, "poster_path": r.poster_path, "added_at": r.added_at} for r in show_rows],
        "total_movies": movie_rows[0].total if movie_rows else 0,
        "total_shows": show_rows[0].total if show_rows else 0,
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
    movie_q = (
        db.query(
            literal("movie").label("type"),
            Movie.id,
            Movie.title.label("display_name"),
            Movie.poster_path,
            Watched.watched_at,
            func.count(Movie.id).over().label("total"),
        )
        .join(Watched, and_(
            Watched.content_id == Movie.id,
            Watched.content_type == "movie",
            Watched.user_id == user_id,
        ))
        .order_by(Watched.watched_at.desc())
        .limit(limit)
    )
    show_q = (
        db.query(
            literal("tv").label("type"),
            Show.id,
            Show.name.label("display_name"),
            Show.poster_path,
            Watched.watched_at,
            func.count(Show.id).over().label("total"),
        )
        .join(Watched, and_(
            Watched.content_id == Show.id,
            Watched.content_type == "tv",
            Watched.user_id == user_id,
        ))
        .order_by(Watched.watched_at.desc())
        .limit(limit)
    )
    movie_rows = movie_q.all()
    show_rows = show_q.all()
    return {
        "movies": [{"id": r.id, "title": r.display_name, "poster_path": r.poster_path, "watched_at": r.watched_at} for r in movie_rows],
        "shows": [{"id": r.id, "name": r.display_name, "poster_path": r.poster_path, "watched_at": r.watched_at} for r in show_rows],
        "total_movies": movie_rows[0].total if movie_rows else 0,
        "total_shows": show_rows[0].total if show_rows else 0,
    }


def search_users_by_username(
    db: Session, query: str, current_user_id: str, limit: int = 10
):
    """
    Search users by partial username match, excluding the current user and any blocked relationships.
    """
    blocked_subquery = db.query(Block.blocked_id).filter(Block.blocker_id == current_user_id)
    blocker_subquery = db.query(Block.blocker_id).filter(Block.blocked_id == current_user_id)
    return (
        db.query(User)
        .filter(
            User.username.ilike(f"%{query}%"),
            User.id != current_user_id,
            User.username.isnot(None),
            User.id.notin_(blocked_subquery),
            User.id.notin_(blocker_subquery),
        )
        .limit(limit)
        .all()
    )
