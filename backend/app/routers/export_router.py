import csv
import io
import json
import zipfile
from datetime import datetime, timezone

from fastapi import Depends
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRouter

from app.db.session import SessionLocal
from app.dependencies.auth import get_current_user
from app.models.movie import Movie
from app.models.rewatch import Rewatch
from app.models.review import Review
from app.models.shelf import Shelf
from app.models.shelf_item import ShelfItem
from app.models.show import Show
from app.models.user import User
from app.models.watched import Watched
from app.models.watchlist import Watchlist

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _build_title_lookup(db, items: list) -> dict[tuple, str]:
    """Fetch all needed titles in two bulk queries instead of one per row."""
    show_ids = {i.content_id for i in items if i.content_type == "tv"}
    movie_ids = {i.content_id for i in items if i.content_type == "movie"}

    show_titles = {}
    if show_ids:
        for row in db.query(Show.id, Show.name).filter(Show.id.in_(show_ids)).all():
            show_titles[row[0]] = row[1]

    movie_titles = {}
    if movie_ids:
        for row in db.query(Movie.id, Movie.title).filter(Movie.id.in_(movie_ids)).all():
            movie_titles[row[0]] = row[1]

    lookup = {}
    for i in items:
        if i.content_type == "tv":
            lookup[(i.content_type, i.content_id)] = show_titles.get(i.content_id, str(i.content_id))
        else:
            lookup[(i.content_type, i.content_id)] = movie_titles.get(i.content_id, str(i.content_id))
    return lookup


def _csv_bytes(rows: list[dict], fieldnames: list[str]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue().encode()


@router.get("/zip")
def export_zip(
    db=Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()

    # Fetch all user data in one pass
    watched_items = db.query(Watched).filter_by(user_id=uid).all()
    watchlist_items = db.query(Watchlist).filter_by(user_id=uid).all()
    review_items = db.query(Review).filter_by(user_id=uid).all()
    rewatch_items = db.query(Rewatch).filter_by(user_id=uid).all()
    shelves = db.query(Shelf).filter_by(user_id=uid).all()
    shelf_items = db.query(ShelfItem).filter_by(user_id=uid).all()

    # Build title lookups with two bulk queries per source table
    all_content = watched_items + watchlist_items + review_items + rewatch_items + shelf_items
    titles = _build_title_lookup(db, all_content)

    def t(content_type, content_id):
        return titles.get((content_type, content_id), str(content_id))

    # ── watched ───────────────────────────────────────────────────────────────
    watched_rows = [
        {
            "type": w.content_type,
            "title": t(w.content_type, w.content_id),
            "tmdb_id": w.content_id,
            "rating": w.rating if w.rating is not None else "",
            "watched_at": w.watched_at.date() if w.watched_at else "",
        }
        for w in watched_items
    ]

    # ── watchlist ─────────────────────────────────────────────────────────────
    watchlist_rows = [
        {
            "type": w.content_type,
            "title": t(w.content_type, w.content_id),
            "tmdb_id": w.content_id,
            "added_at": w.added_at.date() if w.added_at else "",
        }
        for w in watchlist_items
    ]

    # ── reviews ───────────────────────────────────────────────────────────────
    review_rows = [
        {
            "type": r.content_type,
            "title": t(r.content_type, r.content_id),
            "tmdb_id": r.content_id,
            "review": r.review_text,
            "created_at": r.created_at.date() if r.created_at else "",
        }
        for r in review_items
    ]

    # ── rewatches ─────────────────────────────────────────────────────────────
    rewatch_rows = [
        {
            "type": r.content_type,
            "title": t(r.content_type, r.content_id),
            "tmdb_id": r.content_id,
            "rating": r.rating if r.rating is not None else "",
            "notes": r.notes or "",
            "watched_at": r.watched_at.date() if r.watched_at else "",
        }
        for r in rewatch_items
    ]

    # ── shelves + items ───────────────────────────────────────────────────────
    shelf_map = {s.id: s.name for s in shelves}
    shelf_rows = [
        {
            "shelf": shelf_map.get(item.shelf_id, item.shelf_id),
            "type": item.content_type,
            "title": t(item.content_type, item.content_id),
            "tmdb_id": item.content_id,
            "added_at": item.added_at.date() if item.added_at else "",
        }
        for item in shelf_items
    ]

    # ── profile JSON ──────────────────────────────────────────────────────────
    profile = {
        "username": user.username,
        "email": user.email,
        "bio": user.bio,
        "avatar_key": user.avatar_key,
        "profile_visibility": user.profile_visibility,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "subscription_tier": user.subscription_tier,
        "email_notifications": user.email_notifications,
        "notification_frequency": user.notification_frequency,
    }

    # ── build zip ─────────────────────────────────────────────────────────────
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("watched.csv", _csv_bytes(watched_rows, ["type", "title", "tmdb_id", "rating", "watched_at"]))
        zf.writestr("watchlist.csv", _csv_bytes(watchlist_rows, ["type", "title", "tmdb_id", "added_at"]))
        zf.writestr("reviews.csv", _csv_bytes(review_rows, ["type", "title", "tmdb_id", "review", "created_at"]))
        zf.writestr("rewatches.csv", _csv_bytes(rewatch_rows, ["type", "title", "tmdb_id", "rating", "notes", "watched_at"]))
        zf.writestr("shelves.csv", _csv_bytes(shelf_rows, ["shelf", "type", "title", "tmdb_id", "added_at"]))
        zf.writestr("profile.json", json.dumps(profile, indent=2, default=str))

    zip_buf.seek(0)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"releaseradar-{user.username or uid}-{stamp}.zip"

    return StreamingResponse(
        zip_buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
