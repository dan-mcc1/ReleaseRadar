"""
Tests for app.services.episode_service.

Covers:
- _compute_episode_type derivations
- ensure_show_in_db (existing, TMDb success, TMDb empty/failure)
- sync_season_episodes / sync_show_episodes / maybe_sync_show_episodes
- get_or_create_episode (existing, create, TMDb failure)
- _refresh_show_metadata + refresh_episodes_for_show (new seasons added,
  existing episode update, no-op when nothing needs refresh)
- refresh_episodes_for_active_shows (skips finished shows, runs only on in-production)
- check_and_reactivate_watched_shows (reactivates, no-op when caught up,
  skips users with notifications off)
- prune_stale_cache
"""

from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest


# ── _compute_episode_type ─────────────────────────────────────────────────


class TestComputeEpisodeType:
    def test_show_premiere_for_s1e1(self):
        from app.services.episode_service import _compute_episode_type
        assert _compute_episode_type(1, 1, None, None) == "show_premiere"

    def test_season_premiere_for_other_seasons(self):
        from app.services.episode_service import _compute_episode_type
        assert _compute_episode_type(1, 3, None, None) == "season_premiere"

    def test_finale_for_in_production_is_season_finale(self):
        from app.services.episode_service import _compute_episode_type
        assert _compute_episode_type(10, 2, "finale", True) == "season_finale"

    def test_finale_when_not_in_production_is_series_finale(self):
        from app.services.episode_service import _compute_episode_type
        assert _compute_episode_type(10, 5, "finale", False) == "series_finale"

    def test_mid_season_type(self):
        from app.services.episode_service import _compute_episode_type
        assert _compute_episode_type(8, 1, "mid_season", True) == "mid_season"

    def test_returns_none_for_standard_episode(self):
        from app.services.episode_service import _compute_episode_type
        assert _compute_episode_type(5, 1, "standard", True) is None


# ── ensure_show_in_db ─────────────────────────────────────────────────────


class TestEnsureShowInDb:
    def test_existing_show_returns_true(self, db, seed_show):
        from app.services.episode_service import ensure_show_in_db
        assert ensure_show_in_db(db, 1396) is True

    def test_missing_show_fetched_from_tmdb(self, db):
        from app.services.episode_service import ensure_show_in_db
        from app.models.show import Show
        data = {"id": 9999, "name": "New Show", "in_production": True,
                "number_of_seasons": 1, "number_of_episodes": 10}
        with patch("app.services.episode_service.get", return_value=data):
            assert ensure_show_in_db(db, 9999) is True
        assert db.query(Show).filter_by(id=9999).first() is not None

    def test_tmdb_returns_empty_returns_false(self, db):
        from app.services.episode_service import ensure_show_in_db
        with patch("app.services.episode_service.get", return_value=None):
            assert ensure_show_in_db(db, 9999) is False

    def test_tmdb_returns_no_name_returns_false(self, db):
        from app.services.episode_service import ensure_show_in_db
        with patch("app.services.episode_service.get", return_value={"id": 1}):
            assert ensure_show_in_db(db, 9999) is False

    def test_tmdb_exception_returns_false(self, db):
        from app.services.episode_service import ensure_show_in_db
        with patch("app.services.episode_service.get", side_effect=Exception("boom")):
            assert ensure_show_in_db(db, 9999) is False


# ── sync_season_episodes ─────────────────────────────────────────────────


