"""
Tests for app.services.binge_planner_service.

Covers:
- get_binge_plan: total/watched/remaining episode counts, runtime, pace
- get_binge_plans_bulk: same calculations over a list of shows
- set_finish_by_goal / clear_finish_by_goal: round-trip + idempotency
- The completion_label friendly-string buckets
"""

from datetime import date, datetime, timedelta, timezone

import pytest


# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture
def seed_show_with_episodes(db):
    """A show with 1 season + 4 episodes. Two are watched."""
    from app.models.user import User
    from app.models.show import Show
    from app.models.season import Season
    from app.models.episode import Episode
    from app.models.episode_watched import EpisodeWatched

    db.add(User(id="bu1", username="bu1", email="bu1@test.com"))
    db.add(Show(id=400, name="Binge Show", status="Returning Series",
                tracking_count=0, number_of_seasons=1, number_of_episodes=4))
    db.flush()
    db.add(Season(id=4001, show_id=400, season_number=1, episode_count=4))
    eps = [
        Episode(id=40100 + i, show_id=400, season_number=1,
                episode_number=i, name=f"E{i}", runtime=30)
        for i in range(1, 5)
    ]
    db.add_all(eps)
    # Watch the first two episodes 5 days ago (within the 30-day pace window)
    five_days_ago = datetime.now(timezone.utc) - timedelta(days=5)
    db.add(EpisodeWatched(user_id="bu1", show_id=400, episode_id=40101,
                          season_number=1, episode_number=1,
                          watched_at=five_days_ago))
    db.add(EpisodeWatched(user_id="bu1", show_id=400, episode_id=40102,
                          season_number=1, episode_number=2,
                          watched_at=five_days_ago))
    db.commit()


@pytest.fixture
def seed_show_with_specials(db):
    """A show with a season-0 'special' that must be ignored."""
    from app.models.user import User
    from app.models.show import Show
    from app.models.episode import Episode

    db.add(User(id="bu2", username="bu2", email="bu2@test.com"))
    db.add(Show(id=500, name="Special Show", status="Ended", tracking_count=0))
    db.flush()
    db.add(Episode(id=50001, show_id=500, season_number=0, episode_number=1,
                   name="Special", runtime=20))
    db.add(Episode(id=50002, show_id=500, season_number=1, episode_number=1,
                   name="S1E1", runtime=45))
    db.commit()


# ── get_binge_plan ─────────────────────────────────────────────────────────


class TestGetBingePlan:
    def test_unknown_show_returns_error(self, db):
        from app.services.binge_planner_service import get_binge_plan
        result = get_binge_plan(db, "u", 99999)
        assert result == {"error": "Show not found"}

    def test_counts_and_remaining_runtime(self, db, seed_show_with_episodes):
        from app.services.binge_planner_service import get_binge_plan
        plan = get_binge_plan(db, "bu1", 400)
        assert plan["show_id"] == 400
        assert plan["show_name"] == "Binge Show"
        assert plan["total_episodes"] == 4
        assert plan["watched_episodes"] == 2
        assert plan["remaining_episodes"] == 2
        assert plan["remaining_minutes"] == 60  # 2 eps × 30 min

    def test_default_runtime_used_when_null(self, db):
        from app.models.user import User
        from app.models.show import Show
        from app.models.episode import Episode
        from app.services.binge_planner_service import get_binge_plan

        db.add(User(id="u3", username="u3", email="u3@t.com"))
        db.add(Show(id=601, name="X", status="Ended", tracking_count=0))
        db.flush()
        db.add(Episode(id=60101, show_id=601, season_number=1,
                       episode_number=1, runtime=None))
        db.commit()
        plan = get_binge_plan(db, "u3", 601)
        assert plan["remaining_episodes"] == 1
        # Falls back to _DEFAULT_EPISODE_RUNTIME == 40
        assert plan["remaining_minutes"] == 40

    def test_specials_excluded_from_counts(self, db, seed_show_with_specials):
        from app.services.binge_planner_service import get_binge_plan
        plan = get_binge_plan(db, "bu2", 500)
        # season 0 special must not be counted
        assert plan["total_episodes"] == 1
        assert plan["remaining_episodes"] == 1
        assert plan["remaining_minutes"] == 45

    def test_pace_calculated_when_recent_activity(self, db, seed_show_with_episodes):
        from app.services.binge_planner_service import get_binge_plan
        plan = get_binge_plan(db, "bu1", 400)
        # 2 eps in 30 days → (2/30)*7 ≈ 0.47 eps/week
        assert plan["eps_per_week_recent"] is not None
        assert plan["eps_per_week_recent"] > 0
        # 2 remaining ÷ 0.467 ≈ 4.3 weeks → "in 1 month" range
        assert plan["completion_estimate"] is not None

    def test_no_pace_when_no_recent_activity(self, db):
        from app.models.user import User
        from app.models.show import Show
        from app.models.episode import Episode
        from app.services.binge_planner_service import get_binge_plan

        db.add(User(id="u4", username="u4", email="u4@t.com"))
        db.add(Show(id=701, name="Untouched", status="Ended", tracking_count=0))
        db.flush()
        db.add(Episode(id=70101, show_id=701, season_number=1,
                       episode_number=1, runtime=30))
        db.commit()

        plan = get_binge_plan(db, "u4", 701)
        assert plan["eps_per_week_recent"] is None
        assert plan["completion_estimate"] is None

    def test_finish_by_goal_returned(self, db, seed_show_with_episodes):
        from app.models.finish_by_goal import FinishByGoal
        from app.services.binge_planner_service import get_binge_plan

        target = date.today() + timedelta(days=10)
        db.add(FinishByGoal(user_id="bu1", show_id=400, target_date=target))
        db.commit()

        plan = get_binge_plan(db, "bu1", 400)
        assert plan["finish_by_date"] == target.isoformat()
        # 2 remaining episodes / 10 days → 0.2 eps/day
        assert plan["eps_per_day_needed"] == 0.2
        # 60 remaining minutes / 10 days → 6 mins/day
        assert plan["mins_per_day_needed"] == 6

    def test_finish_by_goal_overdue(self, db, seed_show_with_episodes):
        from app.models.finish_by_goal import FinishByGoal
        from app.services.binge_planner_service import get_binge_plan

        target = date.today() - timedelta(days=5)
        db.add(FinishByGoal(user_id="bu1", show_id=400, target_date=target))
        db.commit()

        plan = get_binge_plan(db, "bu1", 400)
        assert plan["finish_by_date"] == target.isoformat()
        assert plan["eps_per_day_needed"] is None
        assert plan["mins_per_day_needed"] is None

    def test_no_finish_goal_returns_null_fields(self, db, seed_show_with_episodes):
        from app.services.binge_planner_service import get_binge_plan
        plan = get_binge_plan(db, "bu1", 400)
        assert plan["finish_by_date"] is None
        assert plan["eps_per_day_needed"] is None


