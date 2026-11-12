"""
Fetches each tracked title's recommendations from TMDb and keeps them in the
database (title_recs, rec_candidate), where For You reads them.

One TMDb request per title, shared by everyone who tracks it and repeated
only when the stored list is older than STALE_AFTER.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, case, func, or_, select, union
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.title_recs import RecCandidate, TitleRecs
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.tmdb_client import get, is_not_found

logger = logging.getLogger(__name__)

ORIGIN_TMDB = "tmdb"
STALE_AFTER = timedelta(days=30)
# A tracked title's list is refetched every STALE_AFTER, which also renews the
# seen_at of everything on it. Rows left alone this long belong to titles
# nobody tracks any more.
PRUNE_AFTER = timedelta(days=90)
_UPSERT_CHUNK = 500
_FETCH_CHUNK = 50

Key = tuple[str, int]

# Page loads and the refresh job fetch on separate threads, so a visitor's
# handful of titles never waits behind a job's batch.
_job_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="title-recs-job")
_request_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="title-recs")


def fetch_recs(content_type: str, content_id: int) -> list[dict] | None:
    """TMDb's recommendations for one title. An empty list when TMDb no longer
    has the title; None when the request failed and should be tried again."""
    kind = "movie" if content_type == "movie" else "tv"
    try:
        return get(f"/{kind}/{content_id}/recommendations").get("results") or []
    except Exception as exc:
        if is_not_found(exc):
            return []
        logger.warning("title recs: fetching %s %s failed: %s", content_type, content_id, exc)
        return None


def store_recs(db: Session, fetched: dict[Key, list[dict]], now: datetime) -> dict[Key, list[Key]]:
    """Upsert the fetched lists and the display rows of the titles on them.
    Returns the list stored for each source. The caller commits."""
    lists: list[dict] = []
    candidates: dict[Key, dict] = {}
    stored: dict[Key, list[Key]] = {}
    for (content_type, content_id), items in fetched.items():
        pairs: list[Key] = []
        for item in items:
            title = item.get("title") or item.get("name")
            # Nothing For You could show without a title and a poster.
            if item.get("adult") or not item.get("id") or not title or not item.get("poster_path"):
                continue
            rec_type = "movie" if "title" in item else "tv"
            key = (rec_type, item["id"])
            if key == (content_type, content_id) or key in pairs:
                continue
            pairs.append(key)
            candidates[key] = {
                "content_type": rec_type,
                "content_id": item["id"],
                "title": title,
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "release_date": item.get("release_date") or item.get("first_air_date") or None,
                "vote_average": item.get("vote_average"),
                "popularity": item.get("popularity"),
                "genre_ids": item.get("genre_ids") or [],
                "seen_at": now,
            }
        stored[(content_type, content_id)] = pairs
        lists.append({
            "content_type": content_type,
            "content_id": content_id,
            "origin": ORIGIN_TMDB,
            "recs": [list(pair) for pair in pairs],
            "fetched_at": now,
        })

    # Rows go in key order so two writers touching the same titles take their
    # row locks in the same order and can't deadlock.
    lists.sort(key=lambda r: (r["content_type"], r["content_id"]))
    for chunk in _chunks(lists, _UPSERT_CHUNK):
        stmt = pg_insert(TitleRecs).values(chunk)
        db.execute(stmt.on_conflict_do_update(
            index_elements=[TitleRecs.content_type, TitleRecs.content_id, TitleRecs.origin],
            set_={"recs": stmt.excluded.recs, "fetched_at": stmt.excluded.fetched_at},
        ))

    rows = [candidates[key] for key in sorted(candidates)]
    for chunk in _chunks(rows, _UPSERT_CHUNK):
        stmt = pg_insert(RecCandidate).values(chunk)
        db.execute(stmt.on_conflict_do_update(
            index_elements=[RecCandidate.content_type, RecCandidate.content_id],
            set_={
                column: getattr(stmt.excluded, column)
                for column in ("title", "poster_path", "backdrop_path", "release_date",
                               "vote_average", "popularity", "genre_ids", "seen_at")
            },
        ))
    return stored


def fetch_and_store(
    db: Session, keys: list[Key], now: datetime | None = None, *, timeout: float | None = None
) -> dict[Key, list[Key]]:
    """Fetch the lists for `keys` in parallel and store them. Returns the
    stored list for each title that was fetched; failed ones are left out.

    A page load passes `timeout`: titles TMDb hasn't answered for within that
    many seconds are left out as well (the client's own retries can run for
    minutes) and stay due. The caller commits."""
    if not keys:
        return {}
    now = now or datetime.now(timezone.utc)
    pool = _job_pool if timeout is None else _request_pool
    futures = {pool.submit(fetch_recs, *key): key for key in keys}
    done, late = wait(futures, timeout=timeout)
    for future in late:
        future.cancel()  # one already running finishes and is ignored
    fetched: dict[Key, list[dict]] = {}
    for future, key in futures.items():
        if future in done and (items := future.result()) is not None:
            fetched[key] = items
    if not fetched:
        return {}
    return store_recs(db, fetched, now)


def titles_due(db: Session, limit: int | None, now: datetime) -> list[Key]:
    """Tracked titles with no stored list, then those whose list is stale,
    oldest first. Titles with no list come in no fixed order, so ones TMDb
    keeps failing on can't fill every batch and hold the rest back."""
    tracked = union(
        select(Watched.content_type, Watched.content_id),
        select(Watchlist.content_type, Watchlist.content_id),
        select(CurrentlyWatching.content_type, CurrentlyWatching.content_id),
    ).subquery("tracked")
    query = (
        select(tracked.c.content_type, tracked.c.content_id)
        .select_from(tracked)
        .outerjoin(TitleRecs, and_(
            TitleRecs.content_type == tracked.c.content_type,
            TitleRecs.content_id == tracked.c.content_id,
            TitleRecs.origin == ORIGIN_TMDB,
        ))
        .where(
            tracked.c.content_type.in_(("movie", "tv")),
            tracked.c.content_id.isnot(None),
            or_(TitleRecs.fetched_at.is_(None), TitleRecs.fetched_at < now - STALE_AFTER),
        )
        .order_by(
            case((TitleRecs.fetched_at.is_(None), 0), else_=1),
            TitleRecs.fetched_at,
            func.random(),
        )
    )
    if limit is not None:
        query = query.limit(limit)
    return [(ct, cid) for ct, cid in db.execute(query).all()]


