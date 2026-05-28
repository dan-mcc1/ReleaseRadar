"""Unit tests for the pure scoring functions. No DB or HTTP — these exercise
just the math from the design doc.

Reference: Summer 2024 worked example in docs/fantasy-game-design.md
"""
import pytest

from app.services.fantasy_scoring import (
    CRITICAL_BOMB_PENALTY,
    CRITICAL_HIT_BONUS,
    FLOP_PENALTY,
    MILESTONE_2X,
    MILESTONE_5X,
    MILESTONE_10X,
    score_streamer_movie_week,
    score_theatrical_movie,
    score_tv_week,
    weekly_delta,
)


def test_boost_multiplier_resolves():
    """Sanity check that the boost multiplier is the agreed value."""
    from app.services.fantasy_lineup_service import BOOST_MULTIPLIER

    assert BOOST_MULTIPLIER == 1.5


# ─── Theatrical movie scoring ───────────────────────────────────────────────


class TestTheatricalMovie:
    def test_basic_5x_roi(self):
        # $50M -> $250M = 5x
        bd = score_theatrical_movie(budget=50_000_000, revenue=250_000_000)
        assert bd.base == 50  # 5x * 10
        assert bd.milestones == MILESTONE_2X + MILESTONE_5X
        assert "flop" not in bd.penalties
        assert bd.total == 95

    def test_2x_only_milestone(self):
        bd = score_theatrical_movie(budget=100, revenue=300)  # 3x
        assert bd.milestones == MILESTONE_2X
        assert bd.base == 30

    def test_flop_below_1x(self):
        # $100M -> $30M = 0.3x (Borderlands-tier)
        bd = score_theatrical_movie(budget=100_000_000, revenue=30_000_000)
        assert bd.penalties["flop"] == FLOP_PENALTY
        assert bd.milestones == 0
        assert bd.total < 0

    def test_capped_at_10x(self):
        # $5M -> $100M = 20x, but base caps at 10x scoring
        bd = score_theatrical_movie(budget=5_000_000, revenue=100_000_000)
        assert bd.base == 100  # 10x cap * 10
        assert bd.milestones == MILESTONE_2X + MILESTONE_5X + MILESTONE_10X

    def test_critical_hit_bonus(self):
        bd = score_theatrical_movie(budget=100, revenue=300, rt_score=92)
        assert bd.bonuses["critical_hit"] == CRITICAL_HIT_BONUS

    def test_critical_bomb_penalty(self):
        bd = score_theatrical_movie(budget=100, revenue=300, rt_score=25)
        assert bd.penalties["critical_bomb"] == CRITICAL_BOMB_PENALTY

    def test_cinemascore_a_bonus(self):
        bd = score_theatrical_movie(budget=100, revenue=300, cinemascore="A+")
        assert bd.bonuses["cinemascore"] == 15
        bd_b = score_theatrical_movie(budget=100, revenue=300, cinemascore="B")
        assert "cinemascore" not in bd_b.bonuses

    def test_missing_budget_returns_zero_base(self):
        bd = score_theatrical_movie(budget=None, revenue=100_000)
        assert bd.base == 0
        assert bd.milestones == 0
        assert "flop" not in bd.penalties

    def test_pre_release_no_flop_penalty(self):
        # Budget set but revenue is 0 (movie hasn't opened) — no flop
        bd = score_theatrical_movie(budget=100_000_000, revenue=0)
        assert "flop" not in bd.penalties

    def test_trending_top1(self):
        bd = score_theatrical_movie(budget=100, revenue=300, trending_rank=1)
        assert bd.bonuses["trending_1"] == 20

    def test_trending_top5(self):
        bd = score_theatrical_movie(budget=100, revenue=300, trending_rank=4)
        assert bd.bonuses["trending_5"] == 10


# ─── TV scoring ─────────────────────────────────────────────────────────────


