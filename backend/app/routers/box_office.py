import calendar
import time
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Query, HTTPException
from app.services.tmdb_client import get

router = APIRouter()

# Simple TTL cache keyed by (year, month_or_0, limit)
_cache: dict[tuple, tuple[list, float]] = {}
_TTL_HISTORICAL = 7 * 24 * 3600
_TTL_CURRENT = 6 * 3600


def _ttl(year: int, month: int) -> float:
    now = time.localtime()
    if year == now.tm_year and (month == 0 or month == now.tm_mon):
        return _TTL_CURRENT
    return _TTL_HISTORICAL


def _date_range(year: int, month: int):
    """month=0 means full year."""
    if month:
        last_day = calendar.monthrange(year, month)[1]
        return f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last_day:02d}"
    return f"{year}-01-01", f"{year}-12-31"


def _fetch_detail(movie_id: int) -> dict | None:
    try:
        return get(f"/movie/{movie_id}")
    except Exception:
        return None


def _build_leaderboard(year: int, month: int, limit: int) -> list[dict]:
    cache_key = (year, month, limit)
    cached = _cache.get(cache_key)
    if cached:
        result, ts = cached
        if time.time() - ts < _ttl(year, month):
            return result

    gte, lte = _date_range(year, month)

    # Get sorted movie IDs from TMDB discover
    try:
        data = get(
            "/discover/movie",
            {
                "sort_by": "revenue.desc",
                "primary_release_date.gte": gte,
                "primary_release_date.lte": lte,
                "vote_count.gte": 10,
                "page": 1,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TMDB error: {e}")

    discover_results: list[dict] = data.get("results", [])
    if not discover_results:
        return []

    ids = [r["id"] for r in discover_results]

    # Always fetch fresh from TMDB so revenue figures match the movie detail page
    fetched: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=min(len(ids), 20)) as executor:
        futures = {executor.submit(_fetch_detail, mid): mid for mid in ids}
        for future in futures:
            mid = futures[future]
            result = future.result()
            if result:
                fetched[mid] = result

    # Build ranked list preserving discover sort order
    ranked = []
    rank = 1
    for mid in ids:
        if rank > limit:
            break

        m = fetched.get(mid)
        if not m:
            continue

        revenue = m.get("revenue") or 0
        if revenue <= 0:
            continue

        ranked.append(
            {
                "rank": rank,
                "id": mid,
                "title": m.get("title"),
                "poster_path": m.get("poster_path"),
                "release_date": m.get("release_date"),
                "revenue": revenue,
                "budget": m.get("budget") or 0,
            }
        )
        rank += 1

    _cache[cache_key] = (ranked, time.time())
    return ranked


@router.get("/yearly")
def box_office_yearly(
    year: int = Query(..., ge=1900, le=2100),
    limit: int = Query(20, ge=1, le=50),
):
    return _build_leaderboard(year, 0, limit)


@router.get("/monthly")
def box_office_monthly(
    year: int = Query(..., ge=1900, le=2100),
    month: int = Query(..., ge=1, le=12),
    limit: int = Query(20, ge=1, le=50),
):
    return _build_leaderboard(year, month, limit)
