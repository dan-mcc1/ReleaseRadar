"""Collection helpers.

Local CollectionMovie + Movie rows are the source of truth for browse,
search, stats, status, and rankings. /collections/{id} detail is still a
TMDb passthrough until the backfill finishes.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from sqlalchemy import and_, case, distinct, func, select
from sqlalchemy.orm import Session

from app.models.collection import Collection, CollectionMovie
from app.models.favorite import Favorite
from app.models.genre import Genre, MovieGenre
from app.models.movie import Movie
from app.models.user_collection_ranking import UserCollectionRanking
from app.models.watched import Watched
from app.services.tmdb_collections import get_collection as tmdb_get_collection


# ---------------------------------------------------------------------------
# Detail (still TMDb passthrough)
# ---------------------------------------------------------------------------


def get_collection_detail(collection_id: int) -> dict | None:
    return tmdb_get_collection(collection_id) or None


def _part_ids_from_db(db: Session, collection_id: int) -> list[int]:
    return [
        row[0]
        for row in db.execute(
            select(CollectionMovie.movie_id).where(
                CollectionMovie.collection_id == collection_id
            )
        ).all()
    ]


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


def search_collections(db: Session, query: str, limit: int = 25) -> list[Collection]:
    if not query.strip():
        return []
    pattern = f"%{query.strip()}%"
    return (
        db.query(Collection)
        .filter(Collection.name.ilike(pattern))
        .order_by(Collection.name.asc())
        .limit(limit)
        .all()
    )


# ---------------------------------------------------------------------------
# Stats (per-collection aggregate)
# ---------------------------------------------------------------------------


def get_collection_stats(db: Session, collection_id: int) -> dict | None:
    """Aggregate stats across the collection's movies."""
    if db.get(Collection, collection_id) is None:
        return None

    # Single grouped query for all numeric aggregates. Avg/total skip 0/null
    # values for budget/revenue since TMDb stores 0 for "unknown".
    nonzero_budget = case((Movie.budget > 0, Movie.budget), else_=None)
    nonzero_revenue = case((Movie.revenue > 0, Movie.revenue), else_=None)
    nonzero_rating = case((Movie.vote_average > 0, Movie.vote_average), else_=None)

    row = db.execute(
        select(
            func.count(Movie.id).label("count"),
            func.avg(nonzero_rating).label("avg_rating"),
            func.max(nonzero_rating).label("highest_rating"),
            func.min(nonzero_rating).label("lowest_rating"),
            func.avg(Movie.runtime).label("avg_runtime"),
            func.sum(Movie.runtime).label("total_runtime"),
            func.avg(nonzero_budget).label("avg_budget"),
            func.sum(nonzero_budget).label("total_budget"),
            func.avg(nonzero_revenue).label("avg_revenue"),
            func.sum(nonzero_revenue).label("total_revenue"),
            func.min(func.extract("year", Movie.release_date)).label("min_year"),
            func.max(func.extract("year", Movie.release_date)).label("max_year"),
        )
        .select_from(CollectionMovie)
        .join(Movie, Movie.id == CollectionMovie.movie_id)
        .where(CollectionMovie.collection_id == collection_id)
    ).one()

    # Genre counts: how often each genre appears across the parts.
    genre_rows = db.execute(
        select(
            Genre.id,
            Genre.name,
            func.count(MovieGenre.movie_id).label("count"),
        )
        .select_from(CollectionMovie)
        .join(MovieGenre, MovieGenre.movie_id == CollectionMovie.movie_id)
        .join(Genre, Genre.id == MovieGenre.genre_id)
        .where(CollectionMovie.collection_id == collection_id)
        .group_by(Genre.id, Genre.name)
        .order_by(func.count(MovieGenre.movie_id).desc(), Genre.name.asc())
    ).all()

    return {
        "collection_id": collection_id,
        "count": int(row.count or 0),
        "avg_rating": float(row.avg_rating) if row.avg_rating is not None else None,
        "highest_rating": float(row.highest_rating) if row.highest_rating is not None else None,
        "lowest_rating": float(row.lowest_rating) if row.lowest_rating is not None else None,
        "avg_runtime": float(row.avg_runtime) if row.avg_runtime is not None else None,
        "total_runtime": int(row.total_runtime) if row.total_runtime is not None else None,
        "avg_budget": float(row.avg_budget) if row.avg_budget is not None else None,
        "total_budget": float(row.total_budget) if row.total_budget is not None else None,
        "avg_revenue": float(row.avg_revenue) if row.avg_revenue is not None else None,
        "total_revenue": float(row.total_revenue) if row.total_revenue is not None else None,
        "min_year": int(row.min_year) if row.min_year is not None else None,
        "max_year": int(row.max_year) if row.max_year is not None else None,
        "genres": [
            {"id": g.id, "name": g.name, "count": int(g.count)} for g in genre_rows
        ],
    }