class TestTvWeek:
    def test_two_episodes_aired(self):
        bd = score_tv_week(episodes_aired=2)
        assert bd.base == 30  # 2 * 15

    def test_premiere_only(self):
        bd = score_tv_week(episodes_aired=1, is_premiere=True)
        assert bd.bonuses["premiere"] == 25
        assert bd.total == 40  # 15 + 25

    def test_finale_and_completion(self):
        bd = score_tv_week(
            episodes_aired=1, is_finale=True, season_completed=True
        )
        # base 15 + finale 25 + completion 50 = 90
        assert bd.bonuses["finale"] == 25
        assert bd.bonuses["season_completion"] == 50
        assert bd.total == 90

    def test_high_rated_bonus(self):
        bd = score_tv_week(episodes_aired=3, high_rated_episodes=2)
        # base 45 + 2 high-rated * 5 = 55
        assert bd.bonuses["high_rated"] == 10
        assert bd.total == 55

    def test_renewal_bonus(self):
        bd = score_tv_week(renewal_event="renewed")
        assert bd.bonuses["renewal"] == 75

    def test_cancellation_penalty(self):
        bd = score_tv_week(renewal_event="cancelled")
        assert bd.penalties["cancellation"] == -50

    def test_quiet_week_zero_points(self):
        bd = score_tv_week()
        assert bd.total == 0


# ─── Streamer movie scoring ─────────────────────────────────────────────────


class TestStreamerMovie:
    def test_top1_beats_top10(self):
        bd_top1 = score_streamer_movie_week(at_top1_this_week=True)
        bd_top10 = score_streamer_movie_week(in_top10_this_week=True)
        assert bd_top1.base > bd_top10.base

    def test_top1_supersedes_top10(self):
        # If both flags are set, top1 wins (no double-count)
        bd = score_streamer_movie_week(
            at_top1_this_week=True, in_top10_this_week=True
        )
        assert bd.base == 40  # just the top1 amount

    def test_audience_strong(self):
        bd = score_streamer_movie_week(audience_score=8.5)
        assert bd.bonuses["audience_strong"] == 15

    def test_audience_good_not_strong(self):
        bd = score_streamer_movie_week(audience_score=7.4)
        assert bd.bonuses["audience_good"] == 5
        assert "audience_strong" not in bd.bonuses


# ─── Delta calculation ──────────────────────────────────────────────────────


class TestWeeklyDelta:
    def test_normal_growth(self):
        assert weekly_delta(50, 100) == 50

    def test_floors_at_zero_on_regression(self):
        # Revenue correction or breakdown adjustment could lower cumulative —
        # we don't subtract from past weeks.
        assert weekly_delta(100, 80) == 0

    def test_zero_change_zero_delta(self):
        assert weekly_delta(50, 50) == 0


# ─── Worked-example sanity check ────────────────────────────────────────────


class TestDesignDocReferenceValues:
    """Confirms a few headline numbers from the Summer 2024 worked example in
    docs/fantasy-game-design.md still hold after any scoring tuning."""

    def test_deadpool_wolverine_cumulative_floor(self):
        # $200M -> $1.34B = 6.7x. No trending/cinemascore data, RT ~78.
        bd = score_theatrical_movie(budget=200_000_000, revenue=1_340_000_000)
        # Base: capped at 10x scoring not applicable (6.7 < 10), so 67.
        # Milestones: 2x + 5x = 45
        # Total: ~112 baseline (without #1-opening and weeks-at-#1 modifiers
        # which aren't computed by the pure function).
        assert bd.base == pytest.approx(67, rel=0.01)
        assert bd.milestones == MILESTONE_2X + MILESTONE_5X
        assert bd.total == pytest.approx(112, rel=0.05)

    def test_it_ends_with_us_sleeper(self):
        # $25M -> $351M = 14x — the sleeper hit, capped at 10x base.
        bd = score_theatrical_movie(budget=25_000_000, revenue=351_000_000)
        assert bd.base == 100  # 10x cap
        assert bd.milestones == MILESTONE_2X + MILESTONE_5X + MILESTONE_10X
        # 100 + 95 = 195 before any RT/CinemaScore add-ons
        assert bd.total == pytest.approx(195, rel=0.01)

    def test_borderlands_flop(self):
        # $110M -> $33M = 0.3x flop
        bd = score_theatrical_movie(budget=110_000_000, revenue=33_000_000)
        assert bd.penalties["flop"] == FLOP_PENALTY
        # Base is still 0.3 * 10 = 3, so total = 3 - 50 = -47
        assert bd.total == pytest.approx(-47, rel=0.05)
