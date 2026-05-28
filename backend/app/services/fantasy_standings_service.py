"""Read-side aggregation over FantasyWeeklyScore — produces league standings
and breakdowns for the UI."""
import json
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.fantasy import (
    FantasyAsset,
    FantasyLeagueMember,
    FantasySeason,
    FantasyWeeklyScore,
)
from app.models.movie import Movie
from app.models.show import Show
from app.models.user import User


def _ensure_member(db: Session, league_id: int, user_id: str) -> FantasyLeagueMember:
    member = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == league_id,
            FantasyLeagueMember.user_id == user_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="League not found.")
    return member


def _ensure_season_belongs_to_league(
    db: Session, league_id: int, season_id: int
) -> FantasySeason:
    season = (
        db.query(FantasySeason)
        .filter(FantasySeason.id == season_id, FantasySeason.league_id == league_id)
        .first()
    )
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")
    return season


def get_standings(
    db: Session,
    viewer_id: str,
    league_id: int,
    season_id: int,
    *,
    through_week: Optional[int] = None,
) -> list[dict]:
    """Per-user totals for the season. If through_week is set, only includes
    weeks <= that number (lets you replay standings at a past week)."""
    _ensure_member(db, league_id, viewer_id)
    _ensure_season_belongs_to_league(db, league_id, season_id)

    score_q = (
        db.query(
            FantasyWeeklyScore.user_id,
            func.coalesce(func.sum(FantasyWeeklyScore.points), 0.0).label("total"),
            func.count(func.distinct(FantasyWeeklyScore.asset_id)).label("asset_count"),
        )
        .filter(
            FantasyWeeklyScore.league_id == league_id,
            FantasyWeeklyScore.season_id == season_id,
        )
        .group_by(FantasyWeeklyScore.user_id)
    )
    if through_week is not None:
        score_q = score_q.filter(FantasyWeeklyScore.week_number <= through_week)

    score_rows = {row.user_id: (row.total, row.asset_count) for row in score_q.all()}

    members = (
        db.query(FantasyLeagueMember, User)
        .outerjoin(User, User.id == FantasyLeagueMember.user_id)
        .filter(FantasyLeagueMember.league_id == league_id)
        .all()
    )

    standings = []
    for member, user in members:
        total, asset_count = score_rows.get(member.user_id, (0.0, 0))
        standings.append(
            {
                "user_id": member.user_id,
                "username": user.username if user else None,
                "user_display_name": user.display_name if user else None,
                "league_display_name": member.display_name,
                "role": member.role,
                "total_points": round(float(total), 2),
                "asset_count": int(asset_count),
            }
        )

    standings.sort(key=lambda r: r["total_points"], reverse=True)
    for rank, row in enumerate(standings, start=1):
        row["rank"] = rank
    return standings


