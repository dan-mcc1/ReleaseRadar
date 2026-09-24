import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict

from cachetools import TTLCache
from sqlalchemy import union_all, select
from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.tmdb_client import get

# Seeds beyond ~20 add little: ranking is driven by how many seeds recommend a
# title, and each extra seed is another TMDb round trip on a cold cache.
_SOURCE_LIMIT = 20  # most recent watched + watchlist items to seed from
_MAX_WORKERS = 10
_RETURN_LIMIT = 40  # max results returned
_CACHE_TTL = 6 * 3600  # seconds
_RANKED_TTL = 30 * 60  # seconds

# Per-item TMDb recommendation cache — needs a lock; workers call _fetch_tmdb_recommendations
_rec_cache: TTLCache = TTLCache(maxsize=500, ttl=_CACHE_TTL)
_rec_cache_lock = threading.RLock()

# Ranked candidates per seed set, before removing titles the user already has.
# Keyed by the seeds themselves, so any change to them recomputes.
_ranked_cache: TTLCache = TTLCache(maxsize=2000, ttl=_RANKED_TTL)
_ranked_cache_lock = threading.RLock()


def _fetch_tmdb_recommendations(content_type: str, content_id: int) -> list[dict]:
    key = (content_type, content_id)
    with _rec_cache_lock:
        cached = _rec_cache.get(key)
    if cached is not None:
        return cached

    try:
        path = f"/{'movie' if content_type == 'movie' else 'tv'}/{content_id}/recommendations"
        data = get(path)
        results = data.get("results", [])
        for r in results:
            r.setdefault("media_type", content_type)
        with _rec_cache_lock:
            _rec_cache[key] = results
        return results
    except Exception:
        return []


def _get_seeds_recent(db: Session, uid: str) -> list[tuple[str, int]]:
    """_SOURCE_LIMIT most recently watched + watchlist items, deduped."""
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
    """_SOURCE_LIMIT highest-rated watched items (rating not null), desc by rating then recency."""
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
    currently_q = select(CurrentlyWatching.content_type, CurrentlyWatching.content_id).where(
        CurrentlyWatching.user_id == uid
    )
    rows = db.execute(union_all(watched_q, watchlist_q, currently_q)).all()
    return {(r[0], r[1]) for r in rows}


def _ranked_candidates(seeds: list[tuple[str, int]]) -> list[dict]:
    """Score every title recommended by the seeds, best first (cached per seed set)."""
    key = frozenset(seeds)
    with _ranked_cache_lock:
        cached = _ranked_cache.get(key)
    if cached is not None:
        return cached

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
                ct = "movie" if "title" in item else "tv"
                cid = item.get("id")
                if not cid:
                    continue
                key_ = (ct, cid)
                frequency[key_] += 1
                if key_ not in score_map:
                    score_map[key_] = {"score": 0, "item": item, "content_type": ct}
                score_map[key_]["score"] = frequency[key_] * 10 + item.get("popularity", 0)

    ranked = sorted(score_map.values(), key=lambda x: x["score"], reverse=True)
    # Nothing at all usually means TMDb failed; don't pin that for 30 minutes.
    if ranked:
        with _ranked_cache_lock:
            _ranked_cache[key] = ranked
    return ranked


def get_for_you_recommendations(db: Session, uid: str, mode: str = "recent") -> dict:
    """
    Build a personalised recommendation list for a user.
    mode: "recent"     → seed from the most recent watched + watchlist items
          "top_rated"  → seed from the highest-rated watched items
    """

    # ── Step 1: gather seed items ──────────────────────────────────────────
    if mode == "top_rated":
        seeds = _get_seeds_top_rated(db, uid)
    else:
        seeds = _get_seeds_recent(db, uid)

    if not seeds:
        return {"movies": [], "shows": []}

    # ── Step 2: build exclusion set (everything the user already has) ──────
    # Always fresh, so titles added since the ranking was cached drop out.
    excluded = _get_excluded(db, uid)

    # ── Step 3: rank candidates (TMDb fan-out, cached per seed set) ────────
    ranked = [
        e for e in _ranked_candidates(seeds)
        if (e["content_type"], e["item"]["id"]) not in excluded
    ]

    # ── Step 4: split ──────────────────────────────────────────────────────
    movies = [e["item"] for e in ranked if e["content_type"] == "movie"]
    shows = [e["item"] for e in ranked if e["content_type"] == "tv"]

    return {
        "movies": movies[:_RETURN_LIMIT],
        "shows": shows[:_RETURN_LIMIT],
        "seed_count": len(seeds),
    }