class TestSyncSeasonEpisodes:
    def test_inserts_new_episodes(self, db, seed_show):
        from app.services.episode_service import sync_season_episodes
        from app.models.episode import Episode
        data = {
            "episodes": [
                {"id": 99001, "episode_number": 3, "name": "E3",
                 "air_date": date(2008, 2, 3)},
                {"id": 99002, "episode_number": 4, "name": "E4",
                 "air_date": date(2008, 2, 10)},
            ]
        }
        with patch("app.services.episode_service.get", return_value=data):
            sync_season_episodes(db, 1396, 1)
        eps = db.query(Episode).filter_by(show_id=1396).all()
        ep_nums = {e.episode_number for e in eps}
        assert {3, 4}.issubset(ep_nums)

    def test_skips_existing_episodes(self, db, seed_show):
        from app.services.episode_service import sync_season_episodes
        from app.models.episode import Episode
        # Pretend TMDb returns the existing ep1 (id 62085)
        data = {"episodes": [{"id": 62085, "episode_number": 1, "name": "Pilot-updated"}]}
        with patch("app.services.episode_service.get", return_value=data):
            sync_season_episodes(db, 1396, 1)
        ep1 = db.query(Episode).filter_by(id=62085).first()
        # Existing episode should NOT be overwritten by sync_season_episodes
        assert ep1.name == "Pilot"

    def test_skips_episodes_with_no_id(self, db, seed_show):
        from app.services.episode_service import sync_season_episodes
        from app.models.episode import Episode
        data = {"episodes": [{"episode_number": 99, "name": "noid"}]}
        with patch("app.services.episode_service.get", return_value=data):
            sync_season_episodes(db, 1396, 1)
        # No new ep added
        assert db.query(Episode).filter_by(episode_number=99).first() is None

    def test_show_missing_and_tmdb_fail_is_noop(self, db):
        from app.services.episode_service import sync_season_episodes
        with patch("app.services.episode_service.get", return_value=None):
            # ensure_show_in_db returns False → early return, no exception
            sync_season_episodes(db, 12345, 1)

    def test_tmdb_exception_handled(self, db, seed_show):
        from app.services.episode_service import sync_season_episodes
        # First call (ensure_show_in_db check) sees the show — no TMDb needed
        # Second call (season fetch) throws
        with patch("app.services.episode_service.get", side_effect=Exception("api down")):
            sync_season_episodes(db, 1396, 1)  # Should not raise


# ── sync_show_episodes + maybe_sync_show_episodes ────────────────────────


class TestSyncShowEpisodes:
    def test_uses_season_table_when_populated(self, db, seed_show):
        from app.services.episode_service import sync_show_episodes
        from app.models.episode import Episode

        # seed_show has 1 season row (number 1). TMDb returns one new episode.
        data = {"episodes": [{"id": 70001, "episode_number": 5, "name": "newep"}]}
        with patch("app.services.episode_service.get", return_value=data):
            sync_show_episodes(db, 1396)
        assert db.query(Episode).filter_by(id=70001).first() is not None

    def test_falls_back_to_number_of_seasons(self, db):
        from app.models.show import Show
        from app.services.episode_service import sync_show_episodes
        from app.models.episode import Episode

        s = Show(id=500, name="NoSeasons", number_of_seasons=2,
                 number_of_episodes=4, tracking_count=0)
        db.add(s)
        db.commit()
        data = {"episodes": [{"id": 70100, "episode_number": 1, "name": "x"}]}
        with patch("app.services.episode_service.get", return_value=data):
            sync_show_episodes(db, 500)
        assert db.query(Episode).filter_by(show_id=500).count() >= 1

    def test_show_missing_tmdb_fail_is_noop(self, db):
        from app.services.episode_service import sync_show_episodes
        with patch("app.services.episode_service.get", return_value=None):
            sync_show_episodes(db, 9999)  # Returns silently

    def test_show_with_zero_seasons_is_noop(self, db):
        from app.models.show import Show
        from app.services.episode_service import sync_show_episodes
        from app.models.episode import Episode

        s = Show(id=501, name="Empty", number_of_seasons=0, tracking_count=0)
        db.add(s)
        db.commit()
        # No HTTP needed — no seasons to fetch
        sync_show_episodes(db, 501)
        assert db.query(Episode).filter_by(show_id=501).count() == 0

    def test_handles_failed_season_fetch(self, db, seed_show):
        from app.services.episode_service import sync_show_episodes
        # Exception raised inside thread executor; should be swallowed
        with patch("app.services.episode_service.get", side_effect=Exception("nope")):
            sync_show_episodes(db, 1396)  # Should not raise


