from collections import defaultdict

from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.movie import Movie
from app.models.provider import MovieProvider, Provider, ShowProvider
from app.models.show import Show
from app.models.user import User
from app.models.watchlist import Watchlist
from app.services.email_service import send_streaming_alert_email
from app.services.tmdb_movies import fetch_movie_from_tmdb
from app.services.tmdb_tv import fetch_show_from_tmdb


def _fetch_fresh_us_providers(content_id: int, content_type: str) -> dict:
    if content_type == "movie":
        data = fetch_movie_from_tmdb(content_id, "watch/providers")
    else:
        data = fetch_show_from_tmdb(content_id, "watch/providers")
    if not data:
        return {}
    return data.get("watch/providers", {}).get("results", {}).get("US", {})


def _diff_and_update_providers(
    db: Session, content_id: int, content_type: str, fresh_us: dict
) -> tuple[list[str], list[str]]:
    """
    Diffs fresh TMDb flatrate providers against stored ones, updates the DB,
    and returns (added_names, removed_names) for flatrate-only changes.
    """
    link_model = ShowProvider if content_type == "tv" else MovieProvider
    id_kwarg = {"show_id": content_id} if content_type == "tv" else {"movie_id": content_id}

    fresh_map: dict[int, dict] = {}
    for ptype in ("flatrate", "rent", "buy"):
        for p in fresh_us.get(ptype, []):
            pid = p["provider_id"]
            if pid not in fresh_map:
                fresh_map[pid] = {
                    "name": p["provider_name"],
                    "logo_path": p.get("logo_path"),
                    "flatrate": False,
                    "rent": False,
                    "buy": False,
                }
            fresh_map[pid][ptype] = True

    stored_rows = {
        row.provider_id: row
        for row in db.query(link_model).filter_by(**id_kwarg).all()
    }

    old_flatrate = {pid for pid, row in stored_rows.items() if row.flatrate}
    new_flatrate = {pid for pid, data in fresh_map.items() if data["flatrate"]}
    added_ids = new_flatrate - old_flatrate
    removed_ids = old_flatrate - new_flatrate

    # Build a name lookup — fresh data takes priority, fall back to DB for removed providers
    provider_names: dict[int, str] = {pid: d["name"] for pid, d in fresh_map.items()}
    if removed_ids:
        for p in db.query(Provider).filter(Provider.id.in_(list(removed_ids))).all():
            provider_names.setdefault(p.id, p.name)

    # Upsert Provider master rows
    if fresh_map:
        existing_ids = {
            p.id
            for p in db.query(Provider).filter(Provider.id.in_(list(fresh_map.keys()))).all()
        }
        for pid, data in fresh_map.items():
            if pid not in existing_ids:
                db.add(Provider(id=pid, name=data["name"], logo_path=data["logo_path"]))

    # Upsert junction rows
    for pid, data in fresh_map.items():
        row = stored_rows.get(pid)
        if row is None:
            db.add(
                link_model(
                    provider_id=pid,
                    flatrate=data["flatrate"],
                    rent=data["rent"],
                    buy=data["buy"],
                    **id_kwarg,
                )
            )
        else:
            row.flatrate = data["flatrate"]
            row.rent = data["rent"]
            row.buy = data["buy"]

    # Delete stale junction rows
    for pid in set(stored_rows.keys()) - set(fresh_map.keys()):
        db.delete(stored_rows[pid])

    added_names = [provider_names.get(pid, str(pid)) for pid in added_ids]
    removed_names = [provider_names.get(pid, str(pid)) for pid in removed_ids]
    return added_names, removed_names


def refresh_streaming_providers(db: Session) -> None:
    """
    Nightly task: refresh TMDb watch providers for all tracked content,
    detect flatrate additions/removals, and email affected opted-in users.
    """
    tracked: set[tuple[int, str]] = set()
    for row in db.query(Watchlist.content_id, Watchlist.content_type).distinct():
        tracked.add((row.content_id, row.content_type))
    for row in db.query(CurrentlyWatching.content_id, CurrentlyWatching.content_type).distinct():
        tracked.add((row.content_id, row.content_type))

    if not tracked:
        return

    changes: dict[tuple[int, str], dict] = {}
    for content_id, content_type in tracked:
        try:
            fresh = _fetch_fresh_us_providers(content_id, content_type)
            added, removed = _diff_and_update_providers(db, content_id, content_type, fresh)
            if added or removed:
                changes[(content_id, content_type)] = {"added": added, "removed": removed}
        except Exception as e:
            print(f"[streaming] Error refreshing {content_type} {content_id}: {e}")

    db.commit()

    if not changes:
        return

    # Bulk-load title/poster info
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

    # Map user_id -> list of alert dicts
    user_alerts: dict[str, list] = defaultdict(list)

    for (content_id, content_type), change in changes.items():
        info = (movie_info if content_type == "movie" else show_info).get(content_id, {})
        alert = {
            "title": info.get("title", "Unknown"),
            "content_type": content_type,
            "content_id": content_id,
            "poster_path": info.get("poster_path"),
            "added": change["added"],
            "removed": change["removed"],
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
            User.notify_streaming_changes == True,  # noqa: E712
            User.email != None,  # noqa: E711
        )
        .all()
    )

    for user in users:
        try:
            send_streaming_alert_email(
                user.email,
                user.username or "",
                user_alerts[user.id],
                uid=user.id,
            )
        except Exception as e:
            print(f"[streaming] Failed to notify {user.email}: {e}")
