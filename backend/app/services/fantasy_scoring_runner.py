"""Weekly scoring runner. Pulls current data from Movie/Show/Episode + OMDb +
FantasyRenewalEvent, calls the pure scoring functions, and upserts
FantasyWeeklyScore rows.

Idempotent on (asset_id, week_number) — safe to re-run for any week.
"""
import json
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.episode import Episode
from app.models.fantasy import (
    FantasyAsset,
    FantasyRenewalEvent,
    FantasySeason,
    FantasyWeeklyScore,
)
from app.models.movie import Movie
from app.models.show import Show
from app.services.fantasy_lineup_service import BOOST_MULTIPLIER, has_boost
from app.services.fantasy_scoring import (
    ScoringBreakdown,
    score_theatrical_movie,
    score_tv_week,
    weekly_delta,
)
from app.services.omdb_service import get_omdb_scores

logger = logging.getLogger(__name__)


def week_range(season: FantasySeason, week_number: int) -> tuple[date, date]:
    """Returns (start inclusive, end exclusive) date range for the week."""
    if week_number < 1:
        raise ValueError("week_number is 1-indexed")
    start = season.starts_at.date() + timedelta(days=(week_number - 1) * 7)
    end = start + timedelta(days=7)
    return start, end


def current_week_for_season(
    season: FantasySeason, now: datetime | None = None
) -> int:
    """1-indexed current week of the season. Returns 0 if the season hasn't
    started yet."""
    now = now or datetime.now(timezone.utc)
    if now < season.starts_at:
        return 0
    days_in = (now.date() - season.starts_at.date()).days
    return (days_in // 7) + 1


def _parse_rt_score(omdb_scores: dict) -> int | None:
    raw = omdb_scores.get("rotten_tomatoes")
    if not raw:
        return None
    try:
        return int(str(raw).rstrip("%"))
    except (ValueError, AttributeError):
        return None


def _score_movie_cumulative(movie: Movie) -> ScoringBreakdown:
    rt_score = _parse_rt_score(get_omdb_scores(movie.imdb_id)) if movie.imdb_id else None
    return score_theatrical_movie(
        budget=movie.budget,
        revenue=movie.revenue,
        rt_score=rt_score,
    )


def _score_tv_for_week(
    db: Session, *, show: Show, week_start: date, week_end: date
) -> ScoringBreakdown:
    episodes = (
        db.query(Episode)
        .filter(
            Episode.show_id == show.id,
            Episode.air_date.isnot(None),
            Episode.air_date >= week_start,
            Episode.air_date < week_end,
        )
        .all()
    )

    episodes_aired = len(episodes)
    high_rated = sum(1 for e in episodes if (e.vote_average or 0) >= 8.5)
    is_premiere = any(e.episode_number == 1 for e in episodes)
    is_finale = any(
        (e.episode_type or "").lower() in ("finale", "mid_season") for e in episodes
    )

    season_completed = False
    if episodes:
        for season_number in {e.season_number for e in episodes}:
            last_ep = (
                db.query(Episode)
                .filter(
                    Episode.show_id == show.id,
                    Episode.season_number == season_number,
                )
                .order_by(Episode.episode_number.desc())
                .first()
            )
            if (
                last_ep
                and last_ep.air_date
                and week_start <= last_ep.air_date < week_end
            ):
                season_completed = True
                break

    week_start_dt = datetime.combine(week_start, datetime.min.time(), tzinfo=timezone.utc)
    week_end_dt = datetime.combine(week_end, datetime.min.time(), tzinfo=timezone.utc)
    renewal = (
        db.query(FantasyRenewalEvent)
        .filter(
            FantasyRenewalEvent.show_id == show.id,
            FantasyRenewalEvent.announced_at >= week_start_dt,
            FantasyRenewalEvent.announced_at < week_end_dt,
        )
        .order_by(FantasyRenewalEvent.announced_at.desc())
        .first()
    )

    return score_tv_week(
        episodes_aired=episodes_aired,
        high_rated_episodes=high_rated,
        is_premiere=is_premiere,
        is_finale=is_finale,
        season_completed=season_completed,
        renewal_event=renewal.event_type if renewal else None,
    )


def _prior_cumulative_total(
    db: Session, asset_id: int, week_number: int
) -> float:
    rows = (
        db.query(FantasyWeeklyScore.points)
        .filter(
            FantasyWeeklyScore.asset_id == asset_id,
            FantasyWeeklyScore.week_number < week_number,
        )
        .all()
    )
    return sum(r[0] for r in rows)


def _upsert_weekly_score(
    db: Session,
    *,
    asset: FantasyAsset,
    week_number: int,
    points: float,
    breakdown: dict,
) -> FantasyWeeklyScore:
    row = (
        db.query(FantasyWeeklyScore)
        .filter(
            FantasyWeeklyScore.asset_id == asset.id,
            FantasyWeeklyScore.week_number == week_number,
        )
        .first()
    )
    if row is None:
        row = FantasyWeeklyScore(
            league_id=asset.league_id,
            season_id=asset.season_id,
            asset_id=asset.id,
            user_id=asset.owner_user_id,
            week_number=week_number,
            points=points,
            breakdown=json.dumps(breakdown),
        )
        db.add(row)
    else:
        row.points = points
        row.breakdown = json.dumps(breakdown)
        row.computed_at = datetime.now(timezone.utc)
    return row


def score_asset_for_week(
    db: Session,
    *,
    asset: FantasyAsset,
    season: FantasySeason,
    week_number: int,
) -> FantasyWeeklyScore | None:
    """Score a single asset for one week. Returns None if the asset wasn't on
    a roster during that week (drafted later / dropped earlier)."""
    week_start, week_end = week_range(season, week_number)

    drafted_at = asset.drafted_at
    if drafted_at and drafted_at.date() >= week_end:
        return None
    if asset.dropped_at and asset.dropped_at.date() < week_start:
        return None

    # Benched assets score zero — they're not in the active lineup.
    if asset.slot_type == "bench":
        return _upsert_weekly_score(
            db,
            asset=asset,
            week_number=week_number,
            points=0.0,
            breakdown={"benched": True, "total": 0.0},
        )

    boosted = has_boost(db, asset_id=asset.id, week_number=week_number)

    if asset.content_type == "movie":
        movie = db.query(Movie).filter(Movie.id == asset.content_id).first()
        if not movie:
            return None
        cumulative = _score_movie_cumulative(movie)
        prior = _prior_cumulative_total(db, asset.id, week_number)
        raw_delta = weekly_delta(prior, cumulative.total)
        delta = raw_delta * BOOST_MULTIPLIER if boosted else raw_delta
        breakdown = cumulative.to_dict()
        breakdown["delta"] = round(delta, 2)
        breakdown["raw_delta"] = round(raw_delta, 2)
        breakdown["prior_cumulative"] = round(prior, 2)
        breakdown["boosted"] = boosted
        return _upsert_weekly_score(
            db,
            asset=asset,
            week_number=week_number,
            points=delta,
            breakdown=breakdown,
        )

    if asset.content_type == "tv":
        show = db.query(Show).filter(Show.id == asset.content_id).first()
        if not show:
            return None
        bd = _score_tv_for_week(
            db, show=show, week_start=week_start, week_end=week_end
        )
        raw = bd.total
        final = raw * BOOST_MULTIPLIER if boosted else raw
        breakdown = bd.to_dict()
        breakdown["raw_total"] = round(raw, 2)
        breakdown["boosted"] = boosted
        return _upsert_weekly_score(
            db,
            asset=asset,
            week_number=week_number,
            points=final,
            breakdown=breakdown,
        )

    return None


def run_weekly_scoring(
    db: Session, *, season_id: int, week_number: int | None = None
) -> int:
    """Score every asset in the season for the given week. If week_number is
    omitted, uses the season's current week. Returns count of rows written."""
    season = db.query(FantasySeason).filter(FantasySeason.id == season_id).first()
    if not season:
        logger.warning("fantasy scoring: season %s not found", season_id)
        return 0

    if week_number is None:
        week_number = current_week_for_season(season)
        if week_number < 1:
            logger.info(
                "fantasy scoring: season %s hasn't started yet", season_id
            )
            return 0

    assets = (
        db.query(FantasyAsset).filter(FantasyAsset.season_id == season_id).all()
    )

    written = 0
    for asset in assets:
        try:
            row = score_asset_for_week(
                db, asset=asset, season=season, week_number=week_number
            )
            if row is not None:
                written += 1
        except Exception as e:
            logger.error(
                "fantasy scoring: asset %s week %s failed: %s",
                asset.id,
                week_number,
                e,
            )
    db.commit()
    logger.info(
        "fantasy scoring: season=%s week=%s scored %d/%d assets",
        season_id,
        week_number,
        written,
        len(assets),
    )
    return written


def backfill_season(db: Session, *, season_id: int) -> int:
    """Re-run scoring for every week from season start to current week.
    Useful after a data correction or when seeding a league mid-season."""
    season = db.query(FantasySeason).filter(FantasySeason.id == season_id).first()
    if not season:
        return 0
    current_week = current_week_for_season(season)
    if current_week < 1:
        return 0
    total = 0
    for wn in range(1, current_week + 1):
        total += run_weekly_scoring(db, season_id=season_id, week_number=wn)
    return total


def run_all_active_seasons(db: Session) -> dict[int, int]:
    """Score current week for every season currently in 'active' status."""
    seasons = (
        db.query(FantasySeason).filter(FantasySeason.status == "active").all()
    )
    results: dict[int, int] = {}
    for season in seasons:
        wn = current_week_for_season(season)
        if wn < 1:
            continue
        results[season.id] = run_weekly_scoring(
            db, season_id=season.id, week_number=wn
        )
    return results
