import csv
import io
import json
import zipfile
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRouter

from app.core.limiter import limiter
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.collection import Collection
from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.favorite import Favorite
from app.models.finish_by_goal import FinishByGoal
from app.models.friendship import Friendship
from app.models.movie import Movie
from app.models.provider import Provider
from app.models.rewatch import Rewatch
from app.models.review import Review
from app.models.season_rating import SeasonRating
from app.models.shelf import Shelf
from app.models.shelf_item import ShelfItem
from app.models.show import Show
from app.models.user import User
from app.models.user_collection_ranking import UserCollectionRanking
from app.models.user_streaming_service import UserStreamingService
from app.models.watched import Watched
from app.models.watchlist import Watchlist

router = APIRouter()

_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

_README = """ReleaseRadar data export. All dates and times are UTC.

watched.csv: movies and shows you marked watched, with rating and date.
watchlist.csv: your watchlist, with whether alerts are on for each title.
currently_watching.csv: titles you are currently watching.
episodes_watched.csv: every episode you marked watched, with rating and full timestamp.
favorites.csv: your favorite movies and shows.
reviews.csv: your reviews, with a spoiler flag.
rewatches.csv: your rewatches, with rating and notes.
shelves.csv: the titles on each of your shelves.
season_ratings.csv: your season ratings.
goals.csv: your finish-by goals.
friends.csv: usernames of your accepted friends and when you became friends.
collection_rankings.csv: your rankings of movies within collections.
profile.json: your profile, streaming services and notification settings.

Not included: group posts and replies, and the notification inbox.
"""


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