class TestMaybeSyncShowEpisodes:
    def test_no_op_when_episodes_exist(self, db, seed_show):
        from app.services.episode_service import maybe_sync_show_episodes
        mock_get = MagicMock()
        with patch("app.services.episode_service.get", mock_get):
            maybe_sync_show_episodes(db, 1396)
        mock_get.assert_not_called()

    def test_syncs_when_no_episodes(self, db):
        from app.models.show import Show
        from app.services.episode_service import maybe_sync_show_episodes
        s = Show(id=600, name="NoEps", number_of_seasons=1, tracking_count=0)
        db.add(s)
        db.commit()
        data = {"episodes": [{"id": 80001, "episode_number": 1, "name": "ep"}]}
        with patch("app.services.episode_service.get", return_value=data):
            maybe_sync_show_episodes(db, 600)
        from app.models.episode import Episode
        assert db.query(Episode).filter_by(show_id=600).count() == 1


# ── get_or_create_episode ────────────────────────────────────────────────


class TestGetOrCreateEpisode:
    def test_returns_existing_episode(self, db, seed_show):
        from app.services.episode_service import get_or_create_episode
        ep = get_or_create_episode(db, 1396, 1, 1)
        assert ep is not None
        assert ep.id == 62085

    def test_creates_episode_from_tmdb(self, db, seed_show):
        from app.services.episode_service import get_or_create_episode
        data = {"id": 90001, "name": "From TMDb", "episode_number": 99,
                "air_date": date(2008, 4, 1)}
        with patch("app.services.episode_service.get", return_value=data):
            ep = get_or_create_episode(db, 1396, 1, 99)
        assert ep is not None
        assert ep.id == 90001
        assert ep.name == "From TMDb"

    def test_tmdb_returns_no_id_returns_none(self, db, seed_show):
        from app.services.episode_service import get_or_create_episode
        with patch("app.services.episode_service.get", return_value={"name": "x"}):
            ep = get_or_create_episode(db, 1396, 2, 1)
        assert ep is None

    def test_tmdb_exception_returns_none(self, db, seed_show):
        from app.services.episode_service import get_or_create_episode
        with patch("app.services.episode_service.get", side_effect=Exception("err")):
            ep = get_or_create_episode(db, 1396, 2, 5)
        assert ep is None


# ── _refresh_show_metadata + refresh_episodes_for_show ───────────────────


class TestRefreshShowMetadata:
    def test_updates_number_of_seasons_and_adds_season_row(self, db, seed_show):
        from app.services.episode_service import _refresh_show_metadata
        from app.models.show import Show
        from app.models.season import Season

        show = db.query(Show).filter_by(id=1396).first()
        data = {
            "number_of_seasons": 6,
            "in_production": True,
            "seasons": [
                # existing s1 → skip
                {"id": 3572, "season_number": 1, "name": "S1",
                 "episode_count": 7},
                # new s6 → insert
                {"id": 9999, "season_number": 6, "name": "S6",
                 "episode_count": 8, "air_date": date(2026, 1, 1)},
                # s0 (specials) → skip
                {"id": 1111, "season_number": 0, "name": "Specials"},
                # missing id → skip
                {"season_number": 7, "name": "S7"},
            ],
        }
        with patch("app.services.episode_service.get", return_value=data):
            _refresh_show_metadata(db, show)
        db.expire_all()
        s = db.query(Show).filter_by(id=1396).first()
        assert s.number_of_seasons == 6
        assert s.in_production is True
        # New season row added
        assert db.query(Season).filter_by(id=9999).first() is not None
        # Specials and missing-id skipped
        assert db.query(Season).filter_by(id=1111).first() is None

    def test_no_changes_when_metadata_matches(self, db, seed_show):
        from app.services.episode_service import _refresh_show_metadata
        from app.models.show import Show
        show = db.query(Show).filter_by(id=1396).first()
        # match existing show
        data = {"number_of_seasons": show.number_of_seasons, "seasons": []}
        with patch("app.services.episode_service.get", return_value=data):
            _refresh_show_metadata(db, show)

    def test_tmdb_failure_is_noop(self, db, seed_show):
        from app.services.episode_service import _refresh_show_metadata
        from app.models.show import Show
        show = db.query(Show).filter_by(id=1396).first()
        with patch("app.services.episode_service.get", side_effect=Exception("nope")):
            _refresh_show_metadata(db, show)  # Doesn't raise

    def test_empty_data_is_noop(self, db, seed_show):
        from app.services.episode_service import _refresh_show_metadata
        from app.models.show import Show
        show = db.query(Show).filter_by(id=1396).first()
        with patch("app.services.episode_service.get", return_value=None):
            _refresh_show_metadata(db, show)


