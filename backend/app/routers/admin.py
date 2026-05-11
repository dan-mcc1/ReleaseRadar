from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import func
from firebase_admin import auth

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
from app.models.episode import Episode
from app.models.report import Report
from app.models.review import Review
from app.models.appeal import Appeal
from app.models.block import Block
from app.models.favorite import Favorite
from app.models.shelf import Shelf
from app.models.shelf_item import ShelfItem

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
    new_users_7d = (
        db.query(func.count(User.id)).filter(User.created_at >= week_ago).scalar()
    )
    new_users_30d = (
        db.query(func.count(User.id)).filter(User.created_at >= month_ago).scalar()
    )
    email_notif_enabled = (
        db.query(func.count(User.id))
        .filter(User.email_notifications == True)
        .scalar()  # noqa: E712
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
    activity_7d = (
        db.query(func.count(Activity.id))
        .filter(Activity.created_at >= week_ago)
        .scalar()
    )
    activity_30d = (
        db.query(func.count(Activity.id))
        .filter(Activity.created_at >= month_ago)
        .scalar()
    )

    activity_type_rows = (
        db.query(Activity.activity_type, func.count(Activity.id))
        .group_by(Activity.activity_type)
        .all()
    )
    activity_by_type = {t: c for t, c in activity_type_rows}

    total_friendships = (
        db.query(func.count(Friendship.id))
        .filter(Friendship.status == "accepted")
        .scalar()
    )
    total_followers = (
        db.query(func.count(Friendship.id))
        .filter(Friendship.status == "following")
        .scalar()
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
            {"date": str(row.day), "signups": row.count} for row in daily_signups
        ],
    }


# ── Moderation report queue ────────────────────────────────────────────────────