# ── get_binge_plans_bulk ───────────────────────────────────────────────────


class TestGetBingePlansBulk:
    def test_empty_list_returns_empty_dict(self, db):
        from app.services.binge_planner_service import get_binge_plans_bulk
        assert get_binge_plans_bulk(db, "u", []) == {}

    def test_returns_per_show_results(self, db, seed_show_with_episodes):
        from app.services.binge_planner_service import get_binge_plans_bulk
        plans = get_binge_plans_bulk(db, "bu1", [400])
        assert "400" in plans
        assert plans["400"]["total_episodes"] == 4
        assert plans["400"]["watched_episodes"] == 2
        assert plans["400"]["remaining_episodes"] == 2
        assert plans["400"]["remaining_minutes"] == 60

    def test_missing_show_still_returned_with_zero_counts(self, db, seed_show_with_episodes):
        """Unknown show IDs in the list still produce a result row (empty counts)."""
        from app.services.binge_planner_service import get_binge_plans_bulk
        plans = get_binge_plans_bulk(db, "bu1", [400, 99999])
        assert "400" in plans
        assert "99999" in plans
        assert plans["99999"]["total_episodes"] == 0
        assert plans["99999"]["remaining_episodes"] == 0
        assert plans["99999"]["remaining_minutes"] == 0
        # Unknown show name falls back to empty string
        assert plans["99999"]["show_name"] == ""

    def test_finish_by_goal_in_bulk(self, db, seed_show_with_episodes):
        from app.models.finish_by_goal import FinishByGoal
        from app.services.binge_planner_service import get_binge_plans_bulk

        target = date.today() + timedelta(days=20)
        db.add(FinishByGoal(user_id="bu1", show_id=400, target_date=target))
        db.commit()

        plans = get_binge_plans_bulk(db, "bu1", [400])
        assert plans["400"]["finish_by_date"] == target.isoformat()
        # 2 remaining / 20 days = 0.1 eps/day
        assert plans["400"]["eps_per_day_needed"] == 0.1


# ── set_/clear_finish_by_goal ──────────────────────────────────────────────


class TestSetClearFinishByGoal:
    def test_set_creates_new_goal(self, db, seed_show_with_episodes):
        from app.models.finish_by_goal import FinishByGoal
        from app.services.binge_planner_service import set_finish_by_goal

        target = date.today() + timedelta(days=7)
        set_finish_by_goal(db, "bu1", 400, target)
        row = db.query(FinishByGoal).filter_by(user_id="bu1", show_id=400).first()
        assert row is not None
        assert row.target_date == target

    def test_set_updates_existing(self, db, seed_show_with_episodes):
        from app.models.finish_by_goal import FinishByGoal
        from app.services.binge_planner_service import set_finish_by_goal

        first = date.today() + timedelta(days=5)
        second = date.today() + timedelta(days=15)
        set_finish_by_goal(db, "bu1", 400, first)
        set_finish_by_goal(db, "bu1", 400, second)
        rows = db.query(FinishByGoal).filter_by(user_id="bu1", show_id=400).all()
        assert len(rows) == 1
        assert rows[0].target_date == second

    def test_clear_removes_goal(self, db, seed_show_with_episodes):
        from app.models.finish_by_goal import FinishByGoal
        from app.services.binge_planner_service import (
            set_finish_by_goal, clear_finish_by_goal,
        )

        set_finish_by_goal(db, "bu1", 400, date.today() + timedelta(days=10))
        clear_finish_by_goal(db, "bu1", 400)
        rows = db.query(FinishByGoal).filter_by(user_id="bu1", show_id=400).all()
        assert rows == []

    def test_clear_when_absent_is_noop(self, db, seed_show_with_episodes):
        from app.services.binge_planner_service import clear_finish_by_goal
        # Should not raise even when no goal exists
        clear_finish_by_goal(db, "bu1", 400)
