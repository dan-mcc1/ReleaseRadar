from sqlalchemy.orm import Session
from sqlalchemy import and_
from fastapi import HTTPException
from app.models.shelf import Shelf
from app.models.shelf_item import ShelfItem
from app.models.show import Show
from app.models.movie import Movie
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.watched import Watched
from app.services.watchlist_service import (
    ensure_show_in_db,
    ensure_movie_in_db,
    serialize_show_list,
    serialize_movie_list,
    serialize_movie,
    _show_query_options_list,
    _movie_query_options_list,
    _show_query_options,
    _movie_query_options,
    serialize_show,
)
from collections import defaultdict

def _assert_shelf_owned(db: Session, user_id: str, shelf_id: int) -> Shelf:
    shelf = db.query(Shelf).filter_by(id=shelf_id, user_id=user_id).first()
    if not shelf:
        raise HTTPException(status_code=404, detail="Shelf not found")
    return shelf


def create_shelf(db: Session, user_id: str, name: str, description: str | None) -> Shelf:
    shelf = Shelf(user_id=user_id, name=name, description=description)
    db.add(shelf)
    db.commit()
    db.refresh(shelf)
    return shelf


def get_user_shelves(db: Session, user_id: str) -> list[dict]:
    shelves = db.query(Shelf).filter_by(user_id=user_id).order_by(Shelf.created_at).all()
    result = []
    for shelf in shelves:
        item_count = db.query(ShelfItem).filter_by(shelf_id=shelf.id).count()
        result.append({
            "id": shelf.id,
            "name": shelf.name,
            "description": shelf.description,
            "created_at": shelf.created_at.isoformat() if shelf.created_at else None,
            "item_count": item_count,
            "notify": shelf.notify,
        })
    return result


def update_shelf(
    db: Session, user_id: str, shelf_id: int, name: str | None, description: str | None
) -> Shelf:
    shelf = _assert_shelf_owned(db, user_id, shelf_id)
    if name is not None:
        shelf.name = name
    if description is not None:
        shelf.description = description
    db.commit()
    db.refresh(shelf)
    return shelf


def delete_shelf(db: Session, user_id: str, shelf_id: int) -> None:
    shelf = _assert_shelf_owned(db, user_id, shelf_id)
    db.delete(shelf)
    db.commit()


def add_to_shelf(
    db: Session, user_id: str, shelf_id: int, content_type: str, content_id: int
) -> ShelfItem:
    _assert_shelf_owned(db, user_id, shelf_id)

    existing = (
        db.query(ShelfItem)
        .filter_by(shelf_id=shelf_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if existing:
        return existing

    # Ensure media row exists in DB (does not increment tracking_count — shelves are independent)
    if content_type == "movie":
        ensure_movie_in_db(db, content_id, already_tracked=True)
    elif content_type == "tv":
        ensure_show_in_db(db, content_id, already_tracked=True)
    else:
        raise HTTPException(status_code=400, detail="content_type must be 'movie' or 'tv'")

    item = ShelfItem(
        shelf_id=shelf_id,
        user_id=user_id,
        content_type=content_type,
        content_id=content_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def remove_from_shelf(
    db: Session, user_id: str, shelf_id: int, content_type: str, content_id: int
) -> None:
    _assert_shelf_owned(db, user_id, shelf_id)
    item = (
        db.query(ShelfItem)
        .filter_by(shelf_id=shelf_id, content_type=content_type, content_id=content_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not on shelf")
    db.delete(item)
    db.commit()


def get_shelf_items(db: Session, user_id: str, shelf_id: int) -> dict:
    _assert_shelf_owned(db, user_id, shelf_id)

    movie_items = (
        db.query(Movie, ShelfItem.added_at)
        .options(*_movie_query_options_list())
        .join(ShelfItem, and_(ShelfItem.content_id == Movie.id, ShelfItem.content_type == "movie"))
        .filter(ShelfItem.shelf_id == shelf_id)
        .all()
    )
    show_items = (
        db.query(Show, ShelfItem.added_at)
        .options(*_show_query_options_list())
        .join(ShelfItem, and_(ShelfItem.content_id == Show.id, ShelfItem.content_type == "tv"))
        .filter(ShelfItem.shelf_id == shelf_id)
        .all()
    )

    movies = [
        {**serialize_movie_list(m), "added_at": added_at.isoformat() if added_at else None}
        for m, added_at in movie_items
    ]
    shows = [
        {**serialize_show_list(s), "added_at": added_at.isoformat() if added_at else None}
        for s, added_at in show_items
    ]
    return {"movies": movies, "shows": shows}


def get_shelf_calendar(
    db: Session,
    user_id: str,
    shelf_id: int,
    from_date: str | None = None,
    to_date: str | None = None,
) -> dict:
    _assert_shelf_owned(db, user_id, shelf_id)

    shelf_items = db.query(ShelfItem).filter_by(shelf_id=shelf_id).all()
    show_ids = [item.content_id for item in shelf_items if item.content_type == "tv"]
    movie_ids = [item.content_id for item in shelf_items if item.content_type == "movie"]

    # ── TV shows ──────────────────────────────────────────────────────────────
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
            .filter(EpisodeWatched.user_id == user_id, EpisodeWatched.show_id.in_(show_ids))
            .all()
        }

        eps_by_show: dict[int, list] = defaultdict(list)
        for ep in episodes:
            eps_by_show[ep.show_id].append({
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
                "is_watched": (ep.show_id, ep.season_number, ep.episode_number) in watched_ep_keys,
            })

        filtering = bool(from_date or to_date)
        tv_result = [
            {"show": serialize_show(show), "episodes": eps_by_show[show.id]}
            for show in shows
            if not filtering or eps_by_show[show.id]
        ]

    # ── Movies ────────────────────────────────────────────────────────────────
    movies_result = []
    if movie_ids:
        watched_movie_ids = {
            row.content_id
            for row in db.query(Watched.content_id)
            .filter(Watched.user_id == user_id, Watched.content_type == "movie", Watched.content_id.in_(movie_ids))
            .all()
        }
        movies = (
            db.query(Movie)
            .options(*_movie_query_options())
            .filter(Movie.id.in_(movie_ids))
            .all()
        )
        for movie in movies:
            # Apply date filter to release_date when dates are provided
            if from_date and movie.release_date and str(movie.release_date) < from_date:
                continue
            if to_date and movie.release_date and str(movie.release_date) > to_date:
                continue
            serialized = serialize_movie(movie)
            serialized["is_watched"] = movie.id in watched_movie_ids
            movies_result.append(serialized)

    return {"shows": tv_result, "movies": movies_result}


def get_shelves_for_item(
    db: Session, user_id: str, content_type: str, content_id: int
) -> list[int]:
    """Return shelf IDs that contain the given item for this user."""
    rows = (
        db.query(ShelfItem.shelf_id)
        .join(Shelf, Shelf.id == ShelfItem.shelf_id)
        .filter(
            Shelf.user_id == user_id,
            ShelfItem.content_type == content_type,
            ShelfItem.content_id == content_id,
        )
        .all()
    )
    return [row.shelf_id for row in rows]
