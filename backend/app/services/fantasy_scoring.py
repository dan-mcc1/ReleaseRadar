"""Pure scoring functions for the fantasy game. No DB access — caller assembles
inputs and persists the resulting breakdown as a FantasyWeeklyScore row.

Three asset tracks (theatrical / streamer / TV) score differently because the
data we have for each is different. See docs/fantasy-game-design.md for the
full design.
"""
from dataclasses import dataclass, field
from typing import Optional


# --- Theatrical movie constants ---------------------------------------------

ROI_BASE_PER_X = 10.0  # 10 pts per 1x ROI
ROI_CAP = 10.0  # ROI above 10x stops adding base pts (log-scale ceiling)
MILESTONE_2X = 15
MILESTONE_5X = 30
MILESTONE_10X = 50
FLOP_PENALTY = -50  # ROI < 1x
CRITICAL_HIT_BONUS = 20  # RT >= 90%
CRITICAL_BOMB_PENALTY = -15  # RT <= 30%
CINEMASCORE_A_BONUS = 15

# --- TV constants ------------------------------------------------------------

EPISODE_BASE = 15
EPISODE_HIGH_RATING_BONUS = 5  # per high-rated ep (IMDB >= 8.5 or RT >= 90)
PREMIERE_BONUS = 25
FINALE_BONUS = 25
SEASON_COMPLETION_BONUS = 50
RENEWAL_BONUS = 75
CANCELLATION_PENALTY = -50

# --- Streamer movie constants -----------------------------------------------

STREAMER_TOP10_PER_WEEK = 20
STREAMER_TOP1_PER_WEEK = 40
STREAMER_AUDIENCE_STRONG = 15  # rating >= 8.0
STREAMER_AUDIENCE_GOOD = 5  # rating >= 7.0
STREAMER_CRITICAL_SOLID = 10  # RT >= 80% (and < 90%)

# --- Cross-cutting -----------------------------------------------------------

TRENDING_1_BONUS = 20
TRENDING_5_BONUS = 10
AWARDS_NOM_BONUS = 15
AWARDS_WIN_BONUS = 50


@dataclass
class ScoringBreakdown:
    base: float = 0.0
    milestones: float = 0.0
    bonuses: dict = field(default_factory=dict)
    penalties: dict = field(default_factory=dict)

    @property
    def total(self) -> float:
        return (
            self.base
            + self.milestones
            + sum(self.bonuses.values())
            + sum(self.penalties.values())
        )

    def to_dict(self) -> dict:
        return {
            "base": round(self.base, 2),
            "milestones": round(self.milestones, 2),
            "bonuses": {k: round(v, 2) for k, v in self.bonuses.items()},
            "penalties": {k: round(v, 2) for k, v in self.penalties.items()},
            "total": round(self.total, 2),
        }


def score_theatrical_movie(
    *,
    budget: Optional[float],
    revenue: Optional[float],
    rt_score: Optional[int] = None,
    cinemascore: Optional[str] = None,
    trending_rank: Optional[int] = None,
) -> ScoringBreakdown:
    """Cumulative-to-date score for a theatrical movie. Caller computes the
    weekly delta by subtracting last week's snapshot from this one."""
    bd = ScoringBreakdown()

    if budget and budget > 0 and revenue is not None:
        roi = revenue / budget
        capped_roi = min(roi, ROI_CAP)
        bd.base = capped_roi * ROI_BASE_PER_X

        if roi < 1.0 and revenue > 0:
            bd.penalties["flop"] = FLOP_PENALTY

        if roi >= 2.0:
            bd.milestones += MILESTONE_2X
        if roi >= 5.0:
            bd.milestones += MILESTONE_5X
        if roi >= 10.0:
            bd.milestones += MILESTONE_10X

    if rt_score is not None:
        if rt_score >= 90:
            bd.bonuses["critical_hit"] = CRITICAL_HIT_BONUS
        elif rt_score <= 30:
            bd.penalties["critical_bomb"] = CRITICAL_BOMB_PENALTY

    if cinemascore and cinemascore.upper() in ("A+", "A"):
        bd.bonuses["cinemascore"] = CINEMASCORE_A_BONUS

    _apply_trending(bd, trending_rank)
    return bd


