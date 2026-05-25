"""
Direct-service tests for app.services.watchlist_service.

Endpoint-level tests live in tests/test_watchlist.py. These tests hit the
service functions directly to cover edge cases: notify-pref interactions,
reorder boundary conditions, the SQLite branch of get_watchlist, the
TV calendar date filtering, and assert_can_track.
"""

from datetime import date, datetime, timezone, timedelta
from unittest.mock import patch

import pytest


# ── Helpers ─────────────────────────────────────────────────────────────────


def _add_user(db, uid="test-uid-1"):
    from app.models.user import User
    db.add(User(id=uid, username=f"u_{uid}", email=f"{uid}@test.com"))
    db.commit()


def _add_movie(db, mid=550, title="Fight Club"):
    from app.models.movie import Movie
    m = Movie(
        id=mid, title=title, status="Released",
        release_date=date(2000, 1, 1), runtime=120, overview="x",
        tracking_count=1, vote_average=7.0,
    )
    db.add(m)
    db.commit()
    return m


def _add_show(db, sid=1396, name="Breaking Bad"):
    """Add a show with two episodes in season 1 (Jan 2008)."""
    from app.models.show import Show
    from app.models.episode import Episode
    s = Show(
        id=sid, name=name, status="Ended",
        first_air_date=date(2008, 1, 20), number_of_seasons=1,
        number_of_episodes=2, in_production=False, tracking_count=1,
        vote_average=9.0,
    )
    db.add(s)
    db.flush()
    db.add_all([
        Episode(id=62085, show_id=sid, season_number=1, episode_number=1,
                name="Pilot", air_date=date(2008, 1, 20)),
        Episode(id=62086, show_id=sid, season_number=1, episode_number=2,
                name="Cat's in the Bag", air_date=date(2008, 1, 27)),
    ])
    db.commit()
    return s


def _add_watchlist(db, uid, ctype, cid, sort_key=1000, notify=True):
    from app.models.watchlist import Watchlist
    w = Watchlist(
        user_id=uid, content_type=ctype, content_id=cid,
        added_at=datetime.now(timezone.utc), sort_key=sort_key, notify=notify,
    )
    db.add(w)
    db.commit()
    return w


# ── _is_tracked_on_any / _is_on_other_list ───────────────────────────────────


class TestIsTrackedHelpers:
    def test_is_tracked_on_any_returns_true_when_in_watchlist(self, db):
        from app.models.watchlist import Watchlist
        from app.services.watchlist_service import _is_tracked_on_any

        _add_user(db)
        _add_movie(db)
        _add_watchlist(db, "test-uid-1", "movie", 550)
        assert _is_tracked_on_any(
            db, "test-uid-1", "movie", 550, Watchlist
        ) is True

    def test_is_tracked_on_any_returns_false_when_missing(self, db):
        from app.models.watchlist import Watchlist
        from app.services.watchlist_service import _is_tracked_on_any

        _add_user(db)
        assert _is_tracked_on_any(
            db, "test-uid-1", "movie", 550, Watchlist
        ) is False

    def test_is_on_other_list_with_currently_watching(self, db):
        from app.models.currently_watching import CurrentlyWatching
        from app.services.watchlist_service import _is_on_other_list

        _add_user(db)
        _add_show(db)
        db.add(CurrentlyWatching(
            user_id="test-uid-1", content_type="tv", content_id=1396,
            added_at=datetime.now(timezone.utc),
        ))
        db.commit()
        assert _is_on_other_list(db, "test-uid-1", "tv", 1396) is True

    def test_is_on_other_list_false_when_in_watchlist_only(self, db):
        from app.services.watchlist_service import _is_on_other_list

        _add_user(db)
        _add_movie(db)
        _add_watchlist(db, "test-uid-1", "movie", 550)
        # Watchlist isn't an "other" list — it's the *same* list, so this returns False.
        assert _is_on_other_list(db, "test-uid-1", "movie", 550) is False


# ── _get_item_title_and_poster ──────────────────────────────────────────────


class TestGetItemTitleAndPoster:
    def test_movie_returns_title(self, db):
        from app.services.watchlist_service import _get_item_title_and_poster
        _add_movie(db)
        title, poster = _get_item_title_and_poster(db, "movie", 550)
        assert title == "Fight Club"

    def test_show_returns_name(self, db):
        from app.services.watchlist_service import _get_item_title_and_poster
        _add_show(db)
        title, poster = _get_item_title_and_poster(db, "tv", 1396)
        assert title == "Breaking Bad"

    def test_missing_returns_none_pair(self, db):
        from app.services.watchlist_service import _get_item_title_and_poster
        title, poster = _get_item_title_and_poster(db, "movie", 99999)
        assert title is None
        assert poster is None


