# app/routers/import_router.py
import asyncio
import csv
import io
import zipfile
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services.tmdb_movies import search_movies, fetch_movie_from_tmdb
from app.services.watchlist_service import ensure_movie_in_db, add_to_watchlist
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.models.movie import Movie
from datetime import datetime, timezone

router = APIRouter()

_MAX_ROWS = 2000
_MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB
_CONCURRENCY = 10  # max concurrent TMDB requests

_WATCHED_CSVS = ["watched.csv", "diary.csv", "ratings.csv", "reviews.csv"]
_WATCHLIST_CSVS = ["watchlist.csv"]

# The append string used by ensure_movie_in_db — must match for lru_cache hits
_MOVIE_APPEND = "watch/providers,release_dates,images"


def _parse_letterboxd_rating(raw: str) -> float | None:
    raw = raw.strip()
    if not raw:
        return None
    try:
        val = float(raw)
        if 0.5 <= val <= 5.0:
            return round(val * 2) / 2
    except ValueError:
        pass
    return None


def _parse_date(raw: str) -> datetime | None:
    for fmt in ("%Y-%m-%d", "%d %b %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(raw.strip(), fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _find_tmdb_id(name: str, year: int | None) -> int | None:
    results = search_movies(query=name) or []
    if not results:
        return None
    if year:
        for r in results:
            release = (r.get("release_date") or "")[:4]
            if release == str(year):
                return r["id"]
    return results[0]["id"]


def _extract_csvs_from_zip(raw_bytes: bytes) -> dict[str, str]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            out: dict[str, str] = {}
            for zip_path in zf.namelist():
                basename = zip_path.split("/")[-1].lower()
                if basename.endswith(".csv"):
                    data = zf.read(zip_path)
                    out[basename] = data.decode("utf-8-sig", errors="replace")
            return out
    except zipfile.BadZipFile:
        raise HTTPException(status_code=422, detail="Invalid zip file.")


def _collect_rows(texts: list[str], kind: str, max_rows: int) -> list[dict]:
    rows: list[dict] = []
    row_num = 2
    for text in texts:
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            if len(rows) >= max_rows:
                return rows
            name = (row.get("Name") or row.get("Title") or "").strip()
            year_raw = (row.get("Year") or "").strip()
            date_raw = (row.get("Watched Date") or row.get("Date") or "").strip()
            rows.append({
                "kind": kind,
                "row_num": row_num,
                "name": name,
                "year": int(year_raw) if year_raw.isdigit() else None,
                "rating": _parse_letterboxd_rating(row.get("Rating") or ""),
                "watched_at": _parse_date(date_raw) if date_raw else datetime.now(timezone.utc),
            })
            row_num += 1
    return rows


@router.post("/letterboxd")
async def import_letterboxd(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Accept a Letterboxd export (zip or individual CSV) and import movies.
    Watched/diary/ratings/reviews → watched history; watchlist → watchlist.
    """
    filename = (file.filename or "").lower()
    if not (filename.endswith(".csv") or filename.endswith(".zip")):
        raise HTTPException(status_code=422, detail="Please upload a .csv or .zip file.")

    raw_bytes = await file.read()
    if len(raw_bytes) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB).")

    if filename.endswith(".zip"):
        csv_map = _extract_csvs_from_zip(raw_bytes)
        if not csv_map:
            raise HTTPException(status_code=422, detail="No CSV files found in zip.")
        watched_texts = [csv_map[k] for k in _WATCHED_CSVS if k in csv_map]
        watchlist_texts = [csv_map[k] for k in _WATCHLIST_CSVS if k in csv_map]
    elif filename in _WATCHLIST_CSVS:
        watched_texts = []
        watchlist_texts = [raw_bytes.decode("utf-8-sig", errors="replace")]
    else:
        watched_texts = [raw_bytes.decode("utf-8-sig", errors="replace")]
        watchlist_texts = []

    all_rows = (
        _collect_rows(watched_texts, "watched", _MAX_ROWS) +
        _collect_rows(watchlist_texts, "watchlist", _MAX_ROWS)
    )[:_MAX_ROWS]

    named_rows = [r for r in all_rows if r["name"]]
    unnamed_rows = [r for r in all_rows if not r["name"]]

    # ── Phase 1: resolve all TMDB IDs concurrently ──────────────────────────
    sem = asyncio.Semaphore(_CONCURRENCY)

    async def resolve_id(name: str, year: int | None) -> int | Exception | None:
        async with sem:
            try:
                return await asyncio.to_thread(_find_tmdb_id, name, year)
            except Exception as e:
                return e

    resolved = await asyncio.gather(*[resolve_id(r["name"], r["year"]) for r in named_rows])

    for row, result in zip(named_rows, resolved):
        if isinstance(result, Exception):
            row["tmdb_id"] = None
            row["tmdb_error"] = str(result)[:80]
        else:
            row["tmdb_id"] = result
            row["tmdb_error"] = None

    # ── Phase 2: pre-fetch movie details for IDs not already in DB ──────────
    found_ids = list({r["tmdb_id"] for r in named_rows if r["tmdb_id"]})
    if found_ids:
        existing_in_db = {
            mid for (mid,) in db.query(Movie.id).filter(Movie.id.in_(found_ids)).all()
        }
        missing_ids = [mid for mid in found_ids if mid not in existing_in_db]

        async def prefetch(tmdb_id: int) -> None:
            async with sem:
                try:
                    await asyncio.to_thread(fetch_movie_from_tmdb, tmdb_id, _MOVIE_APPEND)
                except Exception:
                    pass  # errors surface during DB phase

        await asyncio.gather(*[prefetch(mid) for mid in missing_ids])

    # ── Phase 3: sequential DB writes (all TMDB calls are now cache hits) ───
    results: list[dict] = []
    imported = skipped = failed = watchlisted = 0
    seen_tmdb_ids: set[int] = set()

    for row in unnamed_rows:
        skipped += 1
        results.append({"row": row["row_num"], "title": "—", "status": "skipped", "reason": "no title"})

    for row in named_rows:
        row_num = row["row_num"]
        name = row["name"]
        tmdb_id = row["tmdb_id"]

        if row["tmdb_error"]:
            failed += 1
            results.append({"row": row_num, "title": name, "status": "failed", "reason": f"TMDB search error: {row['tmdb_error']}"})
            continue

        if not tmdb_id:
            failed += 1
            results.append({"row": row_num, "title": name, "status": "failed", "reason": "not found on TMDB"})
            continue

        if tmdb_id in seen_tmdb_ids:
            skipped += 1
            results.append({"row": row_num, "title": name, "tmdb_id": tmdb_id, "status": "skipped", "reason": "duplicate in import"})
            continue
        seen_tmdb_ids.add(tmdb_id)

        if row["kind"] == "watched":
            existing = db.query(Watched).filter_by(
                user_id=uid, content_type="movie", content_id=tmdb_id
            ).first()
            if existing:
                skipped += 1
                results.append({"row": row_num, "title": name, "tmdb_id": tmdb_id, "status": "skipped", "reason": "already in watched"})
                continue

            try:
                already_tracked = db.query(Movie).filter_by(id=tmdb_id).first() is not None
                movie = ensure_movie_in_db(db, tmdb_id, already_tracked)
            except Exception as e:
                failed += 1
                results.append({"row": row_num, "title": name, "status": "failed", "reason": f"DB error: {str(e)[:80]}"})
                continue

            try:
                watched_at = row["watched_at"]
                entry = Watched(
                    user_id=uid,
                    content_type="movie",
                    content_id=movie.id,
                    watched_at=watched_at,
                    rating=row["rating"],
                )
                db.add(entry)
                db.commit()
                imported += 1
                results.append({
                    "row": row_num,
                    "title": movie.title,
                    "tmdb_id": movie.id,
                    "status": "imported",
                    "rating": row["rating"],
                    "watched_at": watched_at.strftime("%Y-%m-%d") if watched_at else None,
                })
            except Exception as e:
                db.rollback()
                failed += 1
                results.append({"row": row_num, "title": name, "status": "failed", "reason": str(e)[:120]})

        else:  # watchlist
            existing_watched = db.query(Watched).filter_by(
                user_id=uid, content_type="movie", content_id=tmdb_id
            ).first()
            if existing_watched:
                skipped += 1
                results.append({"row": row_num, "title": name, "tmdb_id": tmdb_id, "status": "skipped", "reason": "already in watched"})
                continue

            existing_wl = db.query(Watchlist).filter_by(
                user_id=uid, content_type="movie", content_id=tmdb_id
            ).first()
            if existing_wl:
                skipped += 1
                results.append({"row": row_num, "title": name, "tmdb_id": tmdb_id, "status": "skipped", "reason": "already in watchlist"})
                continue

            try:
                already_tracked = db.query(Movie).filter_by(id=tmdb_id).first() is not None
                movie = ensure_movie_in_db(db, tmdb_id, already_tracked)
            except Exception as e:
                failed += 1
                results.append({"row": row_num, "title": name, "status": "failed", "reason": f"DB error: {str(e)[:80]}"})
                continue

            try:
                add_to_watchlist(db, uid, "movie", movie.id)
                db.commit()
                watchlisted += 1
                results.append({
                    "row": row_num,
                    "title": movie.title,
                    "tmdb_id": movie.id,
                    "status": "watchlisted",
                })
            except Exception as e:
                db.rollback()
                failed += 1
                results.append({"row": row_num, "title": name, "status": "failed", "reason": str(e)[:120]})

    results.sort(key=lambda r: r["row"])

    return {
        "summary": {
            "total": imported + watchlisted + skipped + failed,
            "imported": imported,
            "watchlisted": watchlisted,
            "skipped": skipped,
            "failed": failed,
        },
        "results": results,
    }
