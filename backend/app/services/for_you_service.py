import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

from sqlalchemy import union_all, select
from sqlalchemy.orm import Session

from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.tmdb_client import get

_SOURCE_LIMIT = 25   # most recent watched + watchlist items to seed from
_MAX_WORKERS = 10
_RETURN_LIMIT = 40   # max results returned
_CACHE_TTL = 6 * 3600  # TMDB rec results are user-agnostic and stable

# In-memory cache: (content_type, content_id) → (results, monotonic_timestamp)
_rec_cache: dict[tuple[str, int], tuple[list, float]] = {}


def _fetch_tmdb_recommendations(content_type: str, content_id: int) -> list[dict]:
    """Fetch TMDB recommendations for a single movie or TV show, with TTL cache."""
    key = (content_type, content_id)
    cached = _rec_cache.get(key)
    if cached:
        results, ts = cached
        if time.monotonic() - ts < _CACHE_TTL:
            return results

    try:
        path = f"/{'movie' if content_type == 'movie' else 'tv'}/{content_id}/recommendations"
        data = get(path)
        results = data.get("results", [])
        for r in results:
            r.setdefault("media_type", content_type)
        _rec_cache[key] = (results, time.monotonic())
        return results
    except Exception:
        return []


def _get_seeds_recent(db: Session, uid: str) -> list[tuple[str, int]]:
    """25 most recently watched + watchlist items, deduped."""
    watched_rows = (
        db.query(Watched.content_type, Watched.content_id)
        .filter(Watched.user_id == uid)
        .order_by(Watched.watched_at.desc())
        .limit(_SOURCE_LIMIT)
        .all()
    )
    watchlist_rows = (
        db.query(Watchlist.content_type, Watchlist.content_id)
        .filter(Watchlist.user_id == uid)
        .order_by(Watchlist.added_at.desc())
        .limit(_SOURCE_LIMIT)
        .all()
    )
    seen: set[tuple[str, int]] = set()
    seeds: list[tuple[str, int]] = []
    for row in [*watched_rows, *watchlist_rows]:
        key = (row.content_type, row.content_id)
        if key not in seen:
            seen.add(key)
            seeds.append(key)
    return seeds[:_SOURCE_LIMIT]


def _get_seeds_top_rated(db: Session, uid: str) -> list[tuple[str, int]]:
    """25 highest-rated watched items (rating not null), desc by rating then recency."""
    rows = (
        db.query(Watched.content_type, Watched.content_id)
        .filter(Watched.user_id == uid, Watched.rating.isnot(None))
        .order_by(Watched.rating.desc(), Watched.watched_at.desc())
        .limit(_SOURCE_LIMIT)
        .all()
    )
    return [(row.content_type, row.content_id) for row in rows]


def _get_excluded(db: Session, uid: str) -> set[tuple[str, int]]:
    """All (content_type, content_id) the user already has — column-only, single union query."""
    watched_q = select(Watched.content_type, Watched.content_id).where(Watched.user_id == uid)
    watchlist_q = select(Watchlist.content_type, Watchlist.content_id).where(Watchlist.user_id == uid)
    rows = db.execute(union_all(watched_q, watchlist_q)).all()
    return {(r[0], r[1]) for r in rows}


def get_for_you_recommendations(db: Session, uid: str, mode: str = "recent") -> dict:
    """
    Build a personalised recommendation list for a user.
    mode: "recent"     → seed from 25 most recent watched + watchlist
          "top_rated"  → seed from 25 highest-rated watched items
    """

    # ── Step 1: gather seed items ──────────────────────────────────────────
    if mode == "top_rated":
        seeds = _get_seeds_top_rated(db, uid)
    else:
        seeds = _get_seeds_recent(db, uid)

    if not seeds:
        return {"movies": [], "shows": []}

    # ── Step 2: build exclusion set (everything the user already has) ──────
    excluded = _get_excluded(db, uid)

    # ── Step 3: fetch recommendations concurrently ─────────────────────────
    # score_map: (content_type, content_id) → {"score": int, "item": dict}
    score_map: dict[tuple[str, int], dict] = {}
    frequency: dict[tuple[str, int], int] = defaultdict(int)

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
        futures = {
            executor.submit(_fetch_tmdb_recommendations, ct, cid): (ct, cid)
            for ct, cid in seeds
        }
        for future in as_completed(futures):
            recs = future.result()
            for item in recs:
                # TMDB TV results use "name", movies use "title"
                ct = "movie" if "title" in item else "tv"
                cid = item.get("id")
                if not cid:
                    continue
                key = (ct, cid)
                if key in excluded:
                    continue
                frequency[key] += 1
                if key not in score_map:
                    score_map[key] = {"score": 0, "item": item, "content_type": ct}
                score_map[key]["score"] = (
                    frequency[key] * 10 + item.get("popularity", 0)
                )

    # ── Step 4: sort and split ─────────────────────────────────────────────
    ranked = sorted(score_map.values(), key=lambda x: x["score"], reverse=True)

    movies = [e["item"] for e in ranked if e["content_type"] == "movie"]
    shows = [e["item"] for e in ranked if e["content_type"] == "tv"]

    return {
        "movies": movies[:_RETURN_LIMIT],
        "shows": shows[:_RETURN_LIMIT],
        "seed_count": len(seeds),
    }