class TestRefreshEpisodesForShow:
    def test_missing_show_is_noop(self, db):
        from app.services.episode_service import refresh_episodes_for_show
        refresh_episodes_for_show(db, 99999)

    def test_show_with_no_seasons_returns_early(self, db):
        from app.models.show import Show
        from app.services.episode_service import refresh_episodes_for_show
        s = Show(id=700, name="NoSeasons", number_of_seasons=0, tracking_count=0)
        db.add(s)
        db.commit()
        refresh_episodes_for_show(db, 700)

    def test_updates_existing_episode_metadata(self, db):
        """Episode with missing name triggers refresh and gets updated."""
        from app.models.show import Show
        from app.models.season import Season
        from app.models.episode import Episode
        from app.services.episode_service import refresh_episodes_for_show

        s = Show(id=800, name="X", number_of_seasons=1, in_production=True,
                 tracking_count=0)
        db.add(s)
        db.flush()
        db.add(Season(id=8000, show_id=800, season_number=1, episode_count=2))
        db.add(Episode(id=80001, show_id=800, season_number=1, episode_number=1,
                       name=None, air_date=None))
        db.commit()

        data = {
            "episodes": [
                {"id": 80001, "episode_number": 1, "name": "Updated",
                 "air_date": date(2024, 3, 1), "overview": "ovr", "runtime": 30,
                 "still_path": "/s.jpg", "vote_average": 8.0},
                {"id": 80002, "episode_number": 2, "name": "New Ep",
                 "air_date": date(2024, 3, 8)},
            ]
        }
        with patch("app.services.episode_service.get", return_value=data):
            refresh_episodes_for_show(db, 800)

        db.expire_all()
        ep1 = db.query(Episode).filter_by(id=80001).first()
        assert ep1.name == "Updated"
        ep2 = db.query(Episode).filter_by(id=80002).first()
        assert ep2 is not None

    def test_no_active_seasons_returns_early(self, db):
        """All episodes have name+still+date in the past → nothing to refresh."""
        from app.models.show import Show
        from app.models.season import Season
        from app.models.episode import Episode
        from app.services.episode_service import refresh_episodes_for_show

        past = date.today() - timedelta(days=365)
        s = Show(id=801, name="Done", number_of_seasons=1, tracking_count=0)
        db.add(s)
        db.flush()
        db.add(Season(id=8010, show_id=801, season_number=1, episode_count=1))
        db.add(Episode(id=80100, show_id=801, season_number=1, episode_number=1,
                       name="Already filled", still_path="/x.jpg", air_date=past))
        db.commit()

        # The "always include latest season" rule re-adds season 1 to refresh.
        # Confirm refresh proceeds but make TMDb a no-op so nothing inserted.
        # Returns season w/ no new episode list ⇒ no change.
        data = {"episodes": [
            {"id": 80100, "episode_number": 1, "name": "Already filled",
             "air_date": past, "still_path": "/x.jpg",
             "overview": None, "runtime": None, "vote_average": None,
             "episode_type": None},
        ]}
        with patch("app.services.episode_service.get", return_value=data):
            refresh_episodes_for_show(db, 801)

    def test_failed_fetch_handled(self, db):
        from app.models.show import Show
        from app.models.season import Season
        from app.models.episode import Episode
        from app.services.episode_service import refresh_episodes_for_show

        s = Show(id=802, name="X", number_of_seasons=1, tracking_count=0)
        db.add(s)
        db.flush()
        db.add(Season(id=8020, show_id=802, season_number=1, episode_count=1))
        db.add(Episode(id=80200, show_id=802, season_number=1, episode_number=1,
                       name=None, air_date=None))
        db.commit()

        with patch("app.services.episode_service.get", side_effect=Exception("err")):
            refresh_episodes_for_show(db, 802)  # Should not raise


