from collections import defaultdict

from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.movie import Movie
from app.models.movie_video import MovieVideo
from app.models.show import Show
from app.models.show_video import ShowVideo
from app.models.user import User
from app.models.watchlist import Watchlist
from app.db.session import SessionLocal
from app.services.email_service import send_trailer_alert_email
from app.services.push_service import push_notification, tmdb_poster_url
from app.services.tmdb_movies import fetch_movie_from_tmdb
from app.services.tmdb_tv import fetch_show_from_tmdb

_NOTIFY_TYPES = {"Trailer"}


def _fetch_videos(content_id: int, content_type: str) -> list[dict]:
    if content_type == "movie":
        data = fetch_movie_from_tmdb(content_id, "videos")
    else:
        data = fetch_show_from_tmdb(content_id, "videos")
    if not data:
        return []
    return data.get("videos", {}).get("results", [])


def _detect_new_videos(
    db: Session, content_id: int, content_type: str, fresh_videos: list[dict]
) -> list[dict]:
    """
    Compare fresh TMDb videos against stored ones.
    Returns list of new official Trailer/Teaser video dicts.
    Persists new video rows to DB (caller must commit).
    """
    video_model = ShowVideo if content_type == "tv" else MovieVideo
    id_kwarg = {"show_id": content_id} if content_type == "tv" else {"movie_id": content_id}

    existing_keys = {
        row.video_key
        for row in db.query(video_model).filter_by(**id_kwarg).all()
    }

    new_videos = []
    for v in fresh_videos:
        key = v.get("key")
        vtype = v.get("type", "")
        if not key or key in existing_keys or vtype not in _NOTIFY_TYPES or not v.get("official"):
            continue
        existing_keys.add(key)
        db.add(
            video_model(
                video_key=key,
                name=v.get("name"),
                **id_kwarg,
            )
        )
        new_videos.append(v)

    return new_videos


def ensure_trailers_populated(db: Session, content_id: int, content_type: str) -> None:
    """
    Fast path for newly-tracked content: if no video rows exist yet, fetch
    and insert them immediately so the nightly refresh doesn't treat every
    existing trailer as "new" and spam the user. Failures are swallowed —
    the nightly job is the reliable fallback.
    """
    video_model = ShowVideo if content_type == "tv" else MovieVideo
    id_kwarg = {"show_id": content_id} if content_type == "tv" else {"movie_id": content_id}

    already_stored = db.query(video_model).filter_by(**id_kwarg).first() is not None
    if already_stored:
        return

    try:
        fresh = _fetch_videos(content_id, content_type)
        _detect_new_videos(db, content_id, content_type, fresh)
        # No commit — caller owns the transaction
    except Exception:
        pass


def ensure_trailers_populated_bg(content_id: int, content_type: str) -> None:
    """Background-safe wrapper: opens its own session and commits."""
    db = SessionLocal()
    try:
        ensure_trailers_populated(db, content_id, content_type)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"[ensure_trailers_populated_bg] Error for {content_type} {content_id}: {e}")
    finally:
        db.close()


def refresh_trailers(db: Session) -> None:
    """
    Nightly task: check TMDb for new official trailers/teasers on all tracked
    content, persist new video rows, and email opted-in users.
    """
    tracked: set[tuple[int, str]] = set()
    for row in db.query(Watchlist.content_id, Watchlist.content_type).distinct():
        tracked.add((row.content_id, row.content_type))
    for row in db.query(CurrentlyWatching.content_id, CurrentlyWatching.content_type).distinct():
        tracked.add((row.content_id, row.content_type))

    if not tracked:
        return

    changes: dict[tuple[int, str], list[dict]] = {}
    for content_id, content_type in tracked:
        try:
            fresh = _fetch_videos(content_id, content_type)
            new_vids = _detect_new_videos(db, content_id, content_type, fresh)
            if new_vids:
                changes[(content_id, content_type)] = new_vids
        except Exception as e:
            print(f"[trailers] Error refreshing {content_type} {content_id}: {e}")

    db.commit()

    if not changes:
        return

    movie_ids = [cid for (cid, ct) in changes if ct == "movie"]
    show_ids = [cid for (cid, ct) in changes if ct == "tv"]

    movie_info = {}
    if movie_ids:
        for m in db.query(Movie).filter(Movie.id.in_(movie_ids)).all():
            movie_info[m.id] = {"title": m.title, "poster_path": m.poster_path}

    show_info = {}
    if show_ids:
        for s in db.query(Show).filter(Show.id.in_(show_ids)).all():
            show_info[s.id] = {"title": s.name, "poster_path": s.poster_path}

    user_alerts: dict[str, list] = defaultdict(list)

    for (content_id, content_type), new_vids in changes.items():
        info = (movie_info if content_type == "movie" else show_info).get(content_id, {})
        alert = {
            "title": info.get("title", "Unknown"),
            "content_type": content_type,
            "content_id": content_id,
            "poster_path": info.get("poster_path"),
            "videos": [
                {"key": v.get("key"), "name": v.get("name")}
                for v in new_vids
            ],
        }

        watchlist_uids = {
            r.user_id
            for r in db.query(Watchlist.user_id).filter(
                Watchlist.content_id == content_id,
                Watchlist.content_type == content_type,
                Watchlist.notify == True,  # noqa: E712
            )
        }
        cw_uids = {
            r.user_id
            for r in db.query(CurrentlyWatching.user_id).filter(
                CurrentlyWatching.content_id == content_id,
                CurrentlyWatching.content_type == content_type,
            )
        }

        for uid in watchlist_uids | cw_uids:
            user_alerts[uid].append(alert)

    if not user_alerts:
        return

    users = (
        db.query(User)
        .filter(
            User.id.in_(list(user_alerts.keys())),
            User.notify_trailers == True,  # noqa: E712
            User.subscription_tier.in_(["premium", "admin"]),
        )
        .all()
    )

    for user in users:
        alerts = user_alerts[user.id]

        if user.email_notifications and user.email:
            try:
                send_trailer_alert_email(
                    user.email,
                    user.username or "",
                    alerts,
                    uid=user.id,
                )
            except Exception as e:
                print(f"[trailers] Failed to email {user.email}: {e}")

        if user.push_notifications_enabled and user.push_notify_trailers:
            for alert in alerts:
                video = alert["videos"][0] if alert["videos"] else {}
                vname = video.get("name") or "New trailer"
                try:
                    push_notification(
                        db,
                        user.id,
                        type="trailer",
                        title=f"New trailer for {alert['title']}",
                        body=vname,
                        content_type=alert["content_type"],
                        content_id=alert["content_id"],
                        video_key=video.get("key"),
                        image_url=tmdb_poster_url(alert.get("poster_path")),
                    )
                except Exception as e:
                    print(f"[trailers] Failed to push {user.id}: {e}")
