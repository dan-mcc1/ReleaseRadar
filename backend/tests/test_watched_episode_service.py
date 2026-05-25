"""
Direct-service tests for app.services.watched_episode_service.

Existing tests/test_episode_watched.py covers the endpoint layer. These tests
exercise the service functions directly to cover branches that are hard to
trigger through the routes (auto-complete, in-production gating, bulk
next-episode, syncing fallback, etc.).
"""

from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def seed_user(db):
    from app.models.user import User
    u = User(id="test-uid-1", username="alice", email="alice@test.com")
    db.add(u)
    db.commit()
    return u


@pytest.fixture
def seed_show_ended(db, seed_user):
    """A finished (in_production=False) show with one fully synced season."""
    from app.models.show import Show
    from app.models.season import Season
    from app.models.episode import Episode

    show = Show(
        id=2001,
        name="Finished Show",
        status="Ended",
        first_air_date=date(2010, 1, 1),
        number_of_seasons=1,
        number_of_episodes=2,
        in_production=False,
        tracking_count=1,
        vote_average=8.0,
    )
    db.add(show)
    db.flush()
    db.add(Season(id=10010, show_id=2001, season_number=1, episode_count=2))
    db.add_all([
        Episode(id=20101, show_id=2001, season_number=1, episode_number=1,
                name="E1", air_date=date(2010, 1, 1)),
        Episode(id=20102, show_id=2001, season_number=1, episode_number=2,
                name="E2", air_date=date(2010, 1, 8), episode_type="series_finale"),
    ])
    db.commit()
    return show


@pytest.fixture
def seed_show_in_production(db, seed_user):
    """An in-production show — used to verify the in_production gating."""
    from app.models.show import Show
    from app.models.season import Season
    from app.models.episode import Episode

    show = Show(
        id=2002,
        name="Airing Show",
        status="Returning Series",
        first_air_date=date(2020, 1, 1),
        number_of_seasons=1,
        number_of_episodes=3,
        in_production=True,
        tracking_count=1,
        vote_average=8.0,
    )
    db.add(show)
    db.flush()
    db.add(Season(id=10020, show_id=2002, season_number=1, episode_count=3))
    db.add_all([
        Episode(id=20201, show_id=2002, season_number=1, episode_number=1,
                name="E1", air_date=date(2020, 1, 1)),
        Episode(id=20202, show_id=2002, season_number=1, episode_number=2,
                name="E2", air_date=date(2020, 1, 8)),
        # Last stored episode is NOT tagged as a finale.
        Episode(id=20203, show_id=2002, season_number=1, episode_number=3,
                name="E3", air_date=date(2020, 1, 15), episode_type=None),
    ])
    db.commit()
    return show


# ── add_episode_watched ─────────────────────────────────────────────────────


class TestAddEpisodeWatched:
    def test_creates_row(self, db, seed_show_ended):
        from app.services.watched_episode_service import add_episode_watched
        from app.models.episode_watched import EpisodeWatched

        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            # episode already in DB, so get_or_create_episode shouldn't hit TMDb
            entry = add_episode_watched(db, "test-uid-1", 2001, 1, 1)

        assert entry is not None
        assert entry.season_number == 1
        assert entry.episode_number == 1
        assert db.query(EpisodeWatched).filter_by(
            user_id="test-uid-1", show_id=2001, season_number=1, episode_number=1
        ).first() is not None

    def test_idempotent_returns_existing(self, db, seed_show_ended):
        from app.services.watched_episode_service import add_episode_watched
        from app.models.episode_watched import EpisodeWatched

        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            first = add_episode_watched(db, "test-uid-1", 2001, 1, 1)
            second = add_episode_watched(db, "test-uid-1", 2001, 1, 1)

        assert first.id == second.id
        assert db.query(EpisodeWatched).filter_by(
            user_id="test-uid-1", show_id=2001
        ).count() == 1

    def test_rating_persisted(self, db, seed_show_ended):
        from app.services.watched_episode_service import add_episode_watched

        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            entry = add_episode_watched(db, "test-uid-1", 2001, 1, 1, rating=4.5)

        assert entry.rating == 4.5


# ── remove_episode_watched ──────────────────────────────────────────────────


class TestRemoveEpisodeWatched:
    def test_removes_existing(self, db, seed_show_ended):
        from app.services.watched_episode_service import (
            add_episode_watched, remove_episode_watched,
        )
        from app.models.episode_watched import EpisodeWatched

        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            add_episode_watched(db, "test-uid-1", 2001, 1, 1)
        result = remove_episode_watched(db, "test-uid-1", 2001, 1, 1)

        assert result["message"] == "Removed from watched episodes"
        assert db.query(EpisodeWatched).filter_by(
            user_id="test-uid-1", show_id=2001
        ).count() == 0

    def test_nonexistent_returns_not_found_message(self, db, seed_show_ended):
        from app.services.watched_episode_service import remove_episode_watched
        result = remove_episode_watched(db, "test-uid-1", 2001, 1, 99)
        assert "not found" in result["message"].lower()