@router.get("/reports")
def get_reports(
    status: str = "pending",
    skip: int = 0,
    limit: int = 50,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if status not in ("pending", "accepted", "rejected"):
        status = "pending"

    reports = (
        db.query(Report)
        .filter(Report.status == status)
        .order_by(Report.created_at.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    result = []
    for r in reports:
        reporter = db.query(User).filter(User.id == r.reporter_id).first()
        payload = {
            "id": r.id,
            "reporter": reporter.username if reporter else r.reporter_id,
            "reported_type": r.reported_type,
            "reported_id": r.reported_id,
            "reason": r.reason,
            "message": r.message,
            "status": r.status,
            "admin_notes": r.admin_notes,
            "created_at": r.created_at,
            "resolved_at": r.resolved_at,
        }

        if r.reported_type == "review":
            try:
                review = (
                    db.query(Review).filter(Review.id == int(r.reported_id)).first()
                )
            except (ValueError, TypeError):
                review = None
            if review:
                author = db.query(User).filter(User.id == review.user_id).first()
                payload["review"] = {
                    "id": review.id,
                    "author": author.username if author else review.user_id,
                    "author_id": review.user_id,
                    "content_type": review.content_type,
                    "content_id": review.content_id,
                    "text": review.review_text,
                    "created_at": review.created_at,
                }
            else:
                payload["review"] = None

        elif r.reported_type == "user":
            target = db.query(User).filter(User.id == r.reported_id).first()
            if target:
                reviews = (
                    db.query(Review)
                    .filter(Review.user_id == target.id)
                    .order_by(Review.created_at.desc())
                    .limit(20)
                    .all()
                )
                ratings = (
                    db.query(Watched)
                    .filter(Watched.user_id == target.id, Watched.rating.isnot(None))
                    .order_by(Watched.watched_at.desc())
                    .limit(20)
                    .all()
                )
                payload["reported_user"] = {
                    "id": target.id,
                    "username": target.username,
                    "email": target.email,
                    "created_at": target.created_at,
                    "warning_count": target.warning_count or 0,
                    "is_suspended": target.is_suspended,
                    "suspended_until": target.suspended_until,
                    "is_silenced": target.is_silenced,
                    "silenced_until": target.silenced_until,
                    "is_banned": target.is_banned,
                    "reviews": [
                        {
                            "id": rv.id,
                            "content_type": rv.content_type,
                            "content_id": rv.content_id,
                            "text": rv.review_text,
                            "created_at": rv.created_at,
                        }
                        for rv in reviews
                    ],
                    "ratings": [
                        {
                            "content_type": w.content_type,
                            "content_id": w.content_id,
                            "rating": w.rating,
                        }
                        for w in ratings
                    ],
                }
            else:
                payload["reported_user"] = None

        result.append(payload)

    total = db.query(func.count(Report.id)).filter(Report.status == status).scalar()
    return {"reports": result, "total": total}


@router.post("/reports/{report_id}/accept")
def accept_report(
    report_id: int,
    action: str = Body(...),
    admin_notes: str | None = Body(None),
    suspend_days: int | None = Body(None),
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Accept a report and take action.
    For review reports: action must be "delete_review".
    For user reports: action must be "warn", "suspend", or "delete_user".
    """
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    if report.status != "pending":
        raise HTTPException(status_code=409, detail="Report is no longer pending.")

    now = datetime.now(timezone.utc)

    if report.reported_type == "review":
        if action != "delete_review":
            raise HTTPException(
                status_code=400,
                detail="action must be 'delete_review' for review reports.",
            )
        try:
            review = (
                db.query(Review).filter(Review.id == int(report.reported_id)).first()
            )
        except (ValueError, TypeError):
            review = None
        if review:
            db.delete(review)

    elif report.reported_type == "user":
        if action not in ("warn", "suspend", "ban", "delete_user"):
            raise HTTPException(
                status_code=400,
                detail="action must be 'warn', 'suspend', 'ban', or 'delete_user' for user reports.",
            )
        target = db.query(User).filter(User.id == report.reported_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Reported user not found.")

        if action == "suspend":
            days = suspend_days if suspend_days and suspend_days > 0 else 7
            target.is_suspended = True
            target.suspended_until = now + timedelta(days=days)
            target.suspension_reason = (
                admin_notes or "Suspended following a moderation review."
            )

        elif action == "ban":
            target.is_banned = True
            target.ban_reason = admin_notes or "Banned following a moderation review."

        elif action == "delete_user":
            db.delete(target)

        elif action == "warn":
            target.warning_count = (target.warning_count or 0) + 1
            target.has_unread_warning = True

            # Auto-escalate based on warning count
            if target.warning_count == 2:
                target.silenced_until = now + timedelta(days=7)
            elif target.warning_count == 3:
                target.silenced_until = now + timedelta(days=30)
            elif target.warning_count >= 4:
                target.is_silenced = True
                target.silenced_until = None

    report.status = "accepted"
    report.admin_notes = admin_notes
    report.resolved_at = now
    db.commit()
    return {"detail": "Report accepted.", "action": action}


@router.post("/reports/{report_id}/reject")
def reject_report(
    report_id: int,
    admin_notes: str | None = Body(None, embed=True),
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    report = db.query(Report).filter(Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    if report.status != "pending":
        raise HTTPException(status_code=409, detail="Report is no longer pending.")

    report.status = "rejected"
    report.admin_notes = admin_notes
    report.resolved_at = datetime.now(timezone.utc)
    db.commit()
    return {"detail": "Report rejected."}


@router.get("/users")
def list_users(
    search: str = "",
    skip: int = 0,
    limit: int = 50,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if search:
        like = f"%{search}%"
        query = query.filter((User.username.ilike(like)) | (User.email.ilike(like)))
    total = query.count()
    users = query.order_by(User.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "subscription_tier": u.subscription_tier,
                "warning_count": u.warning_count or 0,
                "is_suspended": u.is_suspended,
                "suspended_until": u.suspended_until,
                "is_silenced": u.is_silenced,
                "silenced_until": u.silenced_until,
                "is_banned": u.is_banned,
                "ban_reason": u.ban_reason,
                "created_at": u.created_at,
            }
            for u in users
        ],
        "total": total,
    }


@router.post("/users/{target_user_id}/unsuspend")
def unsuspend_user(
    target_user_id: str,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    target.is_suspended = False
    target.suspended_until = None
    target.suspension_reason = None
    db.commit()
    return {"detail": "User unsuspended."}


@router.post("/users/{target_user_id}/suspend")
def suspend_user(
    target_user_id: str,
    days: int = Body(..., embed=True),
    reason: str | None = Body(None, embed=True),
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if days < 1:
        raise HTTPException(status_code=400, detail="days must be at least 1.")
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    target.is_suspended = True
    target.suspended_until = datetime.now(timezone.utc) + timedelta(days=days)
    target.suspension_reason = reason or "Suspended by admin."
    db.commit()
    return {"detail": f"User suspended for {days} day(s)."}


@router.post("/users/{target_user_id}/tier")
def set_user_tier(
    target_user_id: str,
    tier: str = Body(..., embed=True),
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if tier not in ("free", "premium", "admin"):
        raise HTTPException(
            status_code=400, detail="tier must be 'free', 'premium', or 'admin'."
        )
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    target.subscription_tier = tier
    db.commit()
    return {"detail": f"User tier set to {tier}."}


@router.post("/users/{target_user_id}/ban")
def ban_user(
    target_user_id: str,
    reason: str | None = Body(None, embed=True),
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if target_user_id == user_id:
        raise HTTPException(status_code=400, detail="You cannot ban your own account.")
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    target.is_banned = True
    target.ban_reason = reason or "Banned by admin."
    db.commit()
    return {"detail": "User banned."}


@router.post("/users/{target_user_id}/unban")
def unban_user(
    target_user_id: str,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    target.is_banned = False
    target.ban_reason = None
    db.commit()
    return {"detail": "User unbanned."}


@router.post("/users/{target_user_id}/unsilence")
def unsilence_user(
    target_user_id: str,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    target.is_silenced = False
    target.silenced_until = None
    db.commit()
    return {"detail": "User unsilenced."}


@router.get("/appeals")
def list_appeals(
    status: str = "pending",
    skip: int = 0,
    limit: int = 50,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if status not in ("pending", "approved", "rejected"):
        status = "pending"
    appeals = (
        db.query(Appeal)
        .filter(Appeal.status == status)
        .order_by(Appeal.created_at.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    result = []
    for a in appeals:
        appellant = db.query(User).filter(User.id == a.user_id).first()
        now = datetime.now(timezone.utc)
        is_silenced = appellant and (
            appellant.is_silenced
            or (appellant.silenced_until is not None and now < appellant.silenced_until)
        )
        result.append(
            {
                "id": a.id,
                "user_id": a.user_id,
                "username": appellant.username if appellant else a.user_id,
                "email": appellant.email if appellant else None,
                "appeal_type": a.appeal_type,
                "message": a.message,
                "request_unsilence": a.request_unsilence,
                "status": a.status,
                "admin_notes": a.admin_notes,
                "created_at": a.created_at,
                "resolved_at": a.resolved_at,
                "is_still_restricted": (
                    (appellant.is_banned or appellant.is_suspended)
                    if appellant
                    else False
                ),
                "is_silenced": bool(is_silenced),
            }
        )
    total = db.query(func.count(Appeal.id)).filter(Appeal.status == status).scalar()
    return {"appeals": result, "total": total}


@router.post("/appeals/{appeal_id}/approve")
def approve_appeal(
    appeal_id: int,
    admin_notes: str | None = Body(None),
    lift_silence: bool = Body(False),
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    appeal = db.query(Appeal).filter(Appeal.id == appeal_id).first()
    if not appeal:
        raise HTTPException(status_code=404, detail="Appeal not found.")
    if appeal.status != "pending":
        raise HTTPException(status_code=409, detail="Appeal is no longer pending.")

    now = datetime.now(timezone.utc)
    target = db.query(User).filter(User.id == appeal.user_id).first()
    if target:
        if appeal.appeal_type == "ban":
            target.is_banned = False
            target.ban_reason = None
        else:
            target.is_suspended = False
            target.suspended_until = None
            target.suspension_reason = None
        if lift_silence:
            target.is_silenced = False
            target.silenced_until = None

    appeal.status = "approved"
    appeal.admin_notes = admin_notes
    appeal.resolved_at = now
    db.commit()
    return {"detail": "Appeal approved."}


@router.post("/appeals/{appeal_id}/reject")
def reject_appeal(
    appeal_id: int,
    admin_notes: str | None = Body(None, embed=True),
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    appeal = db.query(Appeal).filter(Appeal.id == appeal_id).first()
    if not appeal:
        raise HTTPException(status_code=404, detail="Appeal not found.")
    if appeal.status != "pending":
        raise HTTPException(status_code=409, detail="Appeal is no longer pending.")

    appeal.status = "rejected"
    appeal.admin_notes = admin_notes
    appeal.resolved_at = datetime.now(timezone.utc)
    db.commit()
    return {"detail": "Appeal rejected."}


@router.delete("/users/{target_user_id}")
def admin_delete_user(
    target_user_id: str,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if target_user_id == user_id:
        raise HTTPException(
            status_code=400, detail="You cannot delete your own account."
        )
    target = db.query(User).filter(User.id == target_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    uid = target_user_id

    # Collect all content being tracked so we can decrement tracking_count.
    # Watchlist and Watched are mutually exclusive per item, so we can union them.
    tracked: set[tuple[str, int]] = set()

    for row in (
        db.query(Watchlist.content_type, Watchlist.content_id)
        .filter_by(user_id=uid)
        .all()
    ):
        tracked.add((row.content_type, row.content_id))
    for row in (
        db.query(Watched.content_type, Watched.content_id).filter_by(user_id=uid).all()
    ):
        tracked.add((row.content_type, row.content_id))

    # Decrement tracking counts
    for content_type, content_id in tracked:
        if content_type == "movie":
            movie = db.query(Movie).filter_by(id=content_id).first()
            if movie:
                movie.tracking_count = max(0, (movie.tracking_count or 1) - 1)
        elif content_type == "tv":
            show = db.query(Show).filter_by(id=content_id).first()
            if show:
                show.tracking_count = max(0, (show.tracking_count or 1) - 1)

    db.flush()

    db.query(ShelfItem).filter(ShelfItem.user_id == uid).delete()
    db.query(Shelf).filter(Shelf.user_id == uid).delete()
    db.query(Review).filter(Review.user_id == uid).delete()
    db.query(Favorite).filter(Favorite.user_id == uid).delete()
    db.query(Activity).filter(Activity.user_id == uid).delete()
    db.query(EpisodeWatched).filter(EpisodeWatched.user_id == uid).delete()
    db.query(CurrentlyWatching).filter(CurrentlyWatching.user_id == uid).delete()
    db.query(Watched).filter(Watched.user_id == uid).delete()
    db.query(Watchlist).filter(Watchlist.user_id == uid).delete()
    db.query(Block).filter(
        (Block.blocker_id == uid) | (Block.blocked_id == uid)
    ).delete(synchronize_session=False)
    db.query(Report).filter(Report.reporter_id == uid).update(
        {Report.reporter_id: None}, synchronize_session=False
    )

    # Remove shows/movies no longer tracked by anyone
    for content_type, content_id in tracked:
        if content_type == "movie":
            movie = db.query(Movie).filter_by(id=content_id).first()
            if movie and movie.tracking_count <= 0:
                db.delete(movie)
        elif content_type == "tv":
            show = db.query(Show).filter_by(id=content_id).first()
            if show and show.tracking_count <= 0:
                db.query(EpisodeWatched).filter_by(show_id=content_id).delete()
                db.query(Episode).filter_by(show_id=content_id).delete()
                db.delete(show)

    db.delete(target)
    db.commit()

    try:
        auth.delete_user(uid)
    except auth.UserNotFoundError:
        pass

    return {"detail": "User deleted."}
