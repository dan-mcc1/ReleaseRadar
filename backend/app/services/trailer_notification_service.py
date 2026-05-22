from collections import defaultdict

from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.movie import Movie
from app.models.movie_video import MovieVideo
from app.models.show import Show
from app.models.show_video import ShowVideo
from app.models.user import User
from app.models.watchlist import Watchlist
from app.services.email_service import send_trailer_alert_email
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
            User.email_notifications == True,  # noqa: E712
            User.notify_trailers == True,  # noqa: E712
            User.email != None,  # noqa: E711
            User.subscription_tier.in_(["premium", "admin"]),
        )
        .all()
    )

    for user in users:
        try:
            send_trailer_alert_email(
                user.email,
                user.username or "",
                user_alerts[user.id],
                uid=user.id,
            )
        except Exception as e:
            print(f"[trailers] Failed to notify {user.email}: {e}")
