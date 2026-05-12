# app/services/binge_planner_service.py
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta, timezone, date
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.finish_by_goal import FinishByGoal
from app.models.season import Season
from app.models.show import Show

_DEFAULT_EPISODE_RUNTIME = 40  # minutes — used when runtime is NULL


def get_binge_plan(db: Session, user_id: str, show_id: int) -> dict:
    """
    Return remaining runtime + pace estimate for a show, including any finish-by goal.
    """
    show = db.query(Show).filter_by(id=show_id).first()
    if not show:
        return {"error": "Show not found"}

    # All episodes for the show (excluding season 0 specials)
    all_episodes = (
        db.query(Episode)
        .filter(Episode.show_id == show_id, Episode.season_number > 0)
        .all()
    )

    # Episodes the user has already watched
    watched_set: set[tuple[int, int]] = {
        (r.season_number, r.episode_number)
        for r in db.query(EpisodeWatched.season_number, EpisodeWatched.episode_number)
        .filter_by(user_id=user_id, show_id=show_id)
        .all()
    }

    remaining_eps = [
        ep for ep in all_episodes
        if (ep.season_number, ep.episode_number) not in watched_set
    ]

    remaining_minutes = sum(
        ep.runtime if ep.runtime else _DEFAULT_EPISODE_RUNTIME
        for ep in remaining_eps
    )

    # ── Pace calculation ─────────────────────────────────────────────────────
    # Episodes watched for this show in the last 30 days
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    recent_count: int = (
        db.query(func.count(EpisodeWatched.id))
        .filter(
            EpisodeWatched.user_id == user_id,
            EpisodeWatched.show_id == show_id,
            EpisodeWatched.watched_at >= thirty_days_ago,
        )
        .scalar()
        or 0
    )
    eps_per_week = (recent_count / 30) * 7 if recent_count > 0 else None

    completion_weeks: float | None = None
    if eps_per_week and eps_per_week > 0 and remaining_eps:
        completion_weeks = len(remaining_eps) / eps_per_week

    # Friendly completion estimate
    completion_label: str | None = None
    if completion_weeks is not None:
        if completion_weeks < (1 / 7):
            completion_label = "today"
        elif completion_weeks < 1:
            days = round(completion_weeks * 7)
            completion_label = f"in {days} day{'s' if days != 1 else ''}"
        elif completion_weeks < 4:
            wks = round(completion_weeks)
            completion_label = f"in {wks} week{'s' if wks != 1 else ''}"
        else:
            months = round(completion_weeks / 4.33)
            completion_label = f"in {months} month{'s' if months != 1 else ''}"

    # ── Finish-by goal ───────────────────────────────────────────────────────
    goal = db.query(FinishByGoal).filter_by(user_id=user_id, show_id=show_id).first()
    finish_by_date: str | None = None
    eps_per_day_needed: float | None = None
    mins_per_day_needed: float | None = None

    if goal:
        finish_by_date = goal.target_date.isoformat()
        days_remaining = (goal.target_date - date.today()).days
        if days_remaining > 0 and remaining_eps:
            eps_per_day_needed = round(len(remaining_eps) / days_remaining, 1)
            mins_per_day_needed = round(remaining_minutes / days_remaining)
        elif days_remaining <= 0:
            # Goal date has passed — still return it so UI can show it as overdue
            eps_per_day_needed = None
            mins_per_day_needed = None

    return {
        "show_id": show_id,
        "show_name": show.name,
        "total_episodes": len(all_episodes),
        "watched_episodes": len(watched_set),
        "remaining_episodes": len(remaining_eps),
        "remaining_minutes": remaining_minutes,
        "eps_per_week_recent": round(eps_per_week, 1) if eps_per_week else None,
        "completion_estimate": completion_label,
        "finish_by_date": finish_by_date,
        "eps_per_day_needed": eps_per_day_needed,
        "mins_per_day_needed": mins_per_day_needed,
    }


def get_binge_plans_bulk(db: Session, user_id: str, show_ids: list[int]) -> dict:
    """Return binge plan for multiple shows in one call."""
    return {str(sid): get_binge_plan(db, user_id, sid) for sid in show_ids}


def set_finish_by_goal(db: Session, user_id: str, show_id: int, target_date: date) -> None:
    goal = db.query(FinishByGoal).filter_by(user_id=user_id, show_id=show_id).first()
    if goal:
        goal.target_date = target_date
    else:
        db.add(FinishByGoal(user_id=user_id, show_id=show_id, target_date=target_date))
    db.commit()


def clear_finish_by_goal(db: Session, user_id: str, show_id: int) -> None:
    db.query(FinishByGoal).filter_by(user_id=user_id, show_id=show_id).delete()
    db.commit()
