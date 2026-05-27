# app/routers/import_router.py
import asyncio
import csv
import io
import json
import zipfile
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from app.db.session import get_db, SessionLocal
from app.dependencies.auth import get_current_user
from app.services.tmdb_client import get as tmdb_get
from app.services.tmdb_movies import search_movies, fetch_movie_from_tmdb
from app.services.tmdb_tv import fetch_show_from_tmdb
from app.services.tmdb_search import get_tv_search_results
from app.services.media_upsert import ensure_movie_in_db, ensure_show_in_db
from app.services.watchlist_service import add_to_watchlist
from app.services.episode_service import maybe_sync_show_episodes, sync_season_episodes
from app.services.watched_episode_service import maybe_auto_complete_show
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.models.movie import Movie
from app.models.show import Show
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from datetime import datetime, timezone

router = APIRouter()

_MAX_ROWS = 2000
_MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB
_CONCURRENCY = 10  # max concurrent TMDB requests

_WATCHED_CSVS = ["watched.csv", "diary.csv", "ratings.csv", "reviews.csv"]
_WATCHLIST_CSVS = ["watchlist.csv"]

_MOVIE_APPEND = "watch/providers,release_dates,images"
_SHOW_APPEND = "watch/providers,images,content_ratings"


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


def _find_tmdb_result(name: str, year: int | None) -> tuple[int, str] | None:
    """
    Search TMDB for a title across movies and TV shows.
    Returns (tmdb_id, media_type) where media_type is 'movie' or 'tv', or None.
    Prefers year-exact matches; falls back to highest-popularity result.
    """
    movie_results = search_movies(query=name) or []
    tv_results = get_tv_search_results(query=name) or []

    if year:
        year_str = str(year)
        for r in movie_results:
            if (r.get("release_date") or "")[:4] == year_str:
                return r["id"], "movie"
        for r in tv_results:
            if (r.get("first_air_date") or "")[:4] == year_str:
                return r["id"], "tv"

    # No year or no year match — pick highest popularity across both
    best_movie = movie_results[0] if movie_results else None
    best_tv = tv_results[0] if tv_results else None

    if best_movie and best_tv:
        if best_movie.get("popularity", 0) >= best_tv.get("popularity", 0):
            return best_movie["id"], "movie"
        return best_tv["id"], "tv"
    if best_movie:
        return best_movie["id"], "movie"
    if best_tv:
        return best_tv["id"], "tv"
    return None


_MAX_CSV_BYTES = 50 * 1024 * 1024  # 50 MB per file
_MAX_TOTAL_BYTES = 100 * 1024 * 1024  # 100 MB across all files