def _safe_cell(value):
    """Stop spreadsheets running a text cell as a formula (CSV injection)."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def _csv_bytes(rows: list[dict], fieldnames: list[str]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    writer.writerows({k: _safe_cell(v) for k, v in row.items()} for row in rows)
    return buf.getvalue().encode()


@router.get("/zip")
@limiter.limit("6/minute")  # reads the user's whole history; no reason to hammer it
def export_zip(
    request: Request,
    db=Depends(get_db),
    uid: str = Depends(get_current_user),
):
    user = db.query(User).filter_by(id=uid).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    # Fetch all user data in one pass
    watched_items = db.query(Watched).filter_by(user_id=uid).all()
    watchlist_items = db.query(Watchlist).filter_by(user_id=uid).all()
    review_items = db.query(Review).filter_by(user_id=uid).all()
    rewatch_items = db.query(Rewatch).filter_by(user_id=uid).all()
    shelves = db.query(Shelf).filter_by(user_id=uid).all()
    shelf_items = db.query(ShelfItem).filter_by(user_id=uid).all()
    currently_watching_items = db.query(CurrentlyWatching).filter_by(user_id=uid).all()
    favorite_items = db.query(Favorite).filter_by(user_id=uid).all()

    # Build title lookups with two bulk queries per source table
    all_content = (
        watched_items + watchlist_items + review_items + rewatch_items + shelf_items
        + currently_watching_items + favorite_items
    )
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
            "notify": w.notify,
        }
        for w in watchlist_items
    ]

    # ── reviews (the model has no rating column) ──────────────────────────────
    review_rows = [
        {
            "type": r.content_type,
            "title": t(r.content_type, r.content_id),
            "tmdb_id": r.content_id,
            "review": r.review_text,
            "created_at": r.created_at.date() if r.created_at else "",
            "is_spoiler": r.is_spoiler,
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

    # ── currently watching + favorites ────────────────────────────────────────
    currently_watching_rows = [
        {
            "type": c.content_type,
            "title": t(c.content_type, c.content_id),
            "tmdb_id": c.content_id,
            "added_at": c.added_at.date() if c.added_at else "",
        }
        for c in currently_watching_items
    ]
    favorite_rows = [
        {
            "type": f.content_type,
            "title": t(f.content_type, f.content_id),
            "tmdb_id": f.content_id,
            "added_at": f.added_at.date() if f.added_at else "",
        }
        for f in favorite_items
    ]

    # ── episodes watched (one joined query, columns only) ─────────────────────
    episode_rows = [
        {
            "show_title": show_name or str(show_id),
            "show_tmdb_id": show_id,
            "season": season,
            "episode": number,
            "episode_title": ep_name or "",
            "rating": rating if rating is not None else "",
            "watched_at": watched_at.isoformat() if watched_at else "",
        }
        for show_id, show_name, season, number, ep_name, rating, watched_at in (
            db.query(
                EpisodeWatched.show_id,
                Show.name,
                EpisodeWatched.season_number,
                EpisodeWatched.episode_number,
                Episode.name,
                EpisodeWatched.rating,
                EpisodeWatched.watched_at,
            )
            # Outer joins: a history row is exported even if its show is no
            # longer cached.
            .outerjoin(Show, Show.id == EpisodeWatched.show_id)
            .outerjoin(
                Episode,
                (Episode.show_id == EpisodeWatched.show_id)
                & (Episode.season_number == EpisodeWatched.season_number)
                & (Episode.episode_number == EpisodeWatched.episode_number),
            )
            .filter(EpisodeWatched.user_id == uid)
            .order_by(
                EpisodeWatched.show_id,
                EpisodeWatched.season_number,
                EpisodeWatched.episode_number,
            )
            .all()
        )
    ]

    # ── season ratings ────────────────────────────────────────────────────────
    season_rating_rows = [
        {
            "show_title": show_name or str(show_id),
            "show_tmdb_id": show_id,
            "season": season,
            "rating": rating,
            "rated_at": rated_at.date() if rated_at else "",
        }
        for show_id, show_name, season, rating, rated_at in (
            db.query(
                SeasonRating.show_id,
                Show.name,
                SeasonRating.season_number,
                SeasonRating.rating,
                SeasonRating.rated_at,
            )
            .outerjoin(Show, Show.id == SeasonRating.show_id)
            .filter(SeasonRating.user_id == uid)
            .order_by(SeasonRating.show_id, SeasonRating.season_number)
            .all()
        )
    ]

    # ── finish-by goals (the model has no created date) ───────────────────────
    goal_rows = [
        {
            "show_title": show_name or str(show_id),
            "show_tmdb_id": show_id,
            "target_date": target_date or "",
        }
        for show_id, show_name, target_date in (
            db.query(FinishByGoal.show_id, Show.name, FinishByGoal.target_date)
            .outerjoin(Show, Show.id == FinishByGoal.show_id)
            .filter(FinishByGoal.user_id == uid)
            .order_by(FinishByGoal.show_id)
            .all()
        )
    ]

    # ── friends: accepted only, the other person's username only ──────────────
    friendships = (
        db.query(Friendship.requester_id, Friendship.addressee_id, Friendship.updated_at)
        .filter(
            Friendship.status == "accepted",
            (Friendship.requester_id == uid) | (Friendship.addressee_id == uid),
        )
        .all()
    )
    other_ids = {a if r == uid else r for r, a, _ in friendships}
    usernames = {}
    if other_ids:
        usernames = dict(
            db.query(User.id, User.username).filter(User.id.in_(other_ids)).all()
        )
    friend_rows = sorted(
        (
            {
                "username": usernames.get(a if r == uid else r) or "",
                "accepted_at": accepted.date() if accepted else "",
            }
            for r, a, accepted in friendships
        ),
        key=lambda row: row["username"],
    )

    # ── collection rankings ───────────────────────────────────────────────────
    ranking_query = (
        db.query(
            UserCollectionRanking.collection_id,
            Collection.name,
            UserCollectionRanking.movie_id,
            UserCollectionRanking.rank,
            UserCollectionRanking.updated_at,
        )
        .outerjoin(Collection, Collection.id == UserCollectionRanking.collection_id)
        .filter(UserCollectionRanking.user_id == uid)
        .order_by(UserCollectionRanking.collection_id, UserCollectionRanking.rank)
        .all()
    )
    ranking_movie_ids = {row[2] for row in ranking_query}
    ranking_titles = {}
    if ranking_movie_ids:
        ranking_titles = dict(
            db.query(Movie.id, Movie.title).filter(Movie.id.in_(ranking_movie_ids)).all()
        )
    ranking_rows = [
        {
            "collection": name or str(collection_id),
            "collection_tmdb_id": collection_id,
            "movie_title": ranking_titles.get(movie_id, str(movie_id)),
            "movie_tmdb_id": movie_id,
            "rank": rank,
            "updated_at": updated_at.date() if updated_at else "",
        }
        for collection_id, name, movie_id, rank, updated_at in ranking_query
    ]

    # ── profile JSON ──────────────────────────────────────────────────────────
    service_rows = (
        db.query(Provider.name, UserStreamingService.paused_at)
        .join(UserStreamingService, UserStreamingService.provider_id == Provider.id)
        .filter(UserStreamingService.user_id == uid)
        .order_by(Provider.name)
        .all()
    )
    streaming_services = [name for name, _ in service_rows]
    paused_streaming_services = [
        {"name": name, "paused_at": paused_at.isoformat()}
        for name, paused_at in service_rows
        if paused_at is not None
    ]
    profile = {
        "username": user.username,
        "display_name": user.display_name,
        "email": user.email,
        "bio": user.bio,
        "avatar_key": user.avatar_key,
        "profile_visibility": user.profile_visibility,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "subscription_tier": user.subscription_tier,
        "email_notifications": user.email_notifications,
        "notification_frequency": user.notification_frequency,
        "notify_new_seasons": user.notify_new_seasons,
        "notify_streaming_changes": user.notify_streaming_changes,
        "notify_trailers": user.notify_trailers,
        "push_notifications_enabled": user.push_notifications_enabled,
        "push_notify_new_seasons": user.push_notify_new_seasons,
        "push_notify_streaming_changes": user.push_notify_streaming_changes,
        "push_notify_trailers": user.push_notify_trailers,
        "push_notify_episode_air": user.push_notify_episode_air,
        "episode_alert_lead_minutes": user.episode_alert_lead_minutes,
        "hide_spoilers": user.hide_spoilers,
        "digest_hour": user.digest_hour,
        "digest_timezone": user.digest_timezone,
        "streaming_services": streaming_services,
        "paused_streaming_services": paused_streaming_services,
        "exported_at": datetime.now(timezone.utc).isoformat(),
    }

    # ── build zip ─────────────────────────────────────────────────────────────
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("watched.csv", _csv_bytes(watched_rows, ["type", "title", "tmdb_id", "rating", "watched_at"]))
        zf.writestr("watchlist.csv", _csv_bytes(watchlist_rows, ["type", "title", "tmdb_id", "added_at", "notify"]))
        zf.writestr("reviews.csv", _csv_bytes(review_rows, ["type", "title", "tmdb_id", "review", "created_at", "is_spoiler"]))
        zf.writestr("rewatches.csv", _csv_bytes(rewatch_rows, ["type", "title", "tmdb_id", "rating", "notes", "watched_at"]))
        zf.writestr("shelves.csv", _csv_bytes(shelf_rows, ["shelf", "type", "title", "tmdb_id", "added_at"]))
        zf.writestr("currently_watching.csv", _csv_bytes(currently_watching_rows, ["type", "title", "tmdb_id", "added_at"]))
        zf.writestr("episodes_watched.csv", _csv_bytes(episode_rows, ["show_title", "show_tmdb_id", "season", "episode", "episode_title", "rating", "watched_at"]))
        zf.writestr("favorites.csv", _csv_bytes(favorite_rows, ["type", "title", "tmdb_id", "added_at"]))
        zf.writestr("season_ratings.csv", _csv_bytes(season_rating_rows, ["show_title", "show_tmdb_id", "season", "rating", "rated_at"]))
        zf.writestr("goals.csv", _csv_bytes(goal_rows, ["show_title", "show_tmdb_id", "target_date"]))
        zf.writestr("friends.csv", _csv_bytes(friend_rows, ["username", "accepted_at"]))
        zf.writestr("collection_rankings.csv", _csv_bytes(ranking_rows, ["collection", "collection_tmdb_id", "movie_title", "movie_tmdb_id", "rank", "updated_at"]))
        zf.writestr("profile.json", json.dumps(profile, indent=2, default=str))
        zf.writestr("README.txt", _README)

    zip_buf.seek(0)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"releaseradar-{user.username or uid}-{stamp}.zip"

    return StreamingResponse(
        zip_buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