# ── get_watched_episodes / get_watched_episodes_by_show ─────────────────────


class TestGetWatchedEpisodes:
    def test_empty(self, db, seed_user):
        from app.services.watched_episode_service import get_watched_episodes
        assert get_watched_episodes(db, "test-uid-1") == []

    def test_returns_all_for_user(self, db, seed_show_ended):
        from app.services.watched_episode_service import (
            add_episode_watched, get_watched_episodes,
        )
        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            add_episode_watched(db, "test-uid-1", 2001, 1, 1)
        out = get_watched_episodes(db, "test-uid-1")
        assert len(out) == 1
        assert out[0]["show_id"] == 2001
        assert out[0]["season_number"] == 1
        assert out[0]["episode_number"] == 1
        # watched_at is serialized via isoformat
        assert isinstance(out[0]["watched_at"], str)

    def test_by_show_filters(self, db, seed_show_ended):
        from app.services.watched_episode_service import (
            add_episode_watched, get_watched_episodes_by_show,
        )
        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            add_episode_watched(db, "test-uid-1", 2001, 1, 1, rating=5.0)
        out = get_watched_episodes_by_show(db, "test-uid-1", 2001)
        assert len(out) == 1
        assert out[0]["rating"] == 5.0
        # Different user → empty
        assert get_watched_episodes_by_show(db, "different-uid", 2001) == []


# ── add_season_watched / remove_season_watched ──────────────────────────────


class TestSeasonWatched:
    def test_add_season_marks_all_existing_episodes(self, db, seed_show_ended):
        from app.services.watched_episode_service import add_season_watched
        from app.models.episode_watched import EpisodeWatched

        with patch("app.services.watched_episode_service.sync_season_episodes"):
            add_season_watched(db, "test-uid-1", 2001, 1)
        # seed_show_ended has 2 episodes
        rows = db.query(EpisodeWatched).filter_by(
            user_id="test-uid-1", show_id=2001, season_number=1
        ).all()
        assert len(rows) == 2

    def test_add_season_skips_already_watched(self, db, seed_show_ended):
        """Season add is idempotent: existing watched rows are not duplicated."""
        from app.services.watched_episode_service import (
            add_episode_watched, add_season_watched,
        )
        from app.models.episode_watched import EpisodeWatched

        with patch("app.services.watched_episode_service.ensure_show_in_db"), \
             patch("app.services.watched_episode_service.sync_season_episodes"):
            add_episode_watched(db, "test-uid-1", 2001, 1, 1)
            add_season_watched(db, "test-uid-1", 2001, 1)

        rows = db.query(EpisodeWatched).filter_by(
            user_id="test-uid-1", show_id=2001, season_number=1
        ).all()
        assert len(rows) == 2  # not 3

    def test_remove_season_clears_all(self, db, seed_show_ended):
        from app.services.watched_episode_service import (
            add_season_watched, remove_season_watched,
        )
        from app.models.episode_watched import EpisodeWatched

        with patch("app.services.watched_episode_service.sync_season_episodes"):
            add_season_watched(db, "test-uid-1", 2001, 1)
        result = remove_season_watched(db, "test-uid-1", 2001, 1)
        assert "removed" in result["message"].lower()
        assert db.query(EpisodeWatched).filter_by(
            user_id="test-uid-1", show_id=2001, season_number=1
        ).count() == 0


# ── get_next_unwatched_episode ──────────────────────────────────────────────