# ── refresh_episodes_for_active_shows ────────────────────────────────────


class TestRefreshActiveShows:
    def test_no_tracked_shows_is_noop(self, db, seed_users):
        from app.services.episode_service import refresh_episodes_for_active_shows
        # No watchlist/cw/watched entries → early return
        refresh_episodes_for_active_shows(db)

    def test_skips_finished_shows(self, db, seed_users, seed_show):
        """Show.in_production=False (not set) → no work scheduled."""
        from app.models.watchlist import Watchlist
        from app.services.episode_service import refresh_episodes_for_active_shows

        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=1396,
                         added_at=datetime.now(timezone.utc)))
        db.commit()
        # seed_show has no in_production=True → filtered out
        # Patch _refresh_one_show to confirm it isn't called
        with patch("app.services.episode_service._refresh_one_show") as mock_one:
            refresh_episodes_for_active_shows(db)
        mock_one.assert_not_called()


# ── check_and_reactivate_watched_shows ───────────────────────────────────


class TestReactivateWatchedShows:
    def test_no_watched_rows_is_noop(self, db, seed_users):
        from app.services.episode_service import check_and_reactivate_watched_shows
        check_and_reactivate_watched_shows(db)

    def test_reactivates_show_with_new_unwatched_episodes(
        self, db, seed_users, seed_show
    ):
        """User watched all S1 eps; new S2E1 is now in DB → move back to Watchlist."""
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist
        from app.models.episode import Episode
        from app.models.episode_watched import EpisodeWatched
        from app.models.show import Show
        from app.services.episode_service import check_and_reactivate_watched_shows

        # Mark show in production
        show = db.query(Show).filter_by(id=1396).first()
        show.in_production = True
        # Enable email notifications on user
        from app.models.user import User
        user = db.query(User).filter_by(id="test-uid-1").first()
        user.email_notifications = True

        # User has watched the 2 existing S1 episodes
        for ep_num in (1, 2):
            db.add(EpisodeWatched(
                user_id="test-uid-1", show_id=1396, season_number=1,
                episode_number=ep_num, watched_at=datetime.now(timezone.utc),
            ))
        # User has show on Watched list
        db.add(Watched(user_id="test-uid-1", content_type="tv", content_id=1396))
        # Newly-added S2E1
        past = date.today() - timedelta(days=1)
        db.add(Episode(id=99500, show_id=1396, season_number=2, episode_number=1,
                       name="S2E1", air_date=past))
        db.commit()

        with patch("app.services.episode_service.send_new_season_available_email") as mock_email:
            check_and_reactivate_watched_shows(db)

        db.expire_all()
        # Show moved off Watched onto Watchlist
        assert db.query(Watched).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=1396
        ).first() is None
        assert db.query(Watchlist).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=1396
        ).first() is not None
        # Email sent because notifications + email set
        assert mock_email.called

    def test_no_reactivation_when_no_new_episodes(
        self, db, seed_users, seed_show
    ):
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist
        from app.models.show import Show
        from app.services.episode_service import check_and_reactivate_watched_shows

        # Show in production with NO new episodes beyond what user watched
        show = db.query(Show).filter_by(id=1396).first()
        show.in_production = True

        db.add(Watched(user_id="test-uid-1", content_type="tv", content_id=1396))
        # Note: no episode_watched rows → max_watched_season=0 → both existing
        # eps look like "new" since seasons > 0. Use a higher max instead:
        from app.models.episode_watched import EpisodeWatched
        for ep_num in (1, 2):
            db.add(EpisodeWatched(
                user_id="test-uid-1", show_id=1396, season_number=1,
                episode_number=ep_num, watched_at=datetime.now(timezone.utc),
            ))
        db.commit()

        with patch("app.services.episode_service.send_new_season_available_email") as mock_email:
            check_and_reactivate_watched_shows(db)

        db.expire_all()
        # Still on Watched
        assert db.query(Watched).filter_by(content_id=1396).first() is not None
        assert db.query(Watchlist).filter_by(content_id=1396).first() is None
        mock_email.assert_not_called()

    def test_skips_email_when_user_disabled_notifications(
        self, db, seed_users, seed_show
    ):
        from app.models.watched import Watched
        from app.models.episode import Episode
        from app.models.episode_watched import EpisodeWatched
        from app.models.show import Show
        from app.models.user import User
        from app.services.episode_service import check_and_reactivate_watched_shows

        show = db.query(Show).filter_by(id=1396).first()
        show.in_production = True
        user = db.query(User).filter_by(id="test-uid-1").first()
        user.email_notifications = False

        for ep_num in (1, 2):
            db.add(EpisodeWatched(
                user_id="test-uid-1", show_id=1396, season_number=1,
                episode_number=ep_num, watched_at=datetime.now(timezone.utc),
            ))
        db.add(Watched(user_id="test-uid-1", content_type="tv", content_id=1396))
        past = date.today() - timedelta(days=1)
        db.add(Episode(id=99501, show_id=1396, season_number=2, episode_number=1,
                       name="x", air_date=past))
        db.commit()

        with patch("app.services.episode_service.send_new_season_available_email") as mock_email:
            check_and_reactivate_watched_shows(db)

        mock_email.assert_not_called()

    def test_email_exception_does_not_break_reactivation(
        self, db, seed_users, seed_show
    ):
        from app.models.watched import Watched
        from app.models.episode import Episode
        from app.models.episode_watched import EpisodeWatched
        from app.models.show import Show
        from app.models.user import User
        from app.services.episode_service import check_and_reactivate_watched_shows

        show = db.query(Show).filter_by(id=1396).first()
        show.in_production = True
        user = db.query(User).filter_by(id="test-uid-1").first()
        user.email_notifications = True

        for ep_num in (1, 2):
            db.add(EpisodeWatched(
                user_id="test-uid-1", show_id=1396, season_number=1,
                episode_number=ep_num, watched_at=datetime.now(timezone.utc),
            ))
        db.add(Watched(user_id="test-uid-1", content_type="tv", content_id=1396))
        past = date.today() - timedelta(days=1)
        db.add(Episode(id=99502, show_id=1396, season_number=2, episode_number=1,
                       name="x", air_date=past))
        db.commit()

        with patch(
            "app.services.episode_service.send_new_season_available_email",
            side_effect=Exception("smtp down"),
        ):
            # Should not raise
            check_and_reactivate_watched_shows(db)


