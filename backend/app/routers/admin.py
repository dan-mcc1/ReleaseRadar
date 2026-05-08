from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.session import get_db
from app.dependencies.subscription import require_admin
from app.models.user import User
from app.models.watchlist import Watchlist
from app.models.watched import Watched
from app.models.episode_watched import EpisodeWatched
from app.models.currently_watching import CurrentlyWatching
from app.models.activity import Activity
from app.models.friendship import Friendship
from app.models.show import Show
from app.models.movie import Movie

router = APIRouter()


@router.get("/stats")
def get_admin_stats(
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    now = datetime.now(ZoneInfo("UTC"))
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    two_weeks_ago = now - timedelta(days=14)

    total_users = db.query(func.count(User.id)).scalar()
    new_users_7d = db.query(func.count(User.id)).filter(User.created_at >= week_ago).scalar()
    new_users_30d = db.query(func.count(User.id)).filter(User.created_at >= month_ago).scalar()
    email_notif_enabled = (
        db.query(func.count(User.id)).filter(User.email_notifications == True).scalar()  # noqa: E712
    )

    tier_rows = (
        db.query(User.subscription_tier, func.count(User.id))
        .group_by(User.subscription_tier)
        .all()
    )
    tier_breakdown = {tier: count for tier, count in tier_rows}

    total_watchlist = db.query(func.count(Watchlist.id)).scalar()
    total_watched = db.query(func.count(Watched.id)).scalar()
    total_episodes_watched = db.query(func.count(EpisodeWatched.id)).scalar()
    total_currently_watching = db.query(func.count(CurrentlyWatching.id)).scalar()

    total_activity = db.query(func.count(Activity.id)).scalar()
    activity_7d = db.query(func.count(Activity.id)).filter(Activity.created_at >= week_ago).scalar()
    activity_30d = db.query(func.count(Activity.id)).filter(Activity.created_at >= month_ago).scalar()

    activity_type_rows = (
        db.query(Activity.activity_type, func.count(Activity.id))
        .group_by(Activity.activity_type)
        .all()
    )
    activity_by_type = {t: c for t, c in activity_type_rows}

    total_friendships = (
        db.query(func.count(Friendship.id)).filter(Friendship.status == "accepted").scalar()
    )
    total_followers = (
        db.query(func.count(Friendship.id)).filter(Friendship.status == "following").scalar()
    )

    top_shows = (
        db.query(Show.id, Show.name, Show.tracking_count)
        .filter(Show.tracking_count > 0)
        .order_by(Show.tracking_count.desc())
        .limit(10)
        .all()
    )
    top_movies = (
        db.query(Movie.id, Movie.title, Movie.tracking_count)
        .filter(Movie.tracking_count > 0)
        .order_by(Movie.tracking_count.desc())
        .limit(10)
        .all()
    )

    daily_signups = (
        db.query(
            func.date(User.created_at).label("day"),
            func.count(User.id).label("count"),
        )
        .filter(User.created_at >= two_weeks_ago)
        .group_by(func.date(User.created_at))
        .order_by(func.date(User.created_at))
        .all()
    )

    return {
        "users": {
            "total": total_users,
            "new_7d": new_users_7d,
            "new_30d": new_users_30d,
            "email_notifications_enabled": email_notif_enabled,
            "tier_breakdown": tier_breakdown,
        },
        "tracking": {
            "total_watchlist": total_watchlist,
            "total_watched": total_watched,
            "total_episodes_watched": total_episodes_watched,
            "total_currently_watching": total_currently_watching,
        },
        "activity": {
            "total": total_activity,
            "last_7d": activity_7d,
            "last_30d": activity_30d,
            "by_type": activity_by_type,
        },
        "social": {
            "total_friendships": total_friendships,
            "total_followers": total_followers,
        },
        "top_shows": [
            {"id": s.id, "name": s.name, "tracking_count": s.tracking_count}
            for s in top_shows
        ],
        "top_movies": [
            {"id": m.id, "title": m.title, "tracking_count": m.tracking_count}
            for m in top_movies
        ],
        "growth": [
            {"date": str(row.day), "signups": row.count}
            for row in daily_signups
        ],
    }