def _extract_csvs_from_zip(raw_bytes: bytes) -> dict[str, str]:
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            out: dict[str, str] = {}
            total = 0
            for info in zf.infolist():
                basename = info.filename.split("/")[-1].lower()
                if not basename.endswith(".csv"):
                    continue
                if info.file_size > _MAX_CSV_BYTES:
                    raise HTTPException(status_code=422, detail=f"CSV file '{basename}' exceeds 50 MB limit.")
                total += info.file_size
                if total > _MAX_TOTAL_BYTES:
                    raise HTTPException(status_code=422, detail="Total uncompressed CSV size exceeds 100 MB limit.")
                data = zf.read(info.filename)
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
    Accept a Letterboxd export (zip or individual CSV) and import movies and TV shows.
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

    async def resolve_result(name: str, year: int | None) -> tuple[int, str] | Exception | None:
        async with sem:
            try:
                return await asyncio.to_thread(_find_tmdb_result, name, year)
            except Exception as e:
                return e

    resolved = await asyncio.gather(*[resolve_result(r["name"], r["year"]) for r in named_rows])

    for row, result in zip(named_rows, resolved):
        if isinstance(result, Exception):
            row["tmdb_id"] = None
            row["media_type"] = None
            row["tmdb_error"] = str(result)[:80]
        elif result is None:
            row["tmdb_id"] = None
            row["media_type"] = None
            row["tmdb_error"] = None
        else:
            row["tmdb_id"] = result[0]
            row["media_type"] = result[1]
            row["tmdb_error"] = None

    # ── Phase 2: pre-fetch details for items not already in DB ──────────────
    movie_ids = list({r["tmdb_id"] for r in named_rows if r["tmdb_id"] and r["media_type"] == "movie"})
    tv_ids = list({r["tmdb_id"] for r in named_rows if r["tmdb_id"] and r["media_type"] == "tv"})

    existing_movies = (
        {mid for (mid,) in db.query(Movie.id).filter(Movie.id.in_(movie_ids)).all()}
        if movie_ids else set()
    )
    existing_shows = (
        {sid for (sid,) in db.query(Show.id).filter(Show.id.in_(tv_ids)).all()}
        if tv_ids else set()
    )

    missing_movies = [mid for mid in movie_ids if mid not in existing_movies]
    missing_shows = [sid for sid in tv_ids if sid not in existing_shows]

    async def prefetch_movie(tmdb_id: int) -> None:
        async with sem:
            try:
                await asyncio.to_thread(fetch_movie_from_tmdb, tmdb_id, _MOVIE_APPEND)
            except Exception:
                pass

    async def prefetch_show(tmdb_id: int) -> None:
        async with sem:
            try:
                await asyncio.to_thread(fetch_show_from_tmdb, tmdb_id, _SHOW_APPEND)
            except Exception:
                pass

    await asyncio.gather(
        *[prefetch_movie(mid) for mid in missing_movies],
        *[prefetch_show(sid) for sid in missing_shows],
    )

    # ── Phase 3: sequential DB writes (all TMDB calls are now cache hits) ───
    results: list[dict] = []
    imported = skipped = failed = watchlisted = 0
    seen_pairs: set[tuple[int, str]] = set()  # (tmdb_id, media_type)

    for row in unnamed_rows:
        skipped += 1
        results.append({"row": row["row_num"], "title": "—", "status": "skipped", "reason": "no title"})

    for row in named_rows:
        row_num = row["row_num"]
        name = row["name"]
        tmdb_id = row["tmdb_id"]
        media_type = row["media_type"]

        if row["tmdb_error"]:
            failed += 1
            results.append({"row": row_num, "title": name, "status": "failed", "reason": f"TMDB search error: {row['tmdb_error']}"})
            continue

        if not tmdb_id:
            failed += 1
            results.append({"row": row_num, "title": name, "status": "failed", "reason": "not found on TMDB"})
            continue

        pair = (tmdb_id, media_type)
        if pair in seen_pairs:
            skipped += 1
            results.append({"row": row_num, "title": name, "tmdb_id": tmdb_id, "media_type": media_type, "status": "skipped", "reason": "duplicate in import"})
            continue
        seen_pairs.add(pair)

        if row["kind"] == "watched":
            existing = db.query(Watched).filter_by(
                user_id=uid, content_type=media_type, content_id=tmdb_id
            ).first()
            if existing:
                skipped += 1
                results.append({"row": row_num, "title": name, "tmdb_id": tmdb_id, "media_type": media_type, "status": "skipped", "reason": "already in watched"})
                continue

            try:
                if media_type == "movie":
                    already_tracked = db.query(Movie).filter_by(id=tmdb_id).first() is not None
                    media = ensure_movie_in_db(db, tmdb_id, already_tracked)
                    title = media.title
                else:
                    already_tracked = db.query(Show).filter_by(id=tmdb_id).first() is not None
                    media = ensure_show_in_db(db, tmdb_id, already_tracked)
                    maybe_sync_show_episodes(db, tmdb_id)
                    title = media.name
            except Exception as e:
                db.rollback()
                failed += 1
                results.append({"row": row_num, "title": name, "status": "failed", "reason": f"DB error: {str(e)[:80]}"})
                continue

            try:
                watched_at = row["watched_at"]
                entry = Watched(
                    user_id=uid,
                    content_type=media_type,
                    content_id=media.id,
                    watched_at=watched_at,
                    rating=row["rating"],
                )
                db.add(entry)
                db.commit()
                imported += 1
                results.append({
                    "row": row_num,
                    "title": title,
                    "tmdb_id": media.id,
                    "media_type": media_type,
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
                user_id=uid, content_type=media_type, content_id=tmdb_id
            ).first()
            if existing_watched:
                skipped += 1
                results.append({"row": row_num, "title": name, "tmdb_id": tmdb_id, "media_type": media_type, "status": "skipped", "reason": "already in watched"})
                continue

            existing_wl = db.query(Watchlist).filter_by(
                user_id=uid, content_type=media_type, content_id=tmdb_id
            ).first()
            if existing_wl:
                skipped += 1
                results.append({"row": row_num, "title": name, "tmdb_id": tmdb_id, "media_type": media_type, "status": "skipped", "reason": "already in watchlist"})
                continue

            try:
                if media_type == "movie":
                    already_tracked = db.query(Movie).filter_by(id=tmdb_id).first() is not None
                    media = ensure_movie_in_db(db, tmdb_id, already_tracked)
                    title = media.title
                else:
                    already_tracked = db.query(Show).filter_by(id=tmdb_id).first() is not None
                    media = ensure_show_in_db(db, tmdb_id, already_tracked)
                    maybe_sync_show_episodes(db, tmdb_id)
                    title = media.name
            except Exception as e:
                db.rollback()
                failed += 1
                results.append({"row": row_num, "title": name, "status": "failed", "reason": f"DB error: {str(e)[:80]}"})
                continue

            try:
                add_to_watchlist(db, uid, media_type, media.id)
                db.commit()
                watchlisted += 1
                results.append({
                    "row": row_num,
                    "title": title,
                    "tmdb_id": media.id,
                    "media_type": media_type,
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


# ─── TV Time import ──────────────────────────────────────────────────────────
#
# TV Time delivers a "Personal Data" zip via email with several CSVs. Filenames
# and column names have drifted over the years, so we look for *any* CSV whose
# basename hints at what it contains and pick columns by alias rather than by
# exact header.

_TVTIME_MAX_EPISODE_ROWS = 50_000  # a heavy user can have years of episodes
_TVTIME_MAX_FOLLOW_ROWS = 5_000

_TVTIME_EPISODE_NAME_HINTS = ("seen_episode", "tracking-prod-records", "episode")
_TVTIME_FOLLOW_NAME_HINTS = ("followed_tv_show", "follow", "tv_show", "tracking-prod-records")
_TVTIME_RATING_NAME_HINTS = ("tv_show_rating", "rating")

# Column aliases — TV Time has used slightly different headers across exports.
_SHOW_NAME_KEYS = ("tv_show_name", "show_name", "title", "name", "series_name")
_SEASON_KEYS = ("season_number", "season", "season_num")
_EPISODE_NUM_KEYS = ("episode_number", "episode", "episode_num", "number")
_WATCHED_AT_KEYS = ("updated_at", "created_at", "watched_at", "date", "seen_at")
_FOLLOW_STATUS_KEYS = ("status", "follow_status", "type")
_RATING_KEYS = ("rating", "stars", "score")


def _first(row: dict, keys: tuple[str, ...]) -> str:
    """Return the first non-empty value from row across the candidate keys (case-insensitive)."""
    lowered = {k.lower(): v for k, v in row.items()}
    for k in keys:
        v = lowered.get(k.lower())
        if v is not None and str(v).strip():
            return str(v).strip()
    return ""


def _parse_tvtime_date(raw: str) -> datetime:
    raw = raw.strip()
    if not raw:
        return datetime.now(timezone.utc)
    # ISO with or without timezone; fall back to a couple of fixed formats
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return datetime.now(timezone.utc)


def _parse_int(raw: str) -> int | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return int(float(raw))
    except ValueError:
        return None


def _parse_tvtime_rating(raw: str) -> float | None:
    """TV Time ratings are 0–10 (heart-out-of-ten). Convert to your 0.5–5.0 half-star scale."""
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        val = float(raw)
    except ValueError:
        return None
    # Some exports use 0–10, others 0–5. Detect: if value > 5 assume out-of-ten.
    if val > 5:
        val = val / 2.0
    val = round(val * 2) / 2
    if 0.5 <= val <= 5.0:
        return val
    return None


def _find_tv_show_id(name: str, year: int | None = None) -> int | None:
    """Search TMDB for a TV show by name; prefer year-exact, else top popularity."""
    if not name:
        return None
    results = get_tv_search_results(query=name) or []
    if year:
        ys = str(year)
        for r in results:
            if (r.get("first_air_date") or "")[:4] == ys:
                return r["id"]
    return results[0]["id"] if results else None


def _classify_tvtime_csv(name: str, headers: list[str]) -> str | None:
    """
    Return 'episodes' / 'follows' / 'ratings' / None based on the filename hint
    + header heuristics. tracking-prod-records.csv is ambiguous and split here.
    """
    lower = name.lower()
    headers_lower = [h.lower() for h in headers]
    has_episode = any(h in headers_lower for h in _EPISODE_NUM_KEYS)
    has_season = any(h in headers_lower for h in _SEASON_KEYS)
    has_show = any(h in headers_lower for h in _SHOW_NAME_KEYS)
    has_rating = any(h in headers_lower for h in _RATING_KEYS)
    has_status = any(h in headers_lower for h in _FOLLOW_STATUS_KEYS)

    if not has_show:
        return None
    if has_episode and has_season:
        return "episodes"
    if has_rating and not has_episode:
        return "ratings"
    if has_status and not has_episode:
        return "follows"
    if any(h in lower for h in _TVTIME_EPISODE_NAME_HINTS) and has_episode:
        return "episodes"
    if any(h in lower for h in _TVTIME_FOLLOW_NAME_HINTS):
        return "follows"
    if any(h in lower for h in _TVTIME_RATING_NAME_HINTS):
        return "ratings"
    return None


# ── "TV Time Out" Chrome extension format ───────────────────────────────────
#
# The official TV Time data export was shut down, so users now run a community
# Chrome extension ("TV Time Out") that scrapes their library into JSON or CSV.
# Those exports use a different shape from the original email zip:
#
#   tvtime-movies-*.json/.csv         — per-movie rows with IMDb + TVDB ids
#   tvtime-series-*.json              — nested shows → seasons → episodes
#   tvtime-series-*.csv               — series metadata only (no episodes)
#   tvtime-series-episodes-*.csv      — per-episode rows flattened
#
# IMDb/TVDB ids let us bypass the name-search guesswork by hitting
# TMDB's `/find/{external_id}` endpoint directly.


def _tmdb_find_by_external(ext_id: str, source: str) -> tuple[int, str] | None:
    """
    Resolve an IMDb/TVDB id to a TMDB (id, media_type).
    `source` is one of "imdb_id", "tvdb_id".
    Returns None if nothing found or on error.
    """
    if not ext_id:
        return None
    try:
        data = tmdb_get(f"/find/{ext_id}", params={"external_source": source}) or {}
    except Exception:
        return None
    if data.get("movie_results"):
        return data["movie_results"][0]["id"], "movie"
    if data.get("tv_results"):
        return data["tv_results"][0]["id"], "tv"
    return None


def _resolve_ext_movie(imdb_id: str | None, tvdb_id: int | None, title: str, year: int | None) -> tuple[int, str] | None:
    """External id first (best accuracy), name search as fallback."""
    if imdb_id:
        hit = _tmdb_find_by_external(imdb_id, "imdb_id")
        if hit:
            return hit
    if tvdb_id:
        hit = _tmdb_find_by_external(str(tvdb_id), "tvdb_id")
        if hit:
            return hit
    if title:
        return _find_tmdb_result(title, year)
    return None


def _resolve_ext_show(tvdb_id: int | None, imdb_id: str | None, title: str) -> int | None:
    if tvdb_id:
        hit = _tmdb_find_by_external(str(tvdb_id), "tvdb_id")
        if hit and hit[1] == "tv":
            return hit[0]
    if imdb_id:
        hit = _tmdb_find_by_external(imdb_id, "imdb_id")
        if hit and hit[1] == "tv":
            return hit[0]
    if title:
        return _find_tv_show_id(title, None)
    return None


def _detect_ext_format(basename: str, content: str) -> str | None:
    """
    Returns one of:
      'ext_movies_json' / 'ext_series_json'
      'ext_movies_csv' / 'ext_series_csv' / 'ext_episodes_csv'
      None — let the old TV Time classifier handle it.
    """
    lower = basename.lower()
    if lower.endswith(".json") or content.lstrip()[:1] in ("[", "{"):
        try:
            data = json.loads(content)
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, list) or not data:
            return None
        sample = next((s for s in data if isinstance(s, dict)), None)
        if not sample:
            return None
        if "seasons" in sample:
            return "ext_series_json"
        # Movies file has top-level year + id.imdb keys
        if "year" in sample or (isinstance(sample.get("id"), dict) and "imdb" in sample["id"]):
            return "ext_movies_json"
        return None

    # CSV — inspect header line. Only the new format has tvdb_id/imdb_id columns.
    first_line = (content.splitlines() or [""])[0].lower()
    headers = {h.strip() for h in first_line.split(",")}
    if {"series_tvdb_id", "season", "episode"}.issubset(headers):
        return "ext_episodes_csv"
    if "tvdb_id" in headers and "imdb_id" in headers and "year" in headers:
        return "ext_movies_csv"
    if "tvdb_id" in headers and "imdb_id" in headers and "status" in headers:
        return "ext_series_csv"
    return None


def _parse_ext_movies_json(text: str) -> list[dict]:
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    rows: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        ids = item.get("id") or {}
        title = (item.get("title") or "").strip()
        if not title:
            continue
        imdb = (ids.get("imdb") or "").strip() or None if isinstance(ids.get("imdb"), str) else None
        tvdb = ids.get("tvdb") if isinstance(ids.get("tvdb"), int) else None
        year = item.get("year") if isinstance(item.get("year"), int) else None
        is_watched = bool(item.get("is_watched"))
        watched_at_raw = item.get("watched_at") or item.get("created_at") or ""
        rows.append({
            "imdb_id": imdb,
            "tvdb_id": tvdb,
            "title": title,
            "year": year,
            "is_watched": is_watched,
            "watched_at": _parse_tvtime_date(str(watched_at_raw)) if watched_at_raw else datetime.now(timezone.utc),
        })
    return rows


def _parse_ext_movies_csv(text: str) -> list[dict]:
    rows: list[dict] = []
    for row in csv.DictReader(io.StringIO(text)):
        title = (row.get("title") or "").strip()
        if not title:
            continue
        imdb = (row.get("imdb_id") or "").strip() or None
        tvdb_raw = (row.get("tvdb_id") or "").strip()
        tvdb = int(tvdb_raw) if tvdb_raw.isdigit() else None
        year_raw = (row.get("year") or "").strip()
        year = int(year_raw) if year_raw.isdigit() else None
        is_watched = (row.get("is_watched") or "").strip().lower() == "true"
        watched_at_raw = (row.get("watched_at") or row.get("created_at") or "").strip()
        rows.append({
            "imdb_id": imdb,
            "tvdb_id": tvdb,
            "title": title,
            "year": year,
            "is_watched": is_watched,
            "watched_at": _parse_tvtime_date(watched_at_raw) if watched_at_raw else datetime.now(timezone.utc),
        })
    return rows


def _parse_ext_series_json(text: str) -> tuple[list[dict], list[dict]]:
    """
    Returns (shows, episodes).
      shows:    [{tvdb_id, imdb_id, title, status}]
      episodes: [{series_tvdb_id, series_imdb_id, title, season, episode, watched_at}]
                only entries with is_watched=true and non-special are included
    """
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return [], []
    if not isinstance(data, list):
        return [], []
    shows: list[dict] = []
    eps: list[dict] = []
    for show in data:
        if not isinstance(show, dict):
            continue
        ids = show.get("id") or {}
        title = (show.get("title") or "").strip()
        if not title:
            continue
        tvdb = ids.get("tvdb") if isinstance(ids.get("tvdb"), int) else None
        imdb_raw = ids.get("imdb")
        imdb = imdb_raw.strip() if isinstance(imdb_raw, str) and imdb_raw.strip() else None
        shows.append({
            "tvdb_id": tvdb,
            "imdb_id": imdb,
            "title": title,
            "status": (show.get("status") or "").strip().lower() or None,
        })
        for season in show.get("seasons") or []:
            if not isinstance(season, dict) or season.get("is_specials"):
                continue
            season_num = season.get("number")
            if not isinstance(season_num, int) or season_num <= 0:
                continue
            for ep in season.get("episodes") or []:
                if not isinstance(ep, dict) or ep.get("special") or not ep.get("is_watched"):
                    continue
                ep_num = ep.get("number")
                if not isinstance(ep_num, int):
                    continue
                watched_at_raw = ep.get("watched_at") or ""
                eps.append({
                    "series_tvdb_id": tvdb,
                    "series_imdb_id": imdb,
                    "title": title,
                    "season": season_num,
                    "episode": ep_num,
                    "watched_at": _parse_tvtime_date(str(watched_at_raw)) if watched_at_raw else datetime.now(timezone.utc),
                })
    return shows, eps


def _parse_ext_series_csv(text: str) -> list[dict]:
    shows: list[dict] = []
    for row in csv.DictReader(io.StringIO(text)):
        title = (row.get("title") or "").strip()
        if not title:
            continue
        tvdb_raw = (row.get("tvdb_id") or "").strip()
        tvdb = int(tvdb_raw) if tvdb_raw.isdigit() else None
        imdb = (row.get("imdb_id") or "").strip() or None
        shows.append({
            "tvdb_id": tvdb,
            "imdb_id": imdb,
            "title": title,
            "status": (row.get("status") or "").strip().lower() or None,
        })
    return shows


def _parse_ext_episodes_csv(text: str) -> list[dict]:
    eps: list[dict] = []
    for row in csv.DictReader(io.StringIO(text)):
        if (row.get("is_watched") or "").strip().lower() != "true":
            continue
        if (row.get("special") or "").strip().lower() == "true":
            continue
        title = (row.get("title") or "").strip()
        season_raw = (row.get("season") or "").strip()
        ep_raw = (row.get("episode") or "").strip()
        if not (title and season_raw.isdigit() and ep_raw.isdigit()):
            continue
        season = int(season_raw)
        if season <= 0:
            continue
        series_tvdb_raw = (row.get("series_tvdb_id") or "").strip()
        series_tvdb = int(series_tvdb_raw) if series_tvdb_raw.isdigit() else None
        series_imdb = (row.get("series_imdb_id") or "").strip() or None
        watched_at_raw = (row.get("watched_at") or "").strip()
        eps.append({
            "series_tvdb_id": series_tvdb,
            "series_imdb_id": series_imdb,
            "title": title,
            "season": season,
            "episode": int(ep_raw),
            "watched_at": _parse_tvtime_date(watched_at_raw) if watched_at_raw else datetime.now(timezone.utc),
        })
    return eps


def _extract_tvtime_files_from_zip(raw_bytes: bytes) -> dict[str, str]:
    """Like _extract_csvs_from_zip but accepts .json files too."""
    try:
        with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
            out: dict[str, str] = {}
            total = 0
            for info in zf.infolist():
                basename = info.filename.split("/")[-1].lower()
                if not (basename.endswith(".csv") or basename.endswith(".json")):
                    continue
                if info.file_size > _MAX_CSV_BYTES:
                    raise HTTPException(status_code=422, detail=f"File '{basename}' exceeds 50 MB limit.")
                total += info.file_size
                if total > _MAX_TOTAL_BYTES:
                    raise HTTPException(status_code=422, detail="Total uncompressed size exceeds 100 MB limit.")
                out[basename] = zf.read(info.filename).decode("utf-8-sig", errors="replace")
            return out
    except zipfile.BadZipFile:
        raise HTTPException(status_code=422, detail="Invalid zip file.")


@router.post("/tvtime")
async def import_tvtime(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Accept TV Time data and import it. Supports:
      - The original TV Time "Personal Data" email zip / CSV
      - The "TV Time Out" Chrome extension export (JSON or CSV, single file or zipped)

    Routing per item:
      - watched movies        → Watched
      - unwatched movies      → Watchlist
      - watched episodes      → EpisodeWatched (auto-completes to Watched if all seen)
      - followed/listed shows → Watchlist (unless already watched / watch-listed)
      - per-show ratings      → Watched.rating when the show ends up Watched
    """
    filename = (file.filename or "").lower()
    if not (filename.endswith(".csv") or filename.endswith(".zip") or filename.endswith(".json")):
        raise HTTPException(status_code=422, detail="Please upload a .csv, .json, or .zip file.")

    raw_bytes = await file.read()
    if len(raw_bytes) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB).")

    if filename.endswith(".zip"):
        csv_map = _extract_tvtime_files_from_zip(raw_bytes)
        if not csv_map:
            raise HTTPException(status_code=422, detail="No CSV or JSON files found in zip.")
    else:
        csv_map = {filename: raw_bytes.decode("utf-8-sig", errors="replace")}

    # ── Parse: detect each file's format, route to the right parser ─────────
    # Old TV Time email format:
    episode_rows: list[dict] = []
    follow_rows: list[dict] = []
    rating_rows: list[dict] = []
    # New Chrome extension format:
    ext_movie_rows: list[dict] = []
    ext_show_rows: list[dict] = []
    ext_episode_rows: list[dict] = []

    for basename, text in csv_map.items():
        fmt = _detect_ext_format(basename, text)
        if fmt == "ext_movies_json":
            ext_movie_rows.extend(_parse_ext_movies_json(text))
            continue
        if fmt == "ext_movies_csv":
            ext_movie_rows.extend(_parse_ext_movies_csv(text))
            continue
        if fmt == "ext_series_json":
            shows, eps = _parse_ext_series_json(text)
            ext_show_rows.extend(shows)
            ext_episode_rows.extend(eps)
            continue
        if fmt == "ext_series_csv":
            ext_show_rows.extend(_parse_ext_series_csv(text))
            continue
        if fmt == "ext_episodes_csv":
            ext_episode_rows.extend(_parse_ext_episodes_csv(text))
            continue

        # Fall back to the original TV Time email-zip classifier
        if not basename.endswith(".csv"):
            continue
        reader = csv.DictReader(io.StringIO(text))
        headers = reader.fieldnames or []
        kind = _classify_tvtime_csv(basename, headers)
        if kind == "episodes":
            for row in reader:
                if len(episode_rows) >= _TVTIME_MAX_EPISODE_ROWS:
                    break
                name = _first(row, _SHOW_NAME_KEYS)
                season = _parse_int(_first(row, _SEASON_KEYS))
                ep_num = _parse_int(_first(row, _EPISODE_NUM_KEYS))
                if not name or season is None or ep_num is None:
                    continue
                episode_rows.append({
                    "name": name,
                    "season": season,
                    "episode": ep_num,
                    "watched_at": _parse_tvtime_date(_first(row, _WATCHED_AT_KEYS)),
                })
        elif kind == "follows":
            for row in reader:
                if len(follow_rows) >= _TVTIME_MAX_FOLLOW_ROWS:
                    break
                name = _first(row, _SHOW_NAME_KEYS)
                if not name:
                    continue
                follow_rows.append({"name": name, "status": _first(row, _FOLLOW_STATUS_KEYS).lower()})
        elif kind == "ratings":
            for row in reader:
                name = _first(row, _SHOW_NAME_KEYS)
                rating = _parse_tvtime_rating(_first(row, _RATING_KEYS))
                if name and rating is not None:
                    rating_rows.append({"name": name, "rating": rating})

    if not (
        episode_rows or follow_rows
        or ext_movie_rows or ext_show_rows or ext_episode_rows
    ):
        raise HTTPException(
            status_code=422,
            detail="No TV Time data found in upload.",
        )

    # Fold ext-format show/episode rows into the shared `follow_rows` and
    # `episode_rows` shapes so the rest of the pipeline doesn't branch on
    # format. The `_tvdb_id`/`_imdb_id` hints unlock external-id resolution.
    for ep in ext_episode_rows:
        episode_rows.append({
            "name": ep["title"],
            "season": ep["season"],
            "episode": ep["episode"],
            "watched_at": ep["watched_at"],
            "_tvdb_id": ep["series_tvdb_id"],
            "_imdb_id": ep["series_imdb_id"],
        })
    for show in ext_show_rows:
        # Treat each ext-format show row as a "follow": watchlist target unless
        # we end up writing watched episodes for it.
        follow_rows.append({
            "name": show["title"],
            "status": show.get("status") or "",
            "_tvdb_id": show.get("tvdb_id"),
            "_imdb_id": show.get("imdb_id"),
        })

    # ── Resolve shows + movies in TMDB concurrently ─────────────────────────
    # For each unique show name, collect the best external ids we know about.
    show_ids: dict[str, dict] = {}
    for r in episode_rows + follow_rows:
        cur = show_ids.setdefault(r["name"], {"tvdb_id": None, "imdb_id": None})
        cur["tvdb_id"] = cur["tvdb_id"] or r.get("_tvdb_id")
        cur["imdb_id"] = cur["imdb_id"] or r.get("_imdb_id")

    all_names = list(show_ids.keys())
    sem = asyncio.Semaphore(_CONCURRENCY)

    async def resolve_show(name: str) -> tuple[str, int | None, str | None]:
        ids = show_ids.get(name, {})
        async with sem:
            try:
                return name, await asyncio.to_thread(
                    _resolve_ext_show, ids.get("tvdb_id"), ids.get("imdb_id"), name
                ), None
            except Exception as e:
                return name, None, str(e)[:80]

    async def resolve_movie(idx: int, row: dict) -> tuple[int, tuple[int, str] | None, str | None]:
        async with sem:
            try:
                hit = await asyncio.to_thread(
                    _resolve_ext_movie,
                    row.get("imdb_id"), row.get("tvdb_id"),
                    row.get("title"), row.get("year"),
                )
                return idx, hit, None
            except Exception as e:
                return idx, None, str(e)[:80]

    show_tasks = [resolve_show(n) for n in all_names]
    movie_tasks = [resolve_movie(i, m) for i, m in enumerate(ext_movie_rows)]
    combined = await asyncio.gather(*show_tasks, *movie_tasks)
    show_results = combined[:len(show_tasks)]
    movie_results = combined[len(show_tasks):]

    name_to_show: dict[str, int | None] = {n: sid for n, sid, _ in show_results}
    name_to_error: dict[str, str | None] = {n: err for n, _, err in show_results}

    for idx, hit, err in movie_results:
        row = ext_movie_rows[idx]
        row["_tmdb_id"] = hit[0] if hit else None
        row["_media_type"] = hit[1] if hit else None
        row["_tmdb_error"] = err

    # ── Prefetch show + movie details for ones not yet in the DB ────────────
    needed_show_ids = {sid for sid in name_to_show.values() if sid}
    # Some "movies" may resolve as TV (e.g. mini-series IMDb ids).
    needed_show_ids |= {
        r["_tmdb_id"] for r in ext_movie_rows
        if r.get("_tmdb_id") and r.get("_media_type") == "tv"
    }
    needed_movie_ids = {
        r["_tmdb_id"] for r in ext_movie_rows
        if r.get("_tmdb_id") and r.get("_media_type") == "movie"
    }

    existing_show_ids = (
        {sid for (sid,) in db.query(Show.id).filter(Show.id.in_(needed_show_ids)).all()}
        if needed_show_ids else set()
    )
    existing_movie_ids = (
        {mid for (mid,) in db.query(Movie.id).filter(Movie.id.in_(needed_movie_ids)).all()}
        if needed_movie_ids else set()
    )
    missing_show_ids = needed_show_ids - existing_show_ids
    missing_movie_ids = needed_movie_ids - existing_movie_ids

    async def prefetch_show(show_id: int) -> None:
        async with sem:
            try:
                await asyncio.to_thread(fetch_show_from_tmdb, show_id, _SHOW_APPEND)
            except Exception:
                pass

    async def prefetch_movie(movie_id: int) -> None:
        async with sem:
            try:
                await asyncio.to_thread(fetch_movie_from_tmdb, movie_id, _MOVIE_APPEND)
            except Exception:
                pass

    await asyncio.gather(
        *[prefetch_show(sid) for sid in missing_show_ids],
        *[prefetch_movie(mid) for mid in missing_movie_ids],
    )

    # ── Sequentially upsert Show/Movie rows we'll need ──────────────────────
    # Both ensure_*_in_db helpers fast-path when the row already exists, so
    # this is effectively a no-op for items the user already has tracked
    # (the user's stated goal: "skip things already in the database").
    # Doing it here, serially, also closes the race where two parallel season
    # syncs would both try to insert the same Show row and poison the session.
    for sid in needed_show_ids:
        try:
            ensure_show_in_db(
                db, sid, db.query(Show).filter_by(id=sid).first() is not None
            )
        except Exception:
            db.rollback()
    for mid in needed_movie_ids:
        try:
            ensure_movie_in_db(
                db, mid, db.query(Movie).filter_by(id=mid).first() is not None
            )
        except Exception:
            db.rollback()
    try:
        db.commit()
    except Exception:
        db.rollback()

    # ── Episodes: group by (show_id, season) so we sync each season once ────
    episodes_by_show: dict[int, list[dict]] = {}
    unresolved_shows: dict[str, str | None] = {}  # name -> error reason

    for row in episode_rows:
        sid = name_to_show.get(row["name"])
        if not sid:
            unresolved_shows[row["name"]] = name_to_error.get(row["name"])
            continue
        episodes_by_show.setdefault(sid, []).append(row)

    # Sync the seasons we'll need (one TMDB call per show+season, not per episode)
    seasons_needed: set[tuple[int, int]] = {
        (sid, ep["season"])
        for sid, eps in episodes_by_show.items()
        for ep in eps
    }

    def _sync_in_thread(sid: int, season: int) -> None:
        # SQLAlchemy Sessions are not thread-safe; the request `db` cannot be
        # shared across the concurrent worker threads asyncio.to_thread spawns.
        # Each worker gets its own session and closes it before returning.
        thread_db = SessionLocal()
        try:
            sync_season_episodes(thread_db, sid, season)
        finally:
            thread_db.close()

    async def sync_one(sid: int, season: int) -> None:
        async with sem:
            try:
                await asyncio.to_thread(_sync_in_thread, sid, season)
            except Exception:
                pass

    await asyncio.gather(*[sync_one(sid, season) for sid, season in seasons_needed])

    # ── Write phase ─────────────────────────────────────────────────────────
    episodes_imported = 0
    episodes_skipped = 0
    shows_watchlisted = 0
    shows_skipped = 0
    failed = 0
    per_show: dict[int, dict] = {}  # show_id -> {title, episodes_added, ...}
    failures: list[dict] = []

    rating_by_name = {r["name"]: r["rating"] for r in rating_rows}

    # Items the user is already actively tracking — re-adding them produces
    # noise (duplicate activity events, list churn). We skip these entirely.
    currently_watching: set[tuple[str, int]] = {
        (ct, cid)
        for (ct, cid) in db.query(
            CurrentlyWatching.content_type, CurrentlyWatching.content_id
        ).filter_by(user_id=uid).all()
    }

    for sid, eps in episodes_by_show.items():
        show = db.query(Show).filter_by(id=sid).first()
        if not show:
            failed += len(eps)
            failures.append({"show": str(sid), "reason": "show not in DB after fetch"})
            continue

        if ("tv", sid) in currently_watching:
            episodes_skipped += len(eps)
            per_show[sid] = {"title": show.name, "episodes_added": 0}
            continue

        # Existing watched-episode keys for this user+show
        already = {
            (s, e)
            for (s, e) in db.query(EpisodeWatched.season_number, EpisodeWatched.episode_number)
            .filter_by(user_id=uid, show_id=sid)
            .all()
        }

        # Map episodes in this season+number to their TMDB episode_id for FK
        ep_ids = {
            (s, e): eid
            for (s, e, eid) in db.query(
                Episode.season_number, Episode.episode_number, Episode.id
            )
            .filter(Episode.show_id == sid)
            .all()
        }

        added_here = 0
        for row in eps:
            key = (row["season"], row["episode"])
            if key in already:
                episodes_skipped += 1
                continue
            already.add(key)
            db.add(
                EpisodeWatched(
                    user_id=uid,
                    show_id=sid,
                    episode_id=ep_ids.get(key),
                    season_number=row["season"],
                    episode_number=row["episode"],
                    watched_at=row["watched_at"],
                )
            )
            added_here += 1
            episodes_imported += 1

        if added_here:
            try:
                db.commit()
            except Exception as e:
                db.rollback()
                failed += added_here
                episodes_imported -= added_here
                failures.append({"show": show.name, "reason": f"DB error: {str(e)[:80]}"})
                continue

            # Auto-complete to Watched if the user followed this on TV Time as
            # "watched"/"finished" or every aired episode is now marked seen.
            try:
                maybe_auto_complete_show(db, uid, sid)
            except Exception:
                db.rollback()

        per_show[sid] = {"title": show.name, "episodes_added": added_here}

    # ── Followed shows that didn't appear in watched episodes -> Watchlist ──
    watched_or_progress = set(episodes_by_show.keys())
    for follow in follow_rows:
        sid = name_to_show.get(follow["name"])
        if not sid:
            unresolved_shows.setdefault(follow["name"], name_to_error.get(follow["name"]))
            continue
        if sid in watched_or_progress:
            continue
        if ("tv", sid) in currently_watching:
            shows_skipped += 1
            continue
        on_watched = db.query(Watched).filter_by(
            user_id=uid, content_type="tv", content_id=sid
        ).first()
        if on_watched:
            shows_skipped += 1
            continue
        on_wl = db.query(Watchlist).filter_by(
            user_id=uid, content_type="tv", content_id=sid
        ).first()
        if on_wl:
            shows_skipped += 1
            continue
        try:
            ensure_show_in_db(db, sid, db.query(Show).filter_by(id=sid).first() is not None)
            add_to_watchlist(db, uid, "tv", sid)
            shows_watchlisted += 1
        except Exception as e:
            db.rollback()
            failures.append({"show": follow["name"], "reason": str(e)[:120]})
            failed += 1

    # ── Movies (ext format only) ────────────────────────────────────────────
    movies_imported = 0
    movies_watchlisted = 0
    movies_skipped = 0
    movie_results_out: list[dict] = []
    seen_movie_pairs: set[tuple[int, str]] = set()

    for row in ext_movie_rows:
        title = row["title"]
        tmdb_id = row.get("_tmdb_id")
        media_type = row.get("_media_type") or "movie"
        err = row.get("_tmdb_error")

        if err:
            failed += 1
            movie_results_out.append({
                "title": title, "status": "failed",
                "reason": f"TMDB search error: {err}",
            })
            continue
        if not tmdb_id:
            failed += 1
            movie_results_out.append({
                "title": title, "status": "failed", "reason": "not found on TMDB",
            })
            continue

        pair = (tmdb_id, media_type)
        if pair in seen_movie_pairs:
            movies_skipped += 1
            movie_results_out.append({
                "title": title, "tmdb_id": tmdb_id, "media_type": media_type,
                "status": "skipped", "reason": "duplicate in import",
            })
            continue
        seen_movie_pairs.add(pair)

        # Already in CurrentlyWatching → leave it alone (no Watched/Watchlist
        # write, no activity event).
        if (media_type, tmdb_id) in currently_watching:
            movies_skipped += 1
            movie_results_out.append({
                "title": title, "tmdb_id": tmdb_id, "media_type": media_type,
                "status": "skipped", "reason": "already currently watching",
            })
            continue

        try:
            if media_type == "movie":
                already_tracked = db.query(Movie).filter_by(id=tmdb_id).first() is not None
                media = ensure_movie_in_db(db, tmdb_id, already_tracked)
                resolved_title = media.title
            else:
                already_tracked = db.query(Show).filter_by(id=tmdb_id).first() is not None
                media = ensure_show_in_db(db, tmdb_id, already_tracked)
                resolved_title = media.name
        except Exception as e:
            db.rollback()
            failed += 1
            movie_results_out.append({
                "title": title, "status": "failed",
                "reason": f"DB error: {str(e)[:80]}",
            })
            continue

        if row["is_watched"]:
            existing = db.query(Watched).filter_by(
                user_id=uid, content_type=media_type, content_id=tmdb_id
            ).first()
            if existing:
                movies_skipped += 1
                movie_results_out.append({
                    "title": resolved_title, "tmdb_id": tmdb_id, "media_type": media_type,
                    "status": "skipped", "reason": "already in watched",
                })
                continue
            try:
                watched_at = row["watched_at"]
                db.add(Watched(
                    user_id=uid, content_type=media_type, content_id=tmdb_id,
                    watched_at=watched_at,
                ))
                db.commit()
                movies_imported += 1
                movie_results_out.append({
                    "title": resolved_title, "tmdb_id": tmdb_id, "media_type": media_type,
                    "status": "imported",
                    "watched_at": watched_at.strftime("%Y-%m-%d") if watched_at else None,
                })
            except Exception as e:
                db.rollback()
                failed += 1
                movie_results_out.append({
                    "title": title, "status": "failed", "reason": str(e)[:120],
                })
        else:
            # "Want to watch" → watchlist (skip if already watched / watch-listed)
            on_watched = db.query(Watched).filter_by(
                user_id=uid, content_type=media_type, content_id=tmdb_id
            ).first()
            if on_watched:
                movies_skipped += 1
                movie_results_out.append({
                    "title": resolved_title, "tmdb_id": tmdb_id, "media_type": media_type,
                    "status": "skipped", "reason": "already in watched",
                })
                continue
            on_wl = db.query(Watchlist).filter_by(
                user_id=uid, content_type=media_type, content_id=tmdb_id
            ).first()
            if on_wl:
                movies_skipped += 1
                movie_results_out.append({
                    "title": resolved_title, "tmdb_id": tmdb_id, "media_type": media_type,
                    "status": "skipped", "reason": "already in watchlist",
                })
                continue
            try:
                add_to_watchlist(db, uid, media_type, tmdb_id)
                db.commit()
                movies_watchlisted += 1
                movie_results_out.append({
                    "title": resolved_title, "tmdb_id": tmdb_id, "media_type": media_type,
                    "status": "watchlisted",
                })
            except Exception as e:
                db.rollback()
                failed += 1
                movie_results_out.append({
                    "title": title, "status": "failed", "reason": str(e)[:120],
                })

    # ── Apply ratings on Watched rows that now exist ────────────────────────
    ratings_applied = 0
    for name, rating in rating_by_name.items():
        sid = name_to_show.get(name)
        if not sid:
            continue
        w = db.query(Watched).filter_by(user_id=uid, content_type="tv", content_id=sid).first()
        if w and w.rating is None:
            w.rating = rating
            ratings_applied += 1
    if ratings_applied:
        db.commit()

    # ── Build response ──────────────────────────────────────────────────────
    results = [
        {
            "title": info["title"],
            "tmdb_id": sid,
            "media_type": "tv",
            "status": "imported",
            "episodes_added": info["episodes_added"],
        }
        for sid, info in per_show.items()
    ]
    for name, err in unresolved_shows.items():
        results.append({
            "title": name,
            "status": "failed",
            "reason": f"TMDB search error: {err}" if err else "not found on TMDB",
        })
        failed += 1
    results.extend(movie_results_out)

    imported_total = episodes_imported + movies_imported
    watchlisted_total = shows_watchlisted + movies_watchlisted
    skipped_total = episodes_skipped + shows_skipped + movies_skipped

    return {
        "summary": {
            "total": imported_total + watchlisted_total + skipped_total + failed,
            "imported": imported_total,
            "watchlisted": watchlisted_total,
            "skipped": skipped_total,
            "failed": failed,
            "ratings_applied": ratings_applied,
            "shows_with_episodes": len(per_show),
            "movies_imported": movies_imported,
            "movies_watchlisted": movies_watchlisted,
        },
        "results": results,
        "failures": failures,
    }