# ── add_to_watchlist (service-level, with notify flag) ──────────────────────


class TestAddToWatchlistService:
    def test_add_with_notify_false(self, db):
        from app.models.watchlist import Watchlist
        from app.services.watchlist_service import add_to_watchlist

        _add_user(db)
        _add_movie(db)
        out = add_to_watchlist(db, "test-uid-1", "movie", 550, notify=False)
        assert out["notify"] is False
        wl = db.query(Watchlist).filter_by(
            user_id="test-uid-1", content_type="movie", content_id=550
        ).first()
        assert wl.notify is False

    def test_add_default_notify_true(self, db):
        from app.services.watchlist_service import add_to_watchlist

        _add_user(db)
        _add_show(db)
        out = add_to_watchlist(db, "test-uid-1", "tv", 1396)
        assert out["notify"] is True

    def test_add_idempotent_returns_existing(self, db):
        from app.services.watchlist_service import add_to_watchlist
        from app.models.watchlist import Watchlist

        _add_user(db)
        _add_movie(db)
        add_to_watchlist(db, "test-uid-1", "movie", 550)
        out = add_to_watchlist(db, "test-uid-1", "movie", 550)
        # Idempotent path returns minimal dict {id, content_type, content_id}
        assert out["content_id"] == 550
        assert db.query(Watchlist).filter_by(
            user_id="test-uid-1", content_type="movie", content_id=550
        ).count() == 1

    def test_add_assigns_increasing_sort_keys(self, db):
        from app.services.watchlist_service import add_to_watchlist
        from app.models.movie import Movie

        _add_user(db)
        for i, mid in enumerate([100, 101, 102]):
            db.add(Movie(id=mid, title=f"M{mid}", status="Released",
                         release_date=date(2020, 1, 1), runtime=90, overview="x",
                         tracking_count=0, vote_average=5.0))
        db.commit()
        out1 = add_to_watchlist(db, "test-uid-1", "movie", 100)
        out2 = add_to_watchlist(db, "test-uid-1", "movie", 101)
        out3 = add_to_watchlist(db, "test-uid-1", "movie", 102)
        assert out2["sort_key"] > out1["sort_key"]
        assert out3["sort_key"] > out2["sort_key"]


# ── remove_from_watchlist (service-level) ───────────────────────────────────


class TestRemoveFromWatchlistService:
    def test_remove_purges_want_to_watch_activity(self, db):
        from app.models.activity import Activity
        from app.services.watchlist_service import (
            add_to_watchlist, remove_from_watchlist,
        )

        _add_user(db)
        _add_movie(db)
        add_to_watchlist(db, "test-uid-1", "movie", 550)
        # The add should have logged a 'want_to_watch' activity
        assert db.query(Activity).filter_by(
            user_id="test-uid-1", activity_type="want_to_watch",
            content_type="movie", content_id=550,
        ).first() is not None
        remove_from_watchlist(db, "test-uid-1", "movie", 550)
        # Activity should now be deleted
        assert db.query(Activity).filter_by(
            user_id="test-uid-1", activity_type="want_to_watch",
            content_type="movie", content_id=550,
        ).first() is None

    def test_remove_nonexistent_returns_not_found(self, db):
        from app.services.watchlist_service import remove_from_watchlist

        _add_user(db)
        result = remove_from_watchlist(db, "test-uid-1", "movie", 999)
        assert "not found" in result["message"].lower()

    def test_remove_no_commit_keeps_uncommitted(self, db):
        from app.services.watchlist_service import (
            add_to_watchlist, remove_from_watchlist,
        )
        from app.models.watchlist import Watchlist

        _add_user(db)
        _add_movie(db)
        add_to_watchlist(db, "test-uid-1", "movie", 550)
        result = remove_from_watchlist(db, "test-uid-1", "movie", 550, commit=False)
        assert result["message"] == "Removed from watchlist"
        # Commit-less call still issued DELETE; commit it now
        db.commit()
        assert db.query(Watchlist).filter_by(
            user_id="test-uid-1", content_type="movie", content_id=550
        ).first() is None

    def test_remove_tv_clears_episode_watched(self, db):
        from app.models.episode_watched import EpisodeWatched
        from app.services.watchlist_service import (
            add_to_watchlist, remove_from_watchlist,
        )

        _add_user(db)
        _add_show(db)
        add_to_watchlist(db, "test-uid-1", "tv", 1396)
        db.add(EpisodeWatched(
            user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1,
        ))
        db.commit()
        remove_from_watchlist(db, "test-uid-1", "tv", 1396)
        assert db.query(EpisodeWatched).filter_by(
            user_id="test-uid-1", show_id=1396
        ).count() == 0


# ── reorder_watchlist_item ──────────────────────────────────────────────────


