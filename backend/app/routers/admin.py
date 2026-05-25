from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, case
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
from app.models.banned_email import BannedEmail
from app.models.favorite import Favorite
from app.models.shelf import Shelf
from app.models.shelf_item import ShelfItem

router = APIRouter()


def _add_banned_email(db: Session, user: User):
    if user.email and not db.query(BannedEmail).filter(BannedEmail.email == user.email).first():
        db.add(BannedEmail(email=user.email, user_id=user.id))


def _remove_banned_email_by_user_id(db: Session, user_id: str):
    db.query(BannedEmail).filter(BannedEmail.user_id == user_id).delete()


def _disable_firebase_account(uid: str):
    try:
        auth.update_user(uid, disabled=True)
    except auth.UserNotFoundError:
        pass


def _enable_firebase_account(uid: str):
    try:
        auth.update_user(uid, disabled=False)
    except auth.UserNotFoundError:
        pass


@router.get("/stats")
def get_admin_stats(
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    now = datetime.now(ZoneInfo("UTC"))
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    two_weeks_ago = now - timedelta(days=14)

    # User aggregates — four counts collapsed into one scan. case+sum is the
    # portable spelling of COUNT(*) FILTER (WHERE ...).
    user_row = db.query(
        func.count(User.id).label("total"),
        func.sum(case((User.created_at >= week_ago, 1), else_=0)).label("new_7d"),
        func.sum(case((User.created_at >= month_ago, 1), else_=0)).label("new_30d"),
        func.sum(case((User.email_notifications == True, 1), else_=0)).label(  # noqa: E712
            "email_notif_enabled"
        ),
    ).one()
    total_users = int(user_row.total or 0)
    new_users_7d = int(user_row.new_7d or 0)
    new_users_30d = int(user_row.new_30d or 0)
    email_notif_enabled = int(user_row.email_notif_enabled or 0)

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

    # Activity aggregates — three counts in one scan.
    activity_row = db.query(
        func.count(Activity.id).label("total"),
        func.sum(case((Activity.created_at >= week_ago, 1), else_=0)).label("last_7d"),
        func.sum(case((Activity.created_at >= month_ago, 1), else_=0)).label("last_30d"),
    ).one()
    total_activity = int(activity_row.total or 0)
    activity_7d = int(activity_row.last_7d or 0)
    activity_30d = int(activity_row.last_30d or 0)

    activity_type_rows = (
        db.query(Activity.activity_type, func.count(Activity.id))
        .group_by(Activity.activity_type)
        .all()
    )
    activity_by_type = {t: c for t, c in activity_type_rows}

    # Friendship aggregates — two filtered counts in one scan.
    friendship_row = db.query(
        func.sum(case((Friendship.status == "accepted", 1), else_=0)).label("accepted"),
        func.sum(case((Friendship.status == "following", 1), else_=0)).label("following"),
    ).one()
    total_friendships = int(friendship_row.accepted or 0)
    total_followers = int(friendship_row.following or 0)

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
        .order_by(Report.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    # ── Batch up all user/review lookups so we don't hit N+1 ──────────────
    reporter_ids: set[str] = {r.reporter_id for r in reports if r.reporter_id}
    review_report_ids: list[int] = []
    user_report_ids: set[str] = set()
    for r in reports:
        if r.reported_type == "review":
            try:
                review_report_ids.append(int(r.reported_id))
            except (ValueError, TypeError):
                pass
        elif r.reported_type == "user" and r.reported_id:
            user_report_ids.add(r.reported_id)

    reviews_by_id: dict[int, Review] = {}
    if review_report_ids:
        reviews_by_id = {
            rv.id: rv
            for rv in db.query(Review).filter(Review.id.in_(review_report_ids)).all()
        }

    # All users we need: reporters, review authors, and reported users
    all_user_ids = (
        reporter_ids
        | user_report_ids
        | {rv.user_id for rv in reviews_by_id.values()}
    )
    users_by_id: dict[str, User] = {}
    if all_user_ids:
        users_by_id = {
            u.id: u for u in db.query(User).filter(User.id.in_(all_user_ids)).all()
        }

    # Per-target review/rating samples (kept per-user because each needs its
    # own LIMIT 20 ORDER BY; deduped across reports about the same user).
    target_reviews_by_uid: dict[str, list[Review]] = {}
    target_ratings_by_uid: dict[str, list[Watched]] = {}
    for tid in user_report_ids:
        if tid in users_by_id:
            target_reviews_by_uid[tid] = (
                db.query(Review)
                .filter(Review.user_id == tid)
                .order_by(Review.created_at.desc())
                .limit(20)
                .all()
            )
            target_ratings_by_uid[tid] = (
                db.query(Watched)
                .filter(Watched.user_id == tid, Watched.rating.isnot(None))
                .order_by(Watched.watched_at.desc())
                .limit(20)
                .all()
            )

    result = []
    for r in reports:
        reporter = users_by_id.get(r.reporter_id) if r.reporter_id else None
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
            review = None
            try:
                review = reviews_by_id.get(int(r.reported_id))
            except (ValueError, TypeError):
                pass
            if review:
                author = users_by_id.get(review.user_id)
                payload["review"] = {
                    "id": review.id,
                    "author": author.username if author else review.user_id,
                    "author_id": review.user_id,
                    "content_type": review.content_type,
                    "content_id": review.content_id,
                    "text": review.review_text,
                    "created_at": review.created_at,
                    "deleted": False,
                }
            elif r.snapshot_review_text is not None:
                payload["review"] = {
                    "id": int(r.reported_id),
                    "author": r.snapshot_author_username or r.snapshot_author_id or "unknown",
                    "author_id": r.snapshot_author_id or "",
                    "content_type": r.snapshot_content_type or "",
                    "content_id": r.snapshot_content_id or 0,
                    "text": r.snapshot_review_text,
                    "created_at": r.snapshot_review_created_at,
                    "deleted": True,
                }
            else:
                payload["review"] = None

        elif r.reported_type == "user":
            target = users_by_id.get(r.reported_id)
            if target:
                reviews = target_reviews_by_uid.get(target.id, [])
                ratings = target_ratings_by_uid.get(target.id, [])
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
                    "deleted": False,
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
            elif r.snapshot_user_username is not None:
                payload["reported_user"] = {
                    "id": r.reported_id,
                    "username": r.snapshot_user_username,
                    "email": r.snapshot_user_email or "",
                    "created_at": r.snapshot_user_created_at,
                    "warning_count": 0,
                    "is_suspended": False,
                    "suspended_until": None,
                    "is_silenced": False,
                    "silenced_until": None,
                    "is_banned": False,
                    "deleted": True,
                    "reviews": [],
                    "ratings": [],
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
            _add_banned_email(db, target)

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
    _add_banned_email(db, target)
    db.commit()
    return {"detail": "User banned."}


@router.get("/banned-emails")
def list_banned_emails(
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.query(BannedEmail).order_by(BannedEmail.banned_at.desc()).all()
    return [
        {"id": r.id, "email": r.email, "user_id": r.user_id, "banned_at": r.banned_at}
        for r in rows
    ]


@router.delete("/banned-emails/{entry_id}")
def remove_banned_email(
    entry_id: int,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    entry = db.query(BannedEmail).filter(BannedEmail.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found.")
    db.delete(entry)
    db.commit()
    return {"detail": "Email removed from ban list."}


@router.post("/users/{target_user_id}/unban")
def unban_user(
    target_user_id: str,
    user_id: str = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.id == target_user_id).first()
    _remove_banned_email_by_user_id(db, target_user_id)
    if target:
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
        .order_by(Appeal.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

    appellant_ids = {a.user_id for a in appeals if a.user_id}
    appellants_by_id: dict[str, User] = {}
    if appellant_ids:
        appellants_by_id = {
            u.id: u for u in db.query(User).filter(User.id.in_(appellant_ids)).all()
        }

    result = []
    now = datetime.now(timezone.utc)
    for a in appeals:
        appellant = appellants_by_id.get(a.user_id)
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
            _remove_banned_email_by_user_id(db, target.id)
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

    # Decrement tracking counts — batch load instead of N queries per item.
    movie_ids = [cid for ct, cid in tracked if ct == "movie"]
    show_ids = [cid for ct, cid in tracked if ct == "tv"]
    movies_by_id = {
        m.id: m for m in db.query(Movie).filter(Movie.id.in_(movie_ids)).all()
    } if movie_ids else {}
    shows_by_id = {
        s.id: s for s in db.query(Show).filter(Show.id.in_(show_ids)).all()
    } if show_ids else {}

    for content_type, content_id in tracked:
        if content_type == "movie":
            movie = movies_by_id.get(content_id)
            if movie:
                movie.tracking_count = max(0, (movie.tracking_count or 1) - 1)
        elif content_type == "tv":
            show = shows_by_id.get(content_id)
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

    # Remove shows/movies no longer tracked by anyone. Re-use the maps loaded
    # above so we don't requery every row. Bulk deletes are all issued before
    # any show DELETE so the FK from episode -> show isn't violated by an
    # autoflush mid-cleanup.
    orphan_movie_ids = [
        cid for ct, cid in tracked
        if ct == "movie" and (m := movies_by_id.get(cid)) and m.tracking_count <= 0
    ]
    orphan_show_ids = [
        cid for ct, cid in tracked
        if ct == "tv" and (s := shows_by_id.get(cid)) and s.tracking_count <= 0
    ]

    if orphan_show_ids:
        db.query(EpisodeWatched).filter(
            EpisodeWatched.show_id.in_(orphan_show_ids)
        ).delete(synchronize_session=False)
        db.query(Episode).filter(Episode.show_id.in_(orphan_show_ids)).delete(
            synchronize_session=False
        )
        db.query(Show).filter(Show.id.in_(orphan_show_ids)).delete(
            synchronize_session=False
        )
    if orphan_movie_ids:
        db.query(Movie).filter(Movie.id.in_(orphan_movie_ids)).delete(
            synchronize_session=False
        )

    db.delete(target)
    db.commit()

    try:
        auth.delete_user(uid)
    except auth.UserNotFoundError:
        pass

    return {"detail": "User deleted."}