class TestNextUnwatchedEpisode:
    def test_returns_first_when_none_watched(self, db, seed_show_ended):
        from app.services.watched_episode_service import get_next_unwatched_episode
        out = get_next_unwatched_episode(db, "test-uid-1", 2001)
        assert out["finished"] is False
        assert out["season_number"] == 1
        assert out["episode_number"] == 1

    def test_skips_watched_episodes(self, db, seed_show_ended):
        from app.services.watched_episode_service import (
            add_episode_watched, get_next_unwatched_episode,
        )
        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            add_episode_watched(db, "test-uid-1", 2001, 1, 1)
        out = get_next_unwatched_episode(db, "test-uid-1", 2001)
        assert out["episode_number"] == 2

    def test_returns_finished_when_all_watched(self, db, seed_show_ended):
        from app.services.watched_episode_service import (
            add_season_watched, get_next_unwatched_episode,
        )
        with patch("app.services.watched_episode_service.sync_season_episodes"):
            add_season_watched(db, "test-uid-1", 2001, 1)
        out = get_next_unwatched_episode(db, "test-uid-1", 2001)
        assert out["finished"] is True

    def test_syncs_season_1_when_no_episodes(self, db, seed_user):
        """If a show has no episodes at all, the service should call sync_season_episodes(season=1)."""
        from app.models.show import Show
        from app.services import watched_episode_service

        show = Show(
            id=2050, name="Empty Show", status="Returning Series",
            first_air_date=date(2024, 1, 1), number_of_seasons=1,
            number_of_episodes=1, in_production=True, tracking_count=1,
            vote_average=0.0,
        )
        db.add(show)
        db.commit()

        with patch.object(watched_episode_service, "sync_season_episodes") as mock_sync:
            out = watched_episode_service.get_next_unwatched_episode(db, "test-uid-1", 2050)

        # sync_season_episodes called with season=1, then still no episodes → finished
        mock_sync.assert_called()
        # First call args: (db, show_id, 1)
        first_call_args = mock_sync.call_args_list[0]
        assert first_call_args.args[1] == 2050
        assert first_call_args.args[2] == 1
        assert out["finished"] is True

    def test_syncs_next_season_when_known_seasons_exhausted(self, db, seed_user):
        """If user has watched everything synced but show has more seasons, sync_season_episodes is called for the next season."""
        from app.models.show import Show
        from app.models.season import Season
        from app.models.episode import Episode
        from app.services import watched_episode_service
        from app.services.watched_episode_service import add_episode_watched

        show = Show(
            id=2060, name="Multi Season", status="Returning Series",
            first_air_date=date(2020, 1, 1), number_of_seasons=2,
            number_of_episodes=2, in_production=True, tracking_count=1,
            vote_average=0.0,
        )
        db.add(show)
        db.flush()
        db.add(Season(id=10060, show_id=2060, season_number=1, episode_count=1))
        db.add(Episode(id=20601, show_id=2060, season_number=1, episode_number=1,
                       name="S1E1", air_date=date(2020, 1, 1)))
        db.commit()

        # Watch the only episode we know about
        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            add_episode_watched(db, "test-uid-1", 2060, 1, 1)

        # When asked for next, sync_season_episodes(season=2) should be called.
        def fake_sync(db_arg, show_id, season_number):
            # Pretend the sync added one episode for season 2
            db_arg.add(Episode(
                id=20602, show_id=show_id, season_number=season_number,
                episode_number=1, name="S2E1", air_date=date(2021, 1, 1),
            ))
            db_arg.commit()

        with patch.object(watched_episode_service, "sync_season_episodes", side_effect=fake_sync):
            out = watched_episode_service.get_next_unwatched_episode(db, "test-uid-1", 2060)

        assert out["finished"] is False
        assert out["season_number"] == 2
        assert out["episode_number"] == 1


# ── get_next_unwatched_episodes_bulk ────────────────────────────────────────


class TestBulkNextUnwatched:
    def test_empty_input_returns_empty(self, db, seed_user):
        from app.services.watched_episode_service import get_next_unwatched_episodes_bulk
        assert get_next_unwatched_episodes_bulk(db, "test-uid-1", []) == {}

    def test_bulk_returns_per_show(self, db, seed_show_ended):
        from app.services.watched_episode_service import (
            add_episode_watched, get_next_unwatched_episodes_bulk,
        )

        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            add_episode_watched(db, "test-uid-1", 2001, 1, 1)
        out = get_next_unwatched_episodes_bulk(db, "test-uid-1", [2001])
        assert 2001 in out
        assert out[2001]["finished"] is False
        assert out[2001]["episode_number"] == 2

    def test_bulk_finished_for_fully_watched(self, db, seed_show_ended):
        from app.services.watched_episode_service import (
            add_season_watched, get_next_unwatched_episodes_bulk,
        )

        with patch("app.services.watched_episode_service.sync_season_episodes"):
            add_season_watched(db, "test-uid-1", 2001, 1)
        out = get_next_unwatched_episodes_bulk(db, "test-uid-1", [2001])
        assert out[2001]["finished"] is True

    def test_bulk_falls_back_for_show_with_no_episodes(self, db, seed_user):
        """If a show has no synced episodes, bulk falls back to per-show logic."""
        from app.models.show import Show
        from app.services import watched_episode_service

        show = Show(
            id=2070, name="Empty Bulk", status="Returning Series",
            first_air_date=date(2024, 1, 1), number_of_seasons=1,
            number_of_episodes=1, in_production=True, tracking_count=1,
            vote_average=0.0,
        )
        db.add(show)
        db.commit()

        with patch.object(watched_episode_service, "sync_season_episodes"):
            out = watched_episode_service.get_next_unwatched_episodes_bulk(
                db, "test-uid-1", [2070]
            )
        assert 2070 in out
        # Either finished or has an episode payload — no exception is the main check
        assert "finished" in out[2070]