class TestReorderWatchlistItem:
    def test_reorder_unknown_item_raises(self, db):
        from app.services.watchlist_service import reorder_watchlist_item
        _add_user(db)
        with pytest.raises(ValueError) as exc:
            reorder_watchlist_item(db, "test-uid-1", "movie", 9999, None, None)
        assert "not in watchlist" in str(exc.value).lower()

    def test_reorder_with_unknown_before_id_raises(self, db):
        from app.services.watchlist_service import reorder_watchlist_item
        _add_user(db)
        _add_movie(db)
        _add_watchlist(db, "test-uid-1", "movie", 550, sort_key=1000)
        with pytest.raises(ValueError) as exc:
            reorder_watchlist_item(db, "test-uid-1", "movie", 550, before_id=99999, after_id=None)
        assert "before_id" in str(exc.value)

    def test_reorder_with_unknown_after_id_raises(self, db):
        from app.services.watchlist_service import reorder_watchlist_item
        _add_user(db)
        _add_movie(db)
        _add_watchlist(db, "test-uid-1", "movie", 550, sort_key=1000)
        with pytest.raises(ValueError) as exc:
            reorder_watchlist_item(db, "test-uid-1", "movie", 550, before_id=None, after_id=99999)
        assert "after_id" in str(exc.value)

    def test_reorder_to_top_uses_before_zero(self, db):
        from app.services.watchlist_service import reorder_watchlist_item
        from app.models.movie import Movie

        _add_user(db)
        for mid in (100, 101):
            db.add(Movie(id=mid, title=f"M{mid}", status="Released",
                         release_date=date(2020, 1, 1), runtime=90, overview="x",
                         tracking_count=0, vote_average=5.0))
        db.commit()
        w1 = _add_watchlist(db, "test-uid-1", "movie", 100, sort_key=1000)
        w2 = _add_watchlist(db, "test-uid-1", "movie", 101, sort_key=2000)

        # Move 101 to top → before=None, after=w1.id
        result = reorder_watchlist_item(
            db, "test-uid-1", "movie", 101, before_id=None, after_id=w1.id,
        )
        movies = {m["id"]: m for m in result["movies"]}
        # Sort key is midpoint of (0, 1000) = 500
        assert movies[101]["sort_key"] == 500

    def test_reorder_to_bottom_uses_max_plus_2000(self, db):
        from app.services.watchlist_service import reorder_watchlist_item
        from app.models.movie import Movie

        _add_user(db)
        for mid in (100, 101):
            db.add(Movie(id=mid, title=f"M{mid}", status="Released",
                         release_date=date(2020, 1, 1), runtime=90, overview="x",
                         tracking_count=0, vote_average=5.0))
        db.commit()
        w1 = _add_watchlist(db, "test-uid-1", "movie", 100, sort_key=1000)
        w2 = _add_watchlist(db, "test-uid-1", "movie", 101, sort_key=2000)

        # Move 100 to bottom → before=w2.id, after=None → after_key = max(2000)+2000 = 4000
        # new key = (2000 + 4000) // 2 = 3000
        result = reorder_watchlist_item(
            db, "test-uid-1", "movie", 100, before_id=w2.id, after_id=None,
        )
        movies = {m["id"]: m for m in result["movies"]}
        assert movies[100]["sort_key"] == 3000

    def test_reorder_triggers_renormalization(self, db):
        """When the gap collapses to <=10, sort_keys are re-spaced to multiples of 1000."""
        from app.services.watchlist_service import reorder_watchlist_item
        from app.models.movie import Movie

        _add_user(db)
        for mid in (100, 101, 102):
            db.add(Movie(id=mid, title=f"M{mid}", status="Released",
                         release_date=date(2020, 1, 1), runtime=90, overview="x",
                         tracking_count=0, vote_average=5.0))
        db.commit()
        # Set up: keys 1000 and 1010, 5 gap → renorm trigger
        w_a = _add_watchlist(db, "test-uid-1", "movie", 100, sort_key=1000)
        w_b = _add_watchlist(db, "test-uid-1", "movie", 101, sort_key=1010)
        w_c = _add_watchlist(db, "test-uid-1", "movie", 102, sort_key=5000)

        result = reorder_watchlist_item(
            db, "test-uid-1", "movie", 102,
            before_id=w_a.id, after_id=w_b.id,
        )
        sort_keys = sorted(m["sort_key"] for m in result["movies"])
        # Should be renormalized to 1000, 2000, 3000
        assert sort_keys == [1000, 2000, 3000]


# ── _get_watchlist_items / get_watchlist (SQLite branch) ────────────────────