def prune(db: Session, now: datetime) -> int:
    """Drop lists and display rows that no refresh has touched in PRUNE_AFTER.
    The caller commits."""
    cutoff = now - PRUNE_AFTER
    lists = db.query(TitleRecs).filter(TitleRecs.fetched_at < cutoff).delete(synchronize_session=False)
    candidates = (
        db.query(RecCandidate).filter(RecCandidate.seen_at < cutoff).delete(synchronize_session=False)
    )
    return lists + candidates


def refresh_title_recs(db: Session, *, limit: int | None = 300, now: datetime | None = None) -> dict:
    """Fetch lists for up to `limit` tracked titles that have none or a stale
    one, then prune. Commits as it goes, so a run cut short keeps its work
    and the next one picks up where it stopped."""
    now = now or datetime.now(timezone.utc)
    due = titles_due(db, limit, now)
    stored = 0
    for chunk in _chunks(due, _FETCH_CHUNK):
        stored += len(fetch_and_store(db, chunk, now))
        db.commit()
    pruned = prune(db, now)
    db.commit()
    if due or pruned:
        logger.info("title recs: %d due, %d stored, %d pruned", len(due), stored, pruned)
    return {"due": len(due), "stored": stored, "pruned": pruned}


def _chunks(items: list, size: int):
    for start in range(0, len(items), size):
        yield items[start:start + size]