def score_tv_week(
    *,
    episodes_aired: int = 0,
    high_rated_episodes: int = 0,
    is_premiere: bool = False,
    is_finale: bool = False,
    season_completed: bool = False,
    renewal_event: Optional[str] = None,
    trending_rank: Optional[int] = None,
    awards_noms: int = 0,
    awards_wins: int = 0,
) -> ScoringBreakdown:
    """This-week-only score for a TV series. Renewal/cancellation should only be
    passed in the week the announcement actually happened."""
    bd = ScoringBreakdown()

    bd.base = episodes_aired * EPISODE_BASE

    if is_premiere:
        bd.bonuses["premiere"] = PREMIERE_BONUS
    if is_finale:
        bd.bonuses["finale"] = FINALE_BONUS

    if high_rated_episodes > 0:
        bd.bonuses["high_rated"] = high_rated_episodes * EPISODE_HIGH_RATING_BONUS

    if season_completed:
        bd.bonuses["season_completion"] = SEASON_COMPLETION_BONUS

    if renewal_event == "renewed":
        bd.bonuses["renewal"] = RENEWAL_BONUS
    elif renewal_event == "cancelled":
        bd.penalties["cancellation"] = CANCELLATION_PENALTY

    if awards_noms:
        bd.bonuses["awards_noms"] = awards_noms * AWARDS_NOM_BONUS
    if awards_wins:
        bd.bonuses["awards_wins"] = awards_wins * AWARDS_WIN_BONUS

    _apply_trending(bd, trending_rank)
    return bd


def score_streamer_movie_week(
    *,
    in_top10_this_week: bool = False,
    at_top1_this_week: bool = False,
    rt_score: Optional[int] = None,
    audience_score: Optional[float] = None,
    trending_rank: Optional[int] = None,
    awards_noms: int = 0,
    awards_wins: int = 0,
) -> ScoringBreakdown:
    """This-week-only score for a streamer movie. Reception bonuses only fire
    once per release window — caller should pass them on a single chosen week
    (e.g. settlement week) to avoid double-counting."""
    bd = ScoringBreakdown()

    if at_top1_this_week:
        bd.base += STREAMER_TOP1_PER_WEEK
    elif in_top10_this_week:
        bd.base += STREAMER_TOP10_PER_WEEK

    if rt_score is not None:
        if rt_score >= 90:
            bd.bonuses["critical_hit"] = CRITICAL_HIT_BONUS
        elif rt_score >= 80:
            bd.bonuses["critical_solid"] = STREAMER_CRITICAL_SOLID

    if audience_score is not None:
        if audience_score >= 8.0:
            bd.bonuses["audience_strong"] = STREAMER_AUDIENCE_STRONG
        elif audience_score >= 7.0:
            bd.bonuses["audience_good"] = STREAMER_AUDIENCE_GOOD

    if awards_noms:
        bd.bonuses["awards_noms"] = awards_noms * AWARDS_NOM_BONUS
    if awards_wins:
        bd.bonuses["awards_wins"] = awards_wins * AWARDS_WIN_BONUS

    _apply_trending(bd, trending_rank)
    return bd


def _apply_trending(bd: ScoringBreakdown, rank: Optional[int]) -> None:
    if rank is None:
        return
    if rank == 1:
        bd.bonuses["trending_1"] = TRENDING_1_BONUS
    elif rank <= 5:
        bd.bonuses["trending_5"] = TRENDING_5_BONUS


def weekly_delta(prev_total: float, current_total: float) -> float:
    """For cumulative scoring (theatrical movies), the points to record for this
    week are the difference from the previous snapshot. Floors at 0 so a
    revenue correction can't gift negative points to a downstream week."""
    return max(0.0, current_total - prev_total)