# ---------------------------------------------------------------------------
# Watch status (DB-backed)
# ---------------------------------------------------------------------------


def get_watch_status_bulk(
    db: Session, user_id: str, collection_ids: list[int]
) -> dict[int, dict]:
    """Return per-collection progress for many collections in a single query.

    Result shape: { <collection_id>: {total_parts, released_parts, watched_parts, finished} }
    Collection IDs not present in the DB are simply omitted from the result.
    """
    if not collection_ids:
        return {}
    today = date.today()
    rows = db.execute(
        select(
            CollectionMovie.collection_id.label("cid"),
            func.count().label("total"),
            func.sum(
                case((Movie.release_date <= today, 1), else_=0)
            ).label("released"),
            func.sum(
                case((Watched.content_id.isnot(None), 1), else_=0)
            ).label("watched"),
        )
        .join(Movie, Movie.id == CollectionMovie.movie_id, isouter=True)
        .join(
            Watched,
            and_(
                Watched.user_id == user_id,
                Watched.content_type == "movie",
                Watched.content_id == CollectionMovie.movie_id,
            ),
            isouter=True,
        )
        .where(CollectionMovie.collection_id.in_(collection_ids))
        .group_by(CollectionMovie.collection_id)
    ).all()

    out: dict[int, dict] = {}
    for r in rows:
        total = int(r.total or 0)
        released = int(r.released or 0)
        watched = int(r.watched or 0)
        # A collection is "finished" only if there's at least one released part
        # AND every released part has been watched.
        finished = released > 0 and watched >= released
        out[int(r.cid)] = {
            "total_parts": total,
            "released_parts": released,
            "watched_parts": watched,
            "finished": finished,
        }
    return out


def get_watch_status(db: Session, user_id: str, collection_id: int) -> dict | None:
    if db.get(Collection, collection_id) is None:
        return None

    rows = db.execute(
        select(CollectionMovie.movie_id, Movie.release_date)
        .join(Movie, Movie.id == CollectionMovie.movie_id, isouter=True)
        .where(CollectionMovie.collection_id == collection_id)
    ).all()

    part_ids = [r[0] for r in rows]
    today = date.today()
    released_ids = [r[0] for r in rows if r[1] is not None and r[1] <= today]

    watched_ids: set[int] = set()
    if part_ids:
        watched_ids = {
            row[0]
            for row in db.execute(
                select(Watched.content_id).where(
                    and_(
                        Watched.user_id == user_id,
                        Watched.content_type == "movie",
                        Watched.content_id.in_(part_ids),
                    )
                )
            ).all()
        }

    finished = len(released_ids) > 0 and all(mid in watched_ids for mid in released_ids)
    return {
        "collection_id": collection_id,
        "total_parts": len(part_ids),
        "released_parts": len(released_ids),
        "watched_parts": len(watched_ids),
        "finished": finished,
        "watched_movie_ids": sorted(watched_ids),
    }


# ---------------------------------------------------------------------------
# Rankings (DB-backed validation)
# ---------------------------------------------------------------------------


def get_rankings(db: Session, user_id: str, collection_id: int) -> list[dict]:
    rows = (
        db.query(UserCollectionRanking)
        .filter_by(user_id=user_id, collection_id=collection_id)
        .order_by(UserCollectionRanking.rank.asc())
        .all()
    )
    return [{"movie_id": r.movie_id, "rank": r.rank} for r in rows]