# ── maybe_auto_complete_show ────────────────────────────────────────────────


class TestMaybeAutoCompleteShow:
    def test_returns_false_when_show_not_tracked(self, db, seed_show_ended):
        from app.services.watched_episode_service import maybe_auto_complete_show
        # No Watchlist / CurrentlyWatching row for this user/show
        assert maybe_auto_complete_show(db, "test-uid-1", 2001) is False

    def test_returns_false_when_some_episodes_unwatched(self, db, seed_show_ended):
        from app.models.watchlist import Watchlist
        from app.services.watched_episode_service import (
            add_episode_watched, maybe_auto_complete_show,
        )

        db.add(Watchlist(
            user_id="test-uid-1", content_type="tv", content_id=2001,
            added_at=datetime.now(timezone.utc), sort_key=1000,
        ))
        db.commit()

        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            add_episode_watched(db, "test-uid-1", 2001, 1, 1)
        # Only ep1 watched, ep2 unwatched
        assert maybe_auto_complete_show(db, "test-uid-1", 2001) is False

    def test_auto_completes_ended_show_when_all_watched(self, db, seed_show_ended):
        from app.models.watchlist import Watchlist
        from app.models.watched import Watched
        from app.services.watched_episode_service import (
            add_season_watched, maybe_auto_complete_show,
        )

        db.add(Watchlist(
            user_id="test-uid-1", content_type="tv", content_id=2001,
            added_at=datetime.now(timezone.utc), sort_key=1000,
        ))
        db.commit()

        with patch("app.services.watched_episode_service.sync_season_episodes"):
            add_season_watched(db, "test-uid-1", 2001, 1)
        # add_season_watched itself calls maybe_auto_complete_show — show should be in Watched
        db.expire_all()
        assert db.query(Watched).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=2001
        ).first() is not None
        # And gone from watchlist
        assert db.query(Watchlist).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=2001
        ).first() is None

    def test_in_production_no_finale_tag_not_completed_without_full_season(
        self, db, seed_show_in_production
    ):
        """Show is in production, no finale tags, season has 3 planned but only some watched."""
        from app.models.watchlist import Watchlist
        from app.models.watched import Watched
        from app.services.watched_episode_service import (
            add_episode_watched, maybe_auto_complete_show,
        )

        db.add(Watchlist(
            user_id="test-uid-1", content_type="tv", content_id=2002,
            added_at=datetime.now(timezone.utc), sort_key=1000,
        ))
        db.commit()

        # Watch only the first 2 of 3 episodes
        with patch("app.services.watched_episode_service.ensure_show_in_db"):
            add_episode_watched(db, "test-uid-1", 2002, 1, 1)
            add_episode_watched(db, "test-uid-1", 2002, 1, 2)

        # Last stored ep not watched → short-circuit returns False
        assert maybe_auto_complete_show(db, "test-uid-1", 2002) is False
        assert db.query(Watched).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=2002
        ).first() is None

    def test_in_production_auto_completes_when_full_season_count_watched(
        self, db, seed_show_in_production
    ):
        """In-production show with no finale tag — fallback to comparing watched count vs season.episode_count."""
        from app.models.watchlist import Watchlist
        from app.models.watched import Watched
        from app.services.watched_episode_service import add_episode_watched

        db.add(Watchlist(
            user_id="test-uid-1", content_type="tv", content_id=2002,
            added_at=datetime.now(timezone.utc), sort_key=1000,
        ))
        db.commit()

        # Patch sync_season_episodes so get_next_unwatched_episode doesn't try
        # to sync the (already-complete) season 1 from TMDb.
        with patch("app.services.watched_episode_service.ensure_show_in_db"), \
             patch("app.services.watched_episode_service.sync_season_episodes"):
            add_episode_watched(db, "test-uid-1", 2002, 1, 1)
            add_episode_watched(db, "test-uid-1", 2002, 1, 2)
            # The 3rd add triggers maybe_auto_complete_show internally; with
            # all 3 of season 1's planned episode_count watched, the fallback
            # path completes the show.
            add_episode_watched(db, "test-uid-1", 2002, 1, 3)

        db.expire_all()
        assert db.query(Watched).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=2002
        ).first() is not None