class TestGetWatchlistItems:
    def test_empty_lists_when_nothing_tracked(self, db):
        from app.services.watchlist_service import get_watchlist
        _add_user(db)
        out = get_watchlist(db, "test-uid-1")
        assert out == {"movies": [], "shows": []}

    def test_returns_movie_and_show(self, db):
        from app.services.watchlist_service import get_watchlist
        _add_user(db)
        _add_movie(db)
        _add_show(db)
        _add_watchlist(db, "test-uid-1", "movie", 550, sort_key=1000)
        _add_watchlist(db, "test-uid-1", "tv", 1396, sort_key=2000)

        out = get_watchlist(db, "test-uid-1")
        assert len(out["movies"]) == 1
        assert out["movies"][0]["id"] == 550
        assert "watchlist_id" in out["movies"][0]
        assert "sort_key" in out["movies"][0]
        assert len(out["shows"]) == 1
        assert out["shows"][0]["id"] == 1396

    def test_returns_items_in_sort_key_order(self, db):
        from app.services.watchlist_service import get_watchlist
        from app.models.movie import Movie

        _add_user(db)
        for mid in (100, 101, 102):
            db.add(Movie(id=mid, title=f"M{mid}", status="Released",
                         release_date=date(2020, 1, 1), runtime=90, overview="x",
                         tracking_count=0, vote_average=5.0))
        db.commit()
        _add_watchlist(db, "test-uid-1", "movie", 100, sort_key=3000)
        _add_watchlist(db, "test-uid-1", "movie", 101, sort_key=1000)
        _add_watchlist(db, "test-uid-1", "movie", 102, sort_key=2000)

        out = get_watchlist(db, "test-uid-1")
        order = [m["id"] for m in out["movies"]]
        assert order == [101, 102, 100]


# ── get_watchlist_status ────────────────────────────────────────────────────


@pytest.mark.skip(reason="get_watchlist_status uses PG-only raw SQL (NULL::float cast)")
class TestGetWatchlistStatus:
    def test_status_none_when_not_tracked(self, db):
        pass

    def test_status_want_to_watch(self, db):
        pass

    def test_status_currently_watching(self, db):
        pass

    def test_status_watched_includes_rating(self, db):
        pass


# ── get_tv_calendar ─────────────────────────────────────────────────────────


class TestGetTvCalendar:
    def test_returns_empty_when_user_tracks_nothing(self, db):
        from app.services.watchlist_service import get_tv_calendar
        _add_user(db)
        assert get_tv_calendar(db, "test-uid-1", "2024-01-01", "2024-12-31") == []

    def test_returns_episodes_in_window(self, db):
        from app.models.episode import Episode
        from app.services.watchlist_service import get_tv_calendar

        _add_user(db)
        _add_show(db)
        # seed_show already has 2 eps in season 1; add an out-of-window ep
        db.add(Episode(
            id=900001, show_id=1396, season_number=2, episode_number=1,
            name="Future", air_date=date(2030, 1, 1),
        ))
        db.commit()
        _add_watchlist(db, "test-uid-1", "tv", 1396, sort_key=1000)

        out = get_tv_calendar(db, "test-uid-1", "2008-01-01", "2008-12-31")
        assert len(out) == 1
        assert out[0]["show"]["id"] == 1396
        ep_dates = [ep["air_date"] for ep in out[0]["episodes"]]
        # Both 2008 episodes are present, future episode excluded
        assert "2008-01-20" in ep_dates
        assert "2008-01-27" in ep_dates
        assert "2030-01-01" not in ep_dates

    def test_show_with_no_episodes_in_window_omitted(self, db):
        from app.services.watchlist_service import get_tv_calendar

        _add_user(db)
        _add_show(db)
        _add_watchlist(db, "test-uid-1", "tv", 1396, sort_key=1000)
        out = get_tv_calendar(db, "test-uid-1", "2050-01-01", "2050-12-31")
        assert out == []

    def test_currently_watching_shows_also_included(self, db):
        from app.models.currently_watching import CurrentlyWatching
        from app.services.watchlist_service import get_tv_calendar

        _add_user(db)
        _add_show(db)
        # Track via CurrentlyWatching, NOT watchlist
        db.add(CurrentlyWatching(
            user_id="test-uid-1", content_type="tv", content_id=1396,
            added_at=datetime.now(timezone.utc),
        ))
        db.commit()

        out = get_tv_calendar(db, "test-uid-1", "2008-01-01", "2008-12-31")
        assert len(out) == 1
        assert out[0]["show"]["id"] == 1396


# ── assert_can_track ────────────────────────────────────────────────────────


class TestAssertCanTrack:
    def test_open_beta_no_op(self, db):
        """Open-beta short-circuit: function returns None without raising."""
        from app.services.watchlist_service import assert_can_track
        _add_user(db)
        # Even with no row matching, this is a no-op now.
        assert assert_can_track(db, "test-uid-1") is None