def set_rankings(
    db: Session,
    user_id: str,
    collection_id: int,
    ordered_movie_ids: list[int],
) -> list[dict]:
    if db.get(Collection, collection_id) is None:
        raise ValueError("collection_not_found")

    valid_ids = set(_part_ids_from_db(db, collection_id))
    for mid in ordered_movie_ids:
        if mid not in valid_ids:
            raise ValueError(f"movie_{mid}_not_in_collection")

    db.query(UserCollectionRanking).filter_by(
        user_id=user_id, collection_id=collection_id
    ).delete()
    for rank, mid in enumerate(ordered_movie_ids, start=1):
        db.add(
            UserCollectionRanking(
                user_id=user_id,
                collection_id=collection_id,
                movie_id=mid,
                rank=rank,
            )
        )
    db.commit()
    return get_rankings(db, user_id, collection_id)


# ---------------------------------------------------------------------------
# Browse — with filters + aggregate sort
# ---------------------------------------------------------------------------

SortKey = Literal["name", "size", "rating", "popularity", "earliest", "latest"]


def list_genres_in_collections(db: Session) -> list[dict]:
    """Distinct genres that appear across all collection parts. Drives the
    genre filter dropdown on the browse page."""
    rows = db.execute(
        select(Genre.id, Genre.name, func.count(distinct(CollectionMovie.collection_id)).label("collections"))
        .select_from(Genre)
        .join(MovieGenre, MovieGenre.genre_id == Genre.id)
        .join(CollectionMovie, CollectionMovie.movie_id == MovieGenre.movie_id)
        .group_by(Genre.id, Genre.name)
        .order_by(Genre.name.asc())
    ).all()
    return [
        {"id": g.id, "name": g.name, "collection_count": int(g.collections)}
        for g in rows
    ]


def get_user_collection_overview(db: Session, user_id: str) -> dict:
    """Return the user's collections bucketed into favorites, finished, and
    in_progress. A collection is "finished" iff every released part is
    watched; "in_progress" iff at least one part is watched but not all of
    the released parts are."""
    today = date.today()

    # 1. Favorites — explicit user action.
    fav_rows = (
        db.query(Collection)
        .join(
            Favorite,
            and_(
                Favorite.content_type == "collection",
                Favorite.content_id == Collection.id,
                Favorite.user_id == user_id,
            ),
        )
        .order_by(Favorite.added_at.desc())
        .all()
    )

    # 2. Per-collection watch progress for every collection the user has
    #    touched (i.e. has at least one watched part in).
    watched_subq = (
        select(Watched.content_id)
        .where(
            and_(
                Watched.user_id == user_id,
                Watched.content_type == "movie",
            )
        )
        .subquery()
    )

    released_flag = case(
        (
            and_(Movie.release_date.isnot(None), Movie.release_date <= today),
            1,
        ),
        else_=0,
    )
    watched_released_flag = case(
        (
            and_(
                Movie.release_date.isnot(None),
                Movie.release_date <= today,
                watched_subq.c.content_id.isnot(None),
            ),
            1,
        ),
        else_=0,
    )

    progress_rows = db.execute(
        select(
            Collection,
            func.sum(released_flag).label("released"),
            func.sum(watched_released_flag).label("watched"),
        )
        .join(CollectionMovie, CollectionMovie.collection_id == Collection.id)
        .join(Movie, Movie.id == CollectionMovie.movie_id)
        .outerjoin(watched_subq, watched_subq.c.content_id == CollectionMovie.movie_id)
        .group_by(Collection.id)
        .having(func.sum(watched_released_flag) > 0)
    ).all()

    finished: list[dict] = []
    in_progress: list[dict] = []
    for c, released, watched in progress_rows:
        released = int(released or 0)
        watched = int(watched or 0)
        payload = {
            "id": c.id,
            "name": c.name,
            "poster_path": c.poster_path,
            "backdrop_path": c.backdrop_path,
            "released_parts": released,
            "watched_parts": watched,
        }
        if released > 0 and watched >= released:
            finished.append(payload)
        else:
            in_progress.append(payload)

    finished.sort(key=lambda c: c["name"].lower())
    in_progress.sort(key=lambda c: -c["watched_parts"] / max(c["released_parts"], 1))

    return {
        "favorites": [
            {
                "id": c.id,
                "name": c.name,
                "poster_path": c.poster_path,
                "backdrop_path": c.backdrop_path,
            }
            for c in fav_rows
        ],
        "finished": finished,
        "in_progress": in_progress,
    }


