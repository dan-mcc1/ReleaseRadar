"""
Direct-service tests for app.services.shelf_service.

The SQLite branch (used in tests) is gated by `if _is_sqlite:` — these tests
exercise that branch. The Postgres-only `_fetch_shelf_movies_pg` /
`_fetch_shelf_shows_pg` raw-SQL functions use json_agg / array_agg and are
deliberately NOT exercised here (the guard prevents them from running on
SQLite anyway).

Endpoint-level tests live in tests/test_shelf.py.
"""

from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException


# ── Helpers ─────────────────────────────────────────────────────────────────


def _add_user(db, uid="test-uid-1"):
    from app.models.user import User
    db.add(User(id=uid, username=f"u_{uid}", email=f"{uid}@test.com"))
    db.commit()


def _add_movie(db, mid=550, title="Fight Club", release="2000-01-01"):
    from app.models.movie import Movie
    m = Movie(
        id=mid, title=title, status="Released",
        release_date=date.fromisoformat(release), runtime=120, overview="x",
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


def _create_shelf(db, user_id="test-uid-1", name="My Shelf", description=None):
    from app.services.shelf_service import create_shelf
    return create_shelf(db, user_id, name, description)


# ── _assert_shelf_owned ─────────────────────────────────────────────────────


class TestAssertShelfOwned:
    def test_owner_can_access(self, db):
        from app.services.shelf_service import _assert_shelf_owned
        _add_user(db)
        shelf = _create_shelf(db)
        result = _assert_shelf_owned(db, "test-uid-1", shelf.id)
        assert result.id == shelf.id

    def test_unknown_shelf_id_raises_404(self, db):
        from app.services.shelf_service import _assert_shelf_owned
        _add_user(db)
        with pytest.raises(HTTPException) as exc:
            _assert_shelf_owned(db, "test-uid-1", 99999)
        assert exc.value.status_code == 404

    def test_non_owner_raises_404(self, db):
        from app.services.shelf_service import _assert_shelf_owned
        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        shelf = _create_shelf(db, "test-uid-1")
        with pytest.raises(HTTPException) as exc:
            _assert_shelf_owned(db, "test-uid-2", shelf.id)
        assert exc.value.status_code == 404


# ── create_shelf / update_shelf / delete_shelf ──────────────────────────────


class TestShelfCrud:
    def test_create_persists_fields(self, db):
        from app.services.shelf_service import create_shelf
        from app.models.shelf import Shelf
        _add_user(db)
        s = create_shelf(db, "test-uid-1", "Classics", "Old films")
        assert s.id is not None
        assert s.name == "Classics"
        assert s.description == "Old films"
        # Round-trip via the DB
        row = db.query(Shelf).filter_by(id=s.id).first()
        assert row.name == "Classics"

    def test_update_name_only(self, db):
        from app.services.shelf_service import update_shelf
        _add_user(db)
        s = _create_shelf(db, name="Old", description="desc")
        out = update_shelf(db, "test-uid-1", s.id, name="New", description=None)
        assert out.name == "New"
        assert out.description == "desc"  # unchanged

    def test_update_description_only(self, db):
        from app.services.shelf_service import update_shelf
        _add_user(db)
        s = _create_shelf(db, name="N", description="old")
        out = update_shelf(db, "test-uid-1", s.id, name=None, description="new")
        assert out.name == "N"
        assert out.description == "new"

    def test_update_wrong_user_raises_404(self, db):
        from app.services.shelf_service import update_shelf
        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        s = _create_shelf(db, "test-uid-1")
        with pytest.raises(HTTPException) as exc:
            update_shelf(db, "test-uid-2", s.id, name="hacked", description=None)
        assert exc.value.status_code == 404

    def test_delete_removes_row(self, db):
        from app.services.shelf_service import delete_shelf
        from app.models.shelf import Shelf
        _add_user(db)
        s = _create_shelf(db)
        delete_shelf(db, "test-uid-1", s.id)
        assert db.query(Shelf).filter_by(id=s.id).first() is None

    def test_delete_wrong_user_raises_404(self, db):
        from app.services.shelf_service import delete_shelf
        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        s = _create_shelf(db, "test-uid-1")
        with pytest.raises(HTTPException) as exc:
            delete_shelf(db, "test-uid-2", s.id)
        assert exc.value.status_code == 404


# ── get_user_shelves ────────────────────────────────────────────────────────


class TestGetUserShelves:
    def test_returns_empty_for_user_with_no_shelves(self, db):
        from app.services.shelf_service import get_user_shelves
        _add_user(db)
        assert get_user_shelves(db, "test-uid-1") == []

    def test_returns_shelf_with_item_count_zero(self, db):
        from app.services.shelf_service import get_user_shelves
        _add_user(db)
        _create_shelf(db, name="A")
        out = get_user_shelves(db, "test-uid-1")
        assert len(out) == 1
        assert out[0]["name"] == "A"
        assert out[0]["item_count"] == 0
        # SQLite branch: posters_by_shelf default is empty list
        assert out[0]["preview_posters"] == []

    def test_item_count_reflects_shelf_items(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_user_shelves
        _add_user(db)
        _add_movie(db)
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.commit()
        out = get_user_shelves(db, "test-uid-1")
        assert out[0]["item_count"] == 1

    def test_isolated_per_user(self, db):
        from app.services.shelf_service import get_user_shelves
        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        _create_shelf(db, "test-uid-1", "Alice")
        assert get_user_shelves(db, "test-uid-2") == []


# ── add_to_shelf ────────────────────────────────────────────────────────────


class TestAddToShelf:
    def test_add_movie_creates_item(self, db):
        from app.services.shelf_service import add_to_shelf
        from app.models.shelf_item import ShelfItem
        _add_user(db)
        _add_movie(db)
        s = _create_shelf(db)
        with patch("app.services.shelf_service.ensure_movie_in_db"):
            item = add_to_shelf(db, "test-uid-1", s.id, "movie", 550)
        assert item.id is not None
        assert item.content_type == "movie"
        assert item.content_id == 550
        assert db.query(ShelfItem).filter_by(shelf_id=s.id).count() == 1

    def test_add_show_creates_item(self, db):
        from app.services.shelf_service import add_to_shelf
        from app.models.shelf_item import ShelfItem
        _add_user(db)
        _add_show(db)
        s = _create_shelf(db)
        with patch("app.services.shelf_service.ensure_show_in_db"):
            item = add_to_shelf(db, "test-uid-1", s.id, "tv", 1396)
        assert item.content_type == "tv"
        assert item.content_id == 1396
        assert db.query(ShelfItem).filter_by(shelf_id=s.id).count() == 1

    def test_add_idempotent_returns_existing(self, db):
        from app.services.shelf_service import add_to_shelf
        from app.models.shelf_item import ShelfItem
        _add_user(db)
        _add_movie(db)
        s = _create_shelf(db)
        with patch("app.services.shelf_service.ensure_movie_in_db"):
            item1 = add_to_shelf(db, "test-uid-1", s.id, "movie", 550)
            item2 = add_to_shelf(db, "test-uid-1", s.id, "movie", 550)
        assert item1.id == item2.id
        assert db.query(ShelfItem).filter_by(shelf_id=s.id).count() == 1

    def test_add_invalid_content_type_raises_400(self, db):
        from app.services.shelf_service import add_to_shelf
        _add_user(db)
        s = _create_shelf(db)
        with pytest.raises(HTTPException) as exc:
            add_to_shelf(db, "test-uid-1", s.id, "podcast", 1)
        assert exc.value.status_code == 400

    def test_add_to_unowned_shelf_raises_404(self, db):
        from app.services.shelf_service import add_to_shelf
        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        s = _create_shelf(db, "test-uid-1")
        with pytest.raises(HTTPException) as exc:
            add_to_shelf(db, "test-uid-2", s.id, "movie", 550)
        assert exc.value.status_code == 404


# ── remove_from_shelf ───────────────────────────────────────────────────────


class TestRemoveFromShelf:
    def test_remove_existing_item(self, db):
        from app.services.shelf_service import (
            add_to_shelf, remove_from_shelf,
        )
        from app.models.shelf_item import ShelfItem

        _add_user(db)
        _add_movie(db)
        s = _create_shelf(db)
        with patch("app.services.shelf_service.ensure_movie_in_db"):
            add_to_shelf(db, "test-uid-1", s.id, "movie", 550)
        remove_from_shelf(db, "test-uid-1", s.id, "movie", 550)
        assert db.query(ShelfItem).filter_by(shelf_id=s.id).count() == 0

    def test_remove_missing_item_raises_404(self, db):
        from app.services.shelf_service import remove_from_shelf
        _add_user(db)
        s = _create_shelf(db)
        with pytest.raises(HTTPException) as exc:
            remove_from_shelf(db, "test-uid-1", s.id, "movie", 9999)
        assert exc.value.status_code == 404

    def test_remove_from_unowned_shelf_raises_404(self, db):
        from app.services.shelf_service import remove_from_shelf
        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        s = _create_shelf(db, "test-uid-1")
        with pytest.raises(HTTPException) as exc:
            remove_from_shelf(db, "test-uid-2", s.id, "movie", 550)
        assert exc.value.status_code == 404


# ── get_shelf_items (SQLite branch) ─────────────────────────────────────────


class TestGetShelfItemsSqlite:
    def test_empty_shelf(self, db):
        from app.services.shelf_service import get_shelf_items
        _add_user(db)
        s = _create_shelf(db)
        out = get_shelf_items(db, "test-uid-1", s.id)
        assert out == {"movies": [], "shows": []}

    def test_returns_movie(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelf_items
        _add_user(db)
        _add_movie(db)
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.commit()

        out = get_shelf_items(db, "test-uid-1", s.id)
        assert len(out["movies"]) == 1
        assert out["movies"][0]["id"] == 550
        assert out["shows"] == []
        assert "added_at" in out["movies"][0]

    def test_returns_show(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelf_items
        _add_user(db)
        _add_show(db)
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="tv", content_id=1396,
        ))
        db.commit()

        out = get_shelf_items(db, "test-uid-1", s.id)
        assert out["movies"] == []
        assert len(out["shows"]) == 1
        assert out["shows"][0]["id"] == 1396

    def test_unowned_shelf_raises_404(self, db):
        from app.services.shelf_service import get_shelf_items
        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        s = _create_shelf(db, "test-uid-1")
        with pytest.raises(HTTPException) as exc:
            get_shelf_items(db, "test-uid-2", s.id)
        assert exc.value.status_code == 404


# ── get_shelf_calendar ──────────────────────────────────────────────────────


class TestGetShelfCalendar:
    def test_empty_shelf_returns_empty_buckets(self, db):
        from app.services.shelf_service import get_shelf_calendar
        _add_user(db)
        s = _create_shelf(db)
        out = get_shelf_calendar(db, "test-uid-1", s.id)
        assert out == {"shows": [], "movies": []}

    def test_unowned_shelf_raises_404(self, db):
        from app.services.shelf_service import get_shelf_calendar
        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        s = _create_shelf(db, "test-uid-1")
        with pytest.raises(HTTPException) as exc:
            get_shelf_calendar(db, "test-uid-2", s.id)
        assert exc.value.status_code == 404

    def test_returns_show_episodes_unfiltered(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelf_calendar

        _add_user(db)
        _add_show(db)
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="tv", content_id=1396,
        ))
        db.commit()

        out = get_shelf_calendar(db, "test-uid-1", s.id)
        assert len(out["shows"]) == 1
        assert out["shows"][0]["show"]["id"] == 1396
        # Both episodes are present when no filter
        assert len(out["shows"][0]["episodes"]) == 2

    def test_filters_episodes_by_date_range(self, db):
        from app.models.shelf_item import ShelfItem
        from app.models.episode import Episode
        from app.services.shelf_service import get_shelf_calendar

        _add_user(db)
        _add_show(db)
        # Add a future episode that should be excluded
        db.add(Episode(
            id=900001, show_id=1396, season_number=2, episode_number=1,
            name="Future", air_date=date(2030, 1, 1),
        ))
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="tv", content_id=1396,
        ))
        db.commit()

        out = get_shelf_calendar(
            db, "test-uid-1", s.id,
            from_date="2008-01-01", to_date="2008-12-31",
        )
        assert len(out["shows"]) == 1
        ep_dates = [ep["air_date"] for ep in out["shows"][0]["episodes"]]
        assert "2030-01-01" not in ep_dates
        assert len(ep_dates) == 2

    def test_show_with_no_eps_in_window_omitted_when_filtering(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelf_calendar

        _add_user(db)
        _add_show(db)
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="tv", content_id=1396,
        ))
        db.commit()

        out = get_shelf_calendar(
            db, "test-uid-1", s.id,
            from_date="2050-01-01", to_date="2050-12-31",
        )
        # Filtering active → shows with no eps in window are dropped
        assert out["shows"] == []

    def test_marks_watched_episodes(self, db):
        from app.models.shelf_item import ShelfItem
        from app.models.episode_watched import EpisodeWatched
        from app.services.shelf_service import get_shelf_calendar

        _add_user(db)
        _add_show(db)
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="tv", content_id=1396,
        ))
        db.add(EpisodeWatched(
            user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1,
        ))
        db.commit()

        out = get_shelf_calendar(db, "test-uid-1", s.id)
        eps = {ep["episode_number"]: ep for ep in out["shows"][0]["episodes"]}
        assert eps[1]["is_watched"] is True
        assert eps[2]["is_watched"] is False

    def test_returns_movies_unfiltered(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelf_calendar

        _add_user(db)
        _add_movie(db, mid=550, release="2010-06-01")
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.commit()

        out = get_shelf_calendar(db, "test-uid-1", s.id)
        assert len(out["movies"]) == 1
        assert out["movies"][0]["id"] == 550
        assert out["movies"][0]["is_watched"] is False

    def test_movie_filtered_by_from_date(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelf_calendar

        _add_user(db)
        _add_movie(db, mid=550, release="2005-01-01")
        _add_movie(db, mid=551, title="Newer", release="2020-01-01")
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="movie", content_id=551,
        ))
        db.commit()

        out = get_shelf_calendar(
            db, "test-uid-1", s.id, from_date="2010-01-01",
        )
        ids = {m["id"] for m in out["movies"]}
        assert 551 in ids
        assert 550 not in ids

    def test_movie_filtered_by_to_date(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelf_calendar

        _add_user(db)
        _add_movie(db, mid=550, release="2005-01-01")
        _add_movie(db, mid=551, title="Newer", release="2020-01-01")
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="movie", content_id=551,
        ))
        db.commit()

        out = get_shelf_calendar(
            db, "test-uid-1", s.id, to_date="2010-01-01",
        )
        ids = {m["id"] for m in out["movies"]}
        assert 550 in ids
        assert 551 not in ids

    def test_movie_marks_watched(self, db):
        from app.models.shelf_item import ShelfItem
        from app.models.watched import Watched
        from app.services.shelf_service import get_shelf_calendar

        _add_user(db)
        _add_movie(db, mid=550, release="2010-01-01")
        s = _create_shelf(db)
        db.add(ShelfItem(
            shelf_id=s.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.add(Watched(
            user_id="test-uid-1", content_type="movie", content_id=550,
            watched_at=datetime.now(timezone.utc),
        ))
        db.commit()

        out = get_shelf_calendar(db, "test-uid-1", s.id)
        assert out["movies"][0]["is_watched"] is True


# ── get_shelves_for_item ────────────────────────────────────────────────────


class TestGetShelvesForItem:
    def test_returns_empty_when_not_on_any_shelf(self, db):
        from app.services.shelf_service import get_shelves_for_item
        _add_user(db)
        out = get_shelves_for_item(db, "test-uid-1", "movie", 550)
        assert out == []

    def test_returns_shelf_ids_for_item(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelves_for_item

        _add_user(db)
        _add_movie(db)
        s1 = _create_shelf(db, name="A")
        s2 = _create_shelf(db, name="B")
        db.add(ShelfItem(
            shelf_id=s1.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.add(ShelfItem(
            shelf_id=s2.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.commit()

        out = get_shelves_for_item(db, "test-uid-1", "movie", 550)
        assert sorted(out) == sorted([s1.id, s2.id])

    def test_other_users_shelves_not_included(self, db):
        from app.models.shelf_item import ShelfItem
        from app.services.shelf_service import get_shelves_for_item

        _add_user(db, "test-uid-1")
        _add_user(db, "test-uid-2")
        _add_movie(db)
        s_alice = _create_shelf(db, "test-uid-1", "Alice")
        s_bob = _create_shelf(db, "test-uid-2", "Bob")
        db.add(ShelfItem(
            shelf_id=s_alice.id, user_id="test-uid-1",
            content_type="movie", content_id=550,
        ))
        db.add(ShelfItem(
            shelf_id=s_bob.id, user_id="test-uid-2",
            content_type="movie", content_id=550,
        ))
        db.commit()

        # Alice only sees her own shelf
        out = get_shelves_for_item(db, "test-uid-1", "movie", 550)
        assert out == [s_alice.id]
