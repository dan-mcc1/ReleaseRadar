import base64
import hashlib
import hmac
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.limiter import limiter, rate_limit
from app.db.session import get_db
from app.dependencies.auth import _is_email_banned
from app.dependencies.subscription import _get_tier, require_admin
from app.models.currently_watching import CurrentlyWatching
from app.models.episode_watched import EpisodeWatched
from app.models.movie import Movie
from app.models.rewatch import Rewatch
from app.models.show import Show
from app.models.user import User
from app.models.watched import Watched
from app.models.watchlist import Watchlist

router = APIRouter()

_POSTER_BASE = "https://image.tmdb.org/t/p/w500"

# Higher rank wins when an item sits in several lists.
_STATUS_RANK = {"watchlist": 0, "watching": 1, "watched": 2}


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    dt = _utc(dt)
    return dt.isoformat() if dt else None


def _poster(path: str | None) -> str | None:
    return f"{_POSTER_BASE}{path}" if path else None


# ── Token helpers ─────────────────────────────────────────────────────────────


def _require_secret() -> str:
    secret = settings.SYNC_TOKEN_SECRET
    if not secret:
        raise HTTPException(status_code=503, detail="Sync tokens are not configured")
    return secret


def _sign(secret: str, user_id: str, version: int) -> str:
    payload = f"sync:{user_id}:{version}".encode()
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()[:32]


def _make_token(user_id: str, version: int) -> str:
    """Return a token that encodes and authenticates the user_id + version."""
    uid_b64 = base64.urlsafe_b64encode(user_id.encode()).decode().rstrip("=")
    return f"{uid_b64}.{version}.{_sign(_require_secret(), user_id, version)}"


def _verify_token(token: str, db: Session) -> User | None:
    """Return the user if the token is valid and its version is current, else None."""
    secret = _require_secret()
    # Only parsing is caught: a database error must surface as a 5xx, not as a
    # 401 a client would take to mean its token was revoked.
    try:
        uid_b64, version_str, sig = token.split(".", 2)
        version = int(version_str)
        padding = (4 - len(uid_b64) % 4) % 4
        user_id = base64.urlsafe_b64decode(uid_b64 + "=" * padding).decode()
        # TypeError: compare_digest refuses non-ASCII str
        if not hmac.compare_digest(sig, _sign(secret, user_id, version)):
            return None
    except (ValueError, TypeError):  # binascii.Error and UnicodeDecodeError are ValueErrors
        return None
    user = db.get(User, user_id)
    if user is None or user.sync_token_version != version:
        return None
    return user


def _bearer_user(request: Request, db: Session = Depends(get_db)) -> User:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="Missing sync token")
    user = _verify_token(token.strip(), db)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or revoked sync token")
    request.state.uid = user.id  # rate limits count per user (core/limiter.py)
    # Same checks and error shapes as get_token_claims (dependencies/auth.py)
    if user.email and _is_email_banned(user.email, db):
        raise HTTPException(
            status_code=403,
            detail={"code": "account_banned", "message": "Your account has been permanently banned."},
        )
    if user.is_banned:
        raise HTTPException(
            status_code=403,
            detail={"code": "account_banned", "message": "Your account has been banned."},
        )
    if user.is_suspended and not (
        user.suspended_until and datetime.now(timezone.utc) >= _utc(user.suspended_until)
    ):
        until = user.suspended_until.strftime("%Y-%m-%d") if user.suspended_until else "further notice"
        raise HTTPException(
            status_code=403,
            detail={"code": "account_suspended", "message": f"Your account has been suspended until {until}."},
        )
    # Checked on every use so a demoted user's token stops working.
    if _get_tier(user.id, db) != "admin":
        raise HTTPException(
            status_code=403,
            detail={"code": "admin_required", "message": "Sync tokens are for admins only."},
        )
    return user


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/token")
def get_sync_token(
    uid: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Return the user's personal sync token (read-only export access)."""
    _require_secret()
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"token": _make_token(uid, user.sync_token_version)}