def get_user_breakdown(
    db: Session,
    viewer_id: str,
    league_id: int,
    season_id: int,
    user_id: str,
) -> dict:
    """Per-asset scoring breakdown for a single user in a season. Includes the
    asset's content metadata (title, poster) so the UI can render cards."""
    _ensure_member(db, league_id, viewer_id)
    _ensure_season_belongs_to_league(db, league_id, season_id)

    assets = (
        db.query(FantasyAsset)
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.owner_user_id == user_id,
        )
        .all()
    )
    if not assets:
        return {"user_id": user_id, "assets": [], "total_points": 0.0}

    score_rows = (
        db.query(
            FantasyWeeklyScore.asset_id,
            func.coalesce(func.sum(FantasyWeeklyScore.points), 0.0).label("total"),
        )
        .filter(FantasyWeeklyScore.asset_id.in_([a.id for a in assets]))
        .group_by(FantasyWeeklyScore.asset_id)
        .all()
    )
    score_by_asset = {r.asset_id: float(r.total) for r in score_rows}

    movie_ids = [a.content_id for a in assets if a.content_type == "movie"]
    show_ids = [a.content_id for a in assets if a.content_type == "tv"]
    movies = (
        {m.id: m for m in db.query(Movie).filter(Movie.id.in_(movie_ids)).all()}
        if movie_ids
        else {}
    )
    shows = (
        {s.id: s for s in db.query(Show).filter(Show.id.in_(show_ids)).all()}
        if show_ids
        else {}
    )

    asset_rows = []
    total = 0.0
    for asset in assets:
        pts = score_by_asset.get(asset.id, 0.0)
        total += pts
        meta: dict = {"title": None, "poster_path": None}
        if asset.content_type == "movie":
            m = movies.get(asset.content_id)
            if m:
                meta = {"title": m.title, "poster_path": m.poster_path}
        else:
            s = shows.get(asset.content_id)
            if s:
                meta = {"title": s.name, "poster_path": s.poster_path}

        asset_rows.append(
            {
                "asset_id": asset.id,
                "content_type": asset.content_type,
                "content_id": asset.content_id,
                "title": meta["title"],
                "poster_path": meta["poster_path"],
                "auction_price": asset.auction_price,
                "slot_type": asset.slot_type,
                "drafted_at": asset.drafted_at,
                "dropped_at": asset.dropped_at,
                "total_points": round(pts, 2),
            }
        )

    asset_rows.sort(key=lambda r: r["total_points"], reverse=True)
    return {"user_id": user_id, "assets": asset_rows, "total_points": round(total, 2)}


def get_asset_weekly_scores(
    db: Session,
    viewer_id: str,
    league_id: int,
    asset_id: int,
) -> list[dict]:
    """Week-by-week scoring trail for a single asset with parsed breakdowns."""
    _ensure_member(db, league_id, viewer_id)

    asset = (
        db.query(FantasyAsset)
        .filter(FantasyAsset.id == asset_id, FantasyAsset.league_id == league_id)
        .first()
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    rows = (
        db.query(FantasyWeeklyScore)
        .filter(FantasyWeeklyScore.asset_id == asset_id)
        .order_by(FantasyWeeklyScore.week_number.asc())
        .all()
    )
    out = []
    for r in rows:
        try:
            breakdown = json.loads(r.breakdown) if r.breakdown else {}
        except (TypeError, ValueError):
            breakdown = {}
        out.append(
            {
                "week_number": r.week_number,
                "points": round(float(r.points), 2),
                "breakdown": breakdown,
                "computed_at": r.computed_at,
            }
        )
    return out


def get_weekly_chart(
    db: Session, viewer_id: str, league_id: int, season_id: int
) -> dict:
    """Returns weekly totals per user across the season — suitable for a line
    chart of league standings over time."""
    _ensure_member(db, league_id, viewer_id)
    _ensure_season_belongs_to_league(db, league_id, season_id)

    rows = (
        db.query(
            FantasyWeeklyScore.user_id,
            FantasyWeeklyScore.week_number,
            func.coalesce(func.sum(FantasyWeeklyScore.points), 0.0).label("points"),
        )
        .filter(
            FantasyWeeklyScore.league_id == league_id,
            FantasyWeeklyScore.season_id == season_id,
        )
        .group_by(FantasyWeeklyScore.user_id, FantasyWeeklyScore.week_number)
        .order_by(FantasyWeeklyScore.week_number.asc())
        .all()
    )

    by_user: dict[str, dict[int, float]] = {}
    weeks_seen: set[int] = set()
    for r in rows:
        by_user.setdefault(r.user_id, {})[r.week_number] = float(r.points)
        weeks_seen.add(r.week_number)

    weeks_sorted = sorted(weeks_seen)
    series = []
    for uid, by_week in by_user.items():
        cumulative = 0.0
        points = []
        for w in weeks_sorted:
            cumulative += by_week.get(w, 0.0)
            points.append({"week": w, "weekly": round(by_week.get(w, 0.0), 2), "cumulative": round(cumulative, 2)})
        series.append({"user_id": uid, "points": points})

    return {"weeks": weeks_sorted, "series": series}