# ── prune_stale_cache ────────────────────────────────────────────────────


class TestPruneStaleCache:
    def test_deletes_old_zero_tracker_shows(self, db):
        from app.models.show import Show
        from app.services.episode_service import prune_stale_cache

        old = datetime.now(timezone.utc) - timedelta(days=100)
        recent = datetime.now(timezone.utc) - timedelta(days=10)

        # Stale, no trackers → delete
        db.add(Show(id=900, name="OldStale", tracking_count=0, updated_at=old))
        # Recent → keep
        db.add(Show(id=901, name="Recent", tracking_count=0, updated_at=recent))
        # Has trackers → keep
        db.add(Show(id=902, name="Tracked", tracking_count=3, updated_at=old))
        db.commit()

        prune_stale_cache(db)
        db.expire_all()
        ids = {s.id for s in db.query(Show).all()}
        assert 900 not in ids
        assert 901 in ids
        assert 902 in ids

    def test_deletes_old_zero_tracker_movies(self, db):
        from app.models.movie import Movie
        from app.services.episode_service import prune_stale_cache

        old = datetime.now(timezone.utc) - timedelta(days=100)
        db.add(Movie(id=900, title="StaleM", tracking_count=0, updated_at=old))
        db.add(Movie(id=901, title="ActiveM", tracking_count=2, updated_at=old))
        db.commit()

        prune_stale_cache(db)
        db.expire_all()
        ids = {m.id for m in db.query(Movie).all()}
        assert 900 not in ids
        assert 901 in ids

    def test_noop_when_nothing_to_prune(self, db):
        from app.services.episode_service import prune_stale_cache
        prune_stale_cache(db)  # No exception