def browse_collections(
    db: Session,
    *,
    min_size: int | None = None,
    max_size: int | None = None,
    min_rating: float | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
    genre_id: int | None = None,
    sort: SortKey = "name",
    direction: str | None = None,
    page: int = 1,
    page_size: int = 30,
) -> dict:
    """Browse collections from denormalized columns — no aggregation at query time.

    Aggregates (size, avg_rating, min_year, max_year) are maintained on the
    `collection` row at ingest time, so this endpoint is just a paginated
    SELECT with a parallel COUNT against the same WHERE clause.
    """
    q = db.query(Collection)

    if genre_id is not None:
        # The only filter that still requires a join. A semi-join via EXISTS
        # is faster than the `IN (subquery)` form on Postgres because it
        # short-circuits after finding one matching part.
        q = q.filter(
            select(1)
            .select_from(CollectionMovie)
            .join(MovieGenre, MovieGenre.movie_id == CollectionMovie.movie_id)
            .where(
                CollectionMovie.collection_id == Collection.id,
                MovieGenre.genre_id == genre_id,
            )
            .exists()
        )

    if min_size is not None:
        q = q.filter(Collection.size >= min_size)
    if max_size is not None:
        q = q.filter(Collection.size <= max_size)
    if min_rating is not None:
        q = q.filter(Collection.avg_rating >= min_rating)
    if year_from is not None:
        q = q.filter(Collection.max_year >= year_from)
    if year_to is not None:
        q = q.filter(Collection.min_year <= year_to)

    # Count with the same WHERE clause but no ORDER BY / LIMIT. Postgres can
    # plan this as a simple index scan — much cheaper than wrapping the full
    # paginated query as a subquery (which is what SQLAlchemy's .count() does).
    total = q.with_entities(func.count(Collection.id)).scalar() or 0

    has_poster = Collection.poster_path.is_(None).asc()  # FALSE (has poster) first

    # Each sort key has a "natural" direction (e.g. names ascend A→Z, ratings
    # descend high→low). When the caller passes an explicit direction, override.
    natural_dir: dict[str, str] = {
        "name": "asc",
        "size": "desc",
        "rating": "desc",
        "popularity": "desc",
        "earliest": "asc",
        "latest": "desc",
    }
    effective_dir = direction or natural_dir.get(sort, "asc")
    sort_columns: dict[str, object] = {
        "name": Collection.name,
        "size": Collection.size,
        "rating": Collection.avg_rating,
        "popularity": Collection.popularity,
        "earliest": Collection.min_year,
        "latest": Collection.max_year,
    }
    col = sort_columns[sort]
    primary = col.asc().nullslast() if effective_dir == "asc" else col.desc().nullslast()
    if sort == "name":
        q = q.order_by(has_poster, primary)
    else:
        q = q.order_by(primary, Collection.name.asc())

    rows = q.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "page": page,
        "page_size": page_size,
        "total": int(total),
        "results": [
            {
                "id": c.id,
                "name": c.name,
                "poster_path": c.poster_path,
                "backdrop_path": c.backdrop_path,
                "size": int(c.size) if c.size is not None else 0,
                "avg_rating": float(c.avg_rating) if c.avg_rating is not None else None,
                "popularity": float(c.popularity) if c.popularity is not None else None,
                "min_year": int(c.min_year) if c.min_year is not None else None,
                "max_year": int(c.max_year) if c.max_year is not None else None,
            }
            for c in rows
        ],
    }
