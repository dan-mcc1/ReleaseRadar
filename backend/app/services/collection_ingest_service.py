"""TMDb collection mirror.

- ``daily_sync(db)``: pulls TMDb's collection_ids dump (id + name only) and
  upserts the Collection table. Cheap; one HTTP call. Adult content is not
  present in the dump.

- ``daily_refresh(db)``: full daily refresh job. Runs ``daily_sync`` to pick
  up newly-created collections, then parallel-ingests every collection in the
  DB — refreshing details, parts, popularity, and aggregates. New collections
  do a full part-by-part fetch; existing collections short-circuit at the
  per-movie level (already-populated Movie rows aren't re-fetched), so the
  per-collection cost is essentially one /collection/{id} call + DB writes.

- ``backfill_collections(db)``: bootstrap-style helper that ingests every
  collection without details. Idempotent — safe to re-run.

TMDb's id dump lives at
http://files.tmdb.org/p/exports/collection_ids_MM_DD_YYYY.json.gz
and is published around 08:00 UTC.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone as dt_timezone

import requests
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.collection import Collection, CollectionMovie
from app.models.movie import Movie
from app.services.media_upsert import populate_movie_full
from app.services.tmdb_collections import get_collection

logger = logging.getLogger(__name__)

_DUMP_URL = "http://files.tmdb.org/p/exports/collection_ids_{date}.json.gz"
_INDEX_UPSERT_BATCH = 1000

# TMDb caps at 40 req/sec. At typical RTT (~300ms) each worker drives ~3 req/sec,
# so 10 workers ≈ 30 req/sec — comfortably below the cap with headroom for
# burstiness. Workers fan out to multiple serial /movie/{id} calls only when
# ingesting brand-new collections; for routine refreshes of existing collections
# it's just one /collection/{id} call per worker.
_INGEST_CONCURRENCY = 10


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _dump_url_for(now_utc: datetime) -> str:
    target = now_utc if now_utc.hour >= 8 else now_utc - timedelta(days=1)
    return _DUMP_URL.format(date=target.strftime("%m_%d_%Y"))


def _iter_dump_records(url: str):
    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()
    with gzip.GzipFile(fileobj=io.BytesIO(resp.content)) as gz:
        for line in gz:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


# ---------------------------------------------------------------------------
# Daily index sync (id + name only)
# ---------------------------------------------------------------------------


def daily_sync(db: Session, *, now_utc: datetime | None = None) -> dict:
    """Pull the collection_ids dump and upsert names. The dump excludes adult
    content, so we can write straight through without filtering."""
    now_utc = now_utc or datetime.now(dt_timezone.utc)
    url = _dump_url_for(now_utc)
    logger.info("collections sync: downloading %s", url)

    batch: list[dict] = []
    upserted = 0
    seen: set[int] = set()

    def _flush():
        nonlocal upserted
        if not batch:
            return
        stmt = pg_insert(Collection).values(batch)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Collection.id],
            set_={
                "name": stmt.excluded.name,
                "index_refreshed_at": stmt.excluded.index_refreshed_at,
            },
        )
        db.execute(stmt)
        db.commit()
        upserted += len(batch)
        batch.clear()

    for rec in _iter_dump_records(url):
        cid = rec.get("id")
        name = rec.get("name") or rec.get("original_name")
        if cid is None or not name:
            continue
        seen.add(cid)
        batch.append({"id": cid, "name": name, "index_refreshed_at": now_utc})
        if len(batch) >= _INDEX_UPSERT_BATCH:
            _flush()
    _flush()

    logger.info("collections sync: upserted %d (saw %d ids)", upserted, len(seen))
    return {"upserted": upserted, "seen": len(seen)}


# ---------------------------------------------------------------------------
# Per-collection detail + parts ingest
# ---------------------------------------------------------------------------


def _ingest_collection_details(db: Session, collection_id: int, now: datetime) -> dict:
    """Fetch /collection/{id} and persist details + all non-adult parts.

    Movies are fully populated via populate_movie_full (genres, providers,
    runtime, certification, etc.). Returns a small stats dict.
    """
    data = get_collection(collection_id)
    if not data:
        return {"status": "missing", "parts": 0, "skipped_adult": 0, "fetched_movies": 0}

    existing = db.get(Collection, collection_id)

    # Adult collections carry no usable parts. Don't add them — and drop the
    # row if a prior pass (or the index sync) left one behind.
    if data.get("adult"):
        if existing is not None:
            db.query(CollectionMovie).filter(
                CollectionMovie.collection_id == collection_id
            ).delete()
            db.delete(existing)
        return {"status": "empty", "parts": 0, "skipped_adult": 0, "fetched_movies": 0}

    c = existing
    if c is None:
        c = Collection(id=collection_id)
        db.add(c)

    c.name = data.get("name") or c.name
    c.poster_path = data.get("poster_path")
    c.backdrop_path = data.get("backdrop_path")
    c.overview = data.get("overview")
    c.details_refreshed_at = now

    parts = data.get("parts") or []
    seen_movie_ids: set[int] = set()
    skipped_adult = 0
    fetched_movies = 0
    valid_parts: list[tuple[int, dict]] = []

    for p in parts:
        mid = p.get("id")
        if mid is None or mid in seen_movie_ids:
            continue
        seen_movie_ids.add(mid)
        if p.get("adult"):
            skipped_adult += 1
            continue
        valid_parts.append((mid, p))

    # Sort by release_date asc, then id, before assigning sort_order.
    valid_parts.sort(
        key=lambda kv: (kv[1].get("release_date") or "9999-99-99", kv[0])
    )

    db.query(CollectionMovie).filter(CollectionMovie.collection_id == collection_id).delete()
    movie_ids_kept: list[int] = []
    # Popularity is read from the TMDb /collection response (each `part` carries
    # it). Captured here instead of via Movie because TMDb's popularity decays
    # daily — we don't want to persist it per-movie and chase it forever.
    popularities_kept: list[float] = []
    for idx, (mid, p) in enumerate(valid_parts):
        movie = populate_movie_full(db, mid)
        if movie is None:
            # Adult or unfetchable — skip this part entirely.
            skipped_adult += 1
            continue
        fetched_movies += 1
        movie_ids_kept.append(mid)
        pop = p.get("popularity")
        if isinstance(pop, (int, float)) and pop > 0:
            popularities_kept.append(float(pop))
        db.add(CollectionMovie(collection_id=collection_id, movie_id=mid, sort_order=idx))

    # Refresh the denormalized aggregates that /collections/browse reads.
    if movie_ids_kept:
        ratings = (
            db.query(Movie.vote_average, Movie.release_date)
            .filter(Movie.id.in_(movie_ids_kept))
            .all()
        )
        positive_ratings = [r for r, _ in ratings if r and r > 0]
        years = [
            d.year for _, d in ratings if d is not None
        ]
        c.size = len(movie_ids_kept)
        c.avg_rating = (
            sum(positive_ratings) / len(positive_ratings) if positive_ratings else None
        )
        c.popularity = (
            sum(popularities_kept) / len(popularities_kept) if popularities_kept else None
        )
        c.min_year = min(years) if years else None
        c.max_year = max(years) if years else None
    else:
        # No non-adult, fetchable parts survived. Treat this like an adult /
        # empty collection: don't keep it in the catalog. The CollectionMovie
        # rows were already cleared above; drop the Collection row too. (The
        # index sync may re-insert it from the dump; the next ingest pass will
        # delete it again.)
        if c in db.new:
            db.expunge(c)
        else:
            db.delete(c)
        return {
            "status": "empty",
            "parts": len(valid_parts),
            "skipped_adult": skipped_adult,
            "fetched_movies": fetched_movies,
        }

    return {
        "status": "ok",
        "parts": len(valid_parts),
        "skipped_adult": skipped_adult,
        "fetched_movies": fetched_movies,
    }


def _ingest_one(db: Session, collection_id: int, now: datetime) -> dict:
    """Ingest a single collection, committing on success and rolling back on failure."""
    try:
        stats = _ingest_collection_details(db, collection_id, now)
        db.commit()
        return stats
    except Exception as e:
        db.rollback()
        logger.warning("collections: failed to ingest %d: %s", collection_id, e)
        return {"status": "error", "error": str(e)}


def _ingest_one_threadsafe(collection_id: int, now: datetime) -> dict:
    """Worker variant: opens its own SQLAlchemy session so multiple ingests can
    run concurrently. Sessions/connections are not thread-safe, so each worker
    must get its own."""
    db = SessionLocal()
    try:
        return _ingest_one(db, collection_id, now)
    finally:
        db.close()


def _parallel_ingest(collection_ids: list[int], now: datetime) -> tuple[int, int]:
    """Run _ingest_one_threadsafe across a pool. Returns (succeeded, failed)."""
    if not collection_ids:
        return 0, 0
    succeeded = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=_INGEST_CONCURRENCY) as ex:
        futures = [ex.submit(_ingest_one_threadsafe, cid, now) for cid in collection_ids]
        for fut in as_completed(futures):
            try:
                stats = fut.result()
            except Exception as e:
                logger.warning("collections: ingest worker raised: %s", e)
                failed += 1
                continue
            if stats.get("status") == "ok":
                succeeded += 1
            else:
                failed += 1
    return succeeded, failed


# ---------------------------------------------------------------------------
# Daily refresh
# ---------------------------------------------------------------------------


def daily_refresh(
    db: Session,
    *,
    now_utc: datetime | None = None,
) -> dict:
    """End-to-end daily job.

    1. ``daily_sync`` — refresh the id+name index (catches brand-new collection IDs).
    2. Parallel-ingest every collection in the DB.
       - Newly-discovered collections (no details yet) do a full part-by-part
         fetch.
       - Collections that already have details get a one-call refresh of
         /collection/{id}; ``populate_movie_full`` short-circuits on movies
         that are already populated, so we don't re-fetch every part.
       The aggregate fields (size, avg_rating, popularity, min/max year)
       are recomputed from the current Movie table on every pass.
    """
    now_utc = now_utc or datetime.now(dt_timezone.utc)

    # Step 1: refresh index — cheap, one HTTP call.
    index_stats = daily_sync(db, now_utc=now_utc)

    # Step 2: refresh every collection in the DB. Order: new collections first
    # (so they pick up details on this same run), then existing ones.
    new_ids = [
        row[0]
        for row in db.execute(
            select(Collection.id)
            .where(Collection.details_refreshed_at.is_(None))
            .order_by(Collection.id.asc())
        ).all()
    ]
    existing_ids = [
        row[0]
        for row in db.execute(
            select(Collection.id)
            .where(Collection.details_refreshed_at.is_not(None))
            .order_by(Collection.id.asc())
        ).all()
    ]
    all_ids = new_ids + existing_ids
    logger.info(
        "collections refresh: %d new + %d existing = %d total",
        len(new_ids), len(existing_ids), len(all_ids),
    )

    # Release the caller's connection before the long parallel phase. Neon
    # closes idle SSL sessions after ~5 min (pool_recycle=300), so a session
    # held for the full ~11 min run would die silently and then raise on close.
    # Workers open their own short-lived sessions inside _parallel_ingest.
    db.close()

    succeeded, failed = _parallel_ingest(all_ids, now_utc)

    logger.info(
        "collections refresh: done — succeeded=%d failed=%d (new=%d existing=%d)",
        succeeded, failed, len(new_ids), len(existing_ids),
    )
    return {
        "index_upserted": index_stats.get("upserted", 0),
        "new_collections_seen": len(new_ids),
        "existing_collections_seen": len(existing_ids),
        "collections_succeeded": succeeded,
        "collections_failed": failed,
    }


# ---------------------------------------------------------------------------
# Backfill
# ---------------------------------------------------------------------------


def backfill_collections(
    db: Session,
    *,
    now_utc: datetime | None = None,
    only_missing_details: bool = True,
    limit: int | None = None,
    skip_dump: bool = False,
) -> dict:
    """End-to-end backfill: pull TMDb's daily collection_ids dump to make sure
    every collection is represented in the DB, then walk through and fetch
    /collection/{id} for each, populating Movie + CollectionMovie rows.

    With ``only_missing_details=True`` (default) we skip collections that
    already have details_refreshed_at set — safe to re-run. Set to False to
    force a full refresh.

    ``skip_dump=True`` skips the index sync (use if you know it's already up
    to date and want to save the one HTTP call).

    ``limit`` caps the number of collections processed in this invocation.
    """
    now_utc = now_utc or datetime.now(dt_timezone.utc)

    if not skip_dump:
        logger.info("collections backfill: refreshing index from daily dump")
        daily_sync(db, now_utc=now_utc)

    q = select(Collection.id)
    if only_missing_details:
        q = q.where(Collection.details_refreshed_at.is_(None))
    q = q.order_by(Collection.id.asc())
    if limit is not None:
        q = q.limit(limit)
    ids = [row[0] for row in db.execute(q).all()]
    logger.info("collections backfill: %d ids to process", len(ids))

    # See daily_refresh for why we release the caller's connection here.
    db.close()

    succeeded, failed = _parallel_ingest(ids, now_utc)

    logger.info(
        "collections backfill: done — succeeded=%d failed=%d",
        succeeded,
        failed,
    )
    return {
        "succeeded": succeeded,
        "failed": failed,
    }
