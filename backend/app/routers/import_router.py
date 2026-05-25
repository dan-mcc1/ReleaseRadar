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
from app.services.tmdb_tv import fetch_show_from_tmdb
from app.services.tmdb_search import get_tv_search_results
from app.services.media_upsert import ensure_movie_in_db, ensure_show_in_db
from app.services.watchlist_service import add_to_watchlist
from app.services.episode_service import maybe_sync_show_episodes, sync_season_episodes
from app.services.watched_episode_service import maybe_auto_complete_show
from app.models.watched import Watched
from app.models.watchlist import Watchlist
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


@router.post("/tvtime")
async def import_tvtime(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Accept a TV Time Personal Data zip (or a single CSV) and import:
      - watched episodes -> EpisodeWatched (and auto-complete to Watched if all seen)
      - followed shows  -> Watchlist (unless already watched / watch-listed)
      - per-show ratings -> Watched.rating when the show ends up Watched
    """
    filename = (file.filename or "").lower()
    if not (filename.endswith(".csv") or filename.endswith(".zip")):
        raise HTTPException(status_code=422, detail="Please upload a .csv or .zip file.")

    raw_bytes = await file.read()
    if len(raw_bytes) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 20 MB).")

    # Build {basename: text} just like the Letterboxd path.
    if filename.endswith(".zip"):
        csv_map = _extract_csvs_from_zip(raw_bytes)
        if not csv_map:
            raise HTTPException(status_code=422, detail="No CSV files found in zip.")
    else:
        csv_map = {filename: raw_bytes.decode("utf-8-sig", errors="replace")}

    # ── Classify CSVs and collect rows ──────────────────────────────────────
    episode_rows: list[dict] = []
    follow_rows: list[dict] = []
    rating_rows: list[dict] = []

    for basename, text in csv_map.items():
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

    if not (episode_rows or follow_rows):
        raise HTTPException(
            status_code=422,
            detail="No TV Time episode or follow data found in upload.",
        )

    # ── Resolve each unique show name to a TMDB id, concurrently ────────────
    all_names = {r["name"] for r in episode_rows} | {r["name"] for r in follow_rows}
    sem = asyncio.Semaphore(_CONCURRENCY)

    async def resolve(name: str) -> tuple[str, int | None, str | None]:
        async with sem:
            try:
                return name, await asyncio.to_thread(_find_tv_show_id, name, None), None
            except Exception as e:
                return name, None, str(e)[:80]

    resolved_list = await asyncio.gather(*[resolve(n) for n in all_names])
    name_to_show: dict[str, int | None] = {n: sid for n, sid, _ in resolved_list}
    name_to_error: dict[str, str | None] = {n: err for n, _, err in resolved_list}

    # ── Prefetch show details for ones not yet in the DB ────────────────────
    needed_ids = {sid for sid in name_to_show.values() if sid}
    existing_ids = (
        {sid for (sid,) in db.query(Show.id).filter(Show.id.in_(needed_ids)).all()}
        if needed_ids else set()
    )
    missing_ids = needed_ids - existing_ids

    async def prefetch(show_id: int) -> None:
        async with sem:
            try:
                await asyncio.to_thread(fetch_show_from_tmdb, show_id, _SHOW_APPEND)
            except Exception:
                pass

    await asyncio.gather(*[prefetch(sid) for sid in missing_ids])

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

    async def sync_one(sid: int, season: int) -> None:
        async with sem:
            try:
                await asyncio.to_thread(sync_season_episodes, db, sid, season)
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

    for sid, eps in episodes_by_show.items():
        show = db.query(Show).filter_by(id=sid).first()
        if not show:
            failed += len(eps)
            failures.append({"show": str(sid), "reason": "show not in DB after fetch"})
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

    return {
        "summary": {
            "total": episodes_imported + episodes_skipped + shows_watchlisted + shows_skipped + failed,
            "imported": episodes_imported,
            "watchlisted": shows_watchlisted,
            "skipped": episodes_skipped + shows_skipped,
            "failed": failed,
            "ratings_applied": ratings_applied,
            "shows_with_episodes": len(per_show),
        },
        "results": results,
        "failures": failures,
    }