@router.post("/token/revoke")
def revoke_sync_token(
    uid: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Invalidate the current sync token and return a new one."""
    _require_secret()
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.sync_token_version = (user.sync_token_version or 0) + 1
    db.commit()
    return {"token": _make_token(uid, user.sync_token_version)}


@router.get(
    "/export",
    # Runs before _bearer_user, so failed token attempts are counted per IP
    # too; the decorator below only sees requests that authenticated.
    dependencies=[Depends(rate_limit("sync_export_auth", "SYNC_AUTH_RATE_LIMIT"))],
)
@limiter.limit("6/minute")
def export_sync(
    request: Request,
    user: User = Depends(_bearer_user),
    db: Session = Depends(get_db),
):
    """Read-only snapshot of the user's movie/TV/episode watch state."""
    uid = user.id

    # content_type -> tmdb_id -> entry
    items: dict[str, dict[int, dict]] = {"movie": {}, "tv": {}}

    def merge(content_type, content_id, status, added_at, watched_at=None, rating=None):
        entry = items[content_type].get(content_id)
        if entry is None:
            entry = items[content_type][content_id] = {
                "status": status,
                "added_at": None,
                "watched_at": None,
                "rating": None,
            }
        elif _STATUS_RANK[status] > _STATUS_RANK[entry["status"]]:
            entry["status"] = status
        added_at = _utc(added_at)
        if added_at is not None and (entry["added_at"] is None or added_at < entry["added_at"]):
            entry["added_at"] = added_at
        if watched_at is not None:
            entry["watched_at"] = _utc(watched_at)
        if rating is not None:
            entry["rating"] = rating

    for r in db.execute(
        select(Watched.content_type, Watched.content_id, Watched.watched_at, Watched.rating)
        .where(Watched.user_id == uid)
    ):
        if r.content_type in items:
            merge(r.content_type, r.content_id, "watched", r.watched_at, r.watched_at, r.rating)

    for r in db.execute(
        select(CurrentlyWatching.content_type, CurrentlyWatching.content_id, CurrentlyWatching.added_at)
        .where(CurrentlyWatching.user_id == uid)
    ):
        if r.content_type in items:
            merge(r.content_type, r.content_id, "watching", r.added_at)

    for r in db.execute(
        select(Watchlist.content_type, Watchlist.content_id, Watchlist.added_at)
        .where(Watchlist.user_id == uid)
    ):
        if r.content_type in items:
            merge(r.content_type, r.content_id, "watchlist", r.added_at)

    # Cached TMDb metadata: one query per kind.
    def meta(model, name_col, ids):
        if not ids:
            return {}
        rows = db.execute(select(model.id, name_col, model.poster_path).where(model.id.in_(ids)))
        return {r[0]: (r[1], _poster(r[2])) for r in rows}

    movie_meta = meta(Movie, Movie.title, list(items["movie"]))
    show_meta = meta(Show, Show.name, list(items["tv"]))

    def build(content_type, cached):
        out = []
        for tmdb_id, e in sorted(items[content_type].items()):
            title, poster = cached.get(tmdb_id, (None, None))
            out.append({
                "tmdb_id": tmdb_id,
                "title": title,
                "poster_url": poster,
                "status": e["status"],
                "added_at": _iso(e["added_at"]),
                "watched_at": _iso(e["watched_at"]),
                "rating": e["rating"],
            })
        return out

    episodes = [
        {
            "show_tmdb_id": r.show_id,
            "season_number": r.season_number,
            "episode_number": r.episode_number,
            "watched_at": _iso(r.watched_at),
            "rating": r.rating,
        }
        for r in db.execute(
            select(
                EpisodeWatched.show_id,
                EpisodeWatched.season_number,
                EpisodeWatched.episode_number,
                EpisodeWatched.watched_at,
                EpisodeWatched.rating,
            )
            .where(EpisodeWatched.user_id == uid)
            .order_by(EpisodeWatched.show_id, EpisodeWatched.season_number, EpisodeWatched.episode_number)
        )
    ]

    rewatches = [
        {
            "content_type": r.content_type,
            "tmdb_id": r.content_id,
            "watched_at": _iso(r.watched_at),
            "rating": r.rating,
        }
        for r in db.execute(
            select(Rewatch.content_type, Rewatch.content_id, Rewatch.watched_at, Rewatch.rating)
            .where(Rewatch.user_id == uid)
            .order_by(Rewatch.id)
        )
    ]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "movies": build("movie", movie_meta),
        "shows": build("tv", show_meta),
        "episodes": episodes,
        "rewatches": rewatches,
    }
