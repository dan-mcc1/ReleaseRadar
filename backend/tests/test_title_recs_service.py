"""
Tests for app.services.title_recs_service: fetching each tracked title's
TMDb recommendations and keeping them in title_recs / rec_candidate.

TMDb is mocked at the service's `get`, so no network traffic happens.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import httpx
import pytest

NOW = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
TMDB_GET = "app.services.title_recs_service.get"


def rec(content_id, *, tv=False, **extra):
    item = {"id": content_id, "poster_path": f"/{content_id}.jpg", **extra}
    item["name" if tv else "title"] = f"Title {content_id}"
    return item


def tmdb_error(status):
    response = MagicMock(status_code=status)
    return httpx.HTTPStatusError(str(status), request=MagicMock(), response=response)


@pytest.fixture
def user(db):
    from app.models.user import User

    db.add(User(id="uid1", username="uid1", email="u@test.com"))
    db.commit()
    return "uid1"


def track(db, content_id, content_type="movie"):
    from app.models.watchlist import Watchlist

    db.add(Watchlist(user_id="uid1", content_type=content_type, content_id=content_id))
    db.commit()


def stored_list(db, content_type, content_id):
    from app.models.title_recs import TitleRecs

    row = db.get(TitleRecs, (content_type, content_id, "tmdb"))
    return None if row is None else [tuple(pair) for pair in row.recs]


class TestFetchRecs:
    def fetch(self, *key):
        from app.services.title_recs_service import fetch_recs
        return fetch_recs(*key)

    def test_asks_the_endpoint_for_the_titles_type(self):
        with patch(TMDB_GET, return_value={"results": [rec(1)]}) as tmdb:
            assert self.fetch("movie", 100) == [rec(1)]
            self.fetch("tv", 200)
        assert [call.args[0] for call in tmdb.call_args_list] == [
            "/movie/100/recommendations", "/tv/200/recommendations",
        ]

    def test_a_title_tmdb_no_longer_has_gives_an_empty_list(self):
        with patch(TMDB_GET, side_effect=tmdb_error(404)):
            assert self.fetch("movie", 100) == []

    def test_any_other_failure_gives_none_so_it_is_tried_again(self):
        with patch(TMDB_GET, side_effect=tmdb_error(500)):
            assert self.fetch("movie", 100) is None
        with patch(TMDB_GET, side_effect=RuntimeError("timeout")):
            assert self.fetch("movie", 100) is None


class TestStoreRecs:
    def store(self, db, fetched, now=NOW):
        from app.services.title_recs_service import store_recs
        stored = store_recs(db, fetched, now)
        db.commit()
        return stored

    def test_stores_the_list_in_order_with_a_display_row_per_title(self, db):
        from app.models.title_recs import RecCandidate

        stored = self.store(db, {("movie", 550): [
            rec(9002, tv=True, first_air_date="2021-03-04", genre_ids=[18, 80]),
            rec(9001, release_date="2020-01-02", vote_average=7.5, popularity=12.0,
                backdrop_path="/b.jpg"),
        ]})

        assert stored == {("movie", 550): [("tv", 9002), ("movie", 9001)]}
        assert stored_list(db, "movie", 550) == [("tv", 9002), ("movie", 9001)]
        film = db.get(RecCandidate, ("movie", 9001))
        assert (film.title, film.poster_path, film.backdrop_path, film.release_date,
                film.vote_average, film.popularity, film.genre_ids) == (
            "Title 9001", "/9001.jpg", "/b.jpg", "2020-01-02", 7.5, 12.0, [])
        show = db.get(RecCandidate, ("tv", 9002))
        assert (show.title, show.release_date, show.genre_ids) == ("Title 9002", "2021-03-04", [18, 80])

    def test_skips_what_for_you_could_not_show(self, db):
        from app.models.title_recs import RecCandidate

        self.store(db, {("movie", 550): [
            rec(1, adult=True),
            {"id": 2, "title": "No poster"},
            {"id": 3, "poster_path": "/3.jpg"},
            {"title": "No id", "poster_path": "/x.jpg"},
            rec(550),  # the title itself
            rec(4),
            rec(4),  # listed twice
        ]})

        assert stored_list(db, "movie", 550) == [("movie", 4)]
        assert db.query(RecCandidate).count() == 1

    def test_an_empty_list_is_stored_so_the_title_is_not_fetched_again(self, db):
        self.store(db, {("movie", 550): []})
        assert stored_list(db, "movie", 550) == []

    def test_storing_again_replaces_the_list_and_refreshes_the_display_row(self, db):
        from app.models.title_recs import RecCandidate, TitleRecs

        self.store(db, {("movie", 550): [rec(9001, vote_average=6.0), rec(9002)]})
        later = NOW + timedelta(days=31)
        self.store(db, {("movie", 550): [rec(9003), rec(9001, vote_average=6.4)]}, later)
        db.expire_all()

        assert stored_list(db, "movie", 550) == [("movie", 9003), ("movie", 9001)]
        assert db.query(TitleRecs).count() == 1
        assert db.get(RecCandidate, ("movie", 9001)).vote_average == 6.4
        seen = {row.content_id: row.seen_at.replace(tzinfo=None) for row in db.query(RecCandidate)}
        assert seen[9001] == seen[9003] == later.replace(tzinfo=None)
        assert seen[9002] == NOW.replace(tzinfo=None)

    def test_a_movie_and_a_show_with_the_same_id_are_different_titles(self, db):
        from app.models.title_recs import RecCandidate

        self.store(db, {("movie", 550): [rec(7), rec(7, tv=True)]})
        assert stored_list(db, "movie", 550) == [("movie", 7), ("tv", 7)]
        assert db.query(RecCandidate).count() == 2


class TestFetchAndStore:
    def test_with_a_timeout_a_title_tmdb_is_slow_on_is_left_for_later(self, db):
        import threading
        from app.services.title_recs_service import fetch_and_store

        release = threading.Event()

        def fake_get(path, params=None):
            if path.startswith("/movie/2/"):
                release.wait(10)
            return {"results": [rec(9001)]}

        try:
            with patch(TMDB_GET, side_effect=fake_get):
                stored = fetch_and_store(db, [("movie", 1), ("movie", 2)], NOW, timeout=0.2)
                db.commit()
        finally:
            release.set()

        assert stored == {("movie", 1): [("movie", 9001)]}
        assert stored_list(db, "movie", 2) is None

    def test_without_a_timeout_it_waits_for_every_title(self, db):
        from app.services.title_recs_service import fetch_and_store

        with patch(TMDB_GET, return_value={"results": [rec(9001)]}):
            stored = fetch_and_store(db, [("movie", 1), ("tv", 2)], NOW)
        assert list(stored) == [("movie", 1), ("tv", 2)]

    def test_nothing_to_fetch_asks_nothing(self, db):
        from app.services.title_recs_service import fetch_and_store

        with patch(TMDB_GET) as tmdb:
            assert fetch_and_store(db, [], NOW) == {}
        tmdb.assert_not_called()


class TestTitlesDue:
    def due(self, db, limit=None, now=NOW):
        from app.services.title_recs_service import titles_due
        return titles_due(db, limit, now)

    def store(self, db, key, at):
        from app.services.title_recs_service import store_recs
        store_recs(db, {key: []}, at)
        db.commit()

    def test_every_tracked_title_with_no_list_is_due_once(self, db, user):
        from app.models.currently_watching import CurrentlyWatching
        from app.models.watched import Watched

        track(db, 1)
        db.add(Watched(user_id="uid1", content_type="movie", content_id=1))  # on two lists
        db.add(Watched(user_id="uid1", content_type="tv", content_id=2))
        db.add(CurrentlyWatching(user_id="uid1", content_type="tv", content_id=3))
        db.commit()

        assert sorted(self.due(db)) == [("movie", 1), ("tv", 2), ("tv", 3)]

    def test_a_fresh_list_is_not_due_and_a_month_old_one_is(self, db, user):
        track(db, 1)
        track(db, 2)
        self.store(db, ("movie", 1), NOW - timedelta(days=29))
        self.store(db, ("movie", 2), NOW - timedelta(days=31))

        assert self.due(db) == [("movie", 2)]

    def test_missing_lists_come_before_stale_ones_oldest_first(self, db, user):
        for content_id in (1, 2, 3):
            track(db, content_id)
        self.store(db, ("movie", 1), NOW - timedelta(days=40))
        self.store(db, ("movie", 2), NOW - timedelta(days=60))

        assert self.due(db) == [("movie", 3), ("movie", 2), ("movie", 1)]
        assert self.due(db, limit=2) == [("movie", 3), ("movie", 2)]

    def test_a_stored_list_nobody_tracks_is_not_due(self, db, user):
        self.store(db, ("movie", 1), NOW - timedelta(days=60))
        assert self.due(db) == []


class TestRefreshTitleRecs:
    def refresh(self, db, **kwargs):
        from app.services.title_recs_service import refresh_title_recs
        return refresh_title_recs(db, now=NOW, **kwargs)

    def test_fetches_and_stores_every_due_title(self, db, user):
        track(db, 1)
        track(db, 2, "tv")

        def fake_get(path, params=None):
            return {"results": [rec(9001)] if path.startswith("/movie/1/") else [rec(9002, tv=True)]}

        with patch(TMDB_GET, side_effect=fake_get):
            result = self.refresh(db)

        assert result == {"due": 2, "stored": 2, "pruned": 0}
        assert stored_list(db, "movie", 1) == [("movie", 9001)]
        assert stored_list(db, "tv", 2) == [("tv", 9002)]

    def test_a_second_run_has_nothing_to_do(self, db, user):
        track(db, 1)
        with patch(TMDB_GET, return_value={"results": [rec(9001)]}) as tmdb:
            self.refresh(db)
            assert self.refresh(db) == {"due": 0, "stored": 0, "pruned": 0}
        assert tmdb.call_count == 1

    def test_limit_caps_the_titles_fetched_in_one_run(self, db, user):
        for content_id in range(1, 6):
            track(db, content_id)
        with patch(TMDB_GET, return_value={"results": []}) as tmdb:
            assert self.refresh(db, limit=2) == {"due": 2, "stored": 2, "pruned": 0}
        assert tmdb.call_count == 2

    def test_a_title_tmdb_failed_on_stays_due_and_the_rest_are_stored(self, db, user):
        from app.services.title_recs_service import titles_due

        track(db, 1)
        track(db, 2)

        def fake_get(path, params=None):
            if path.startswith("/movie/1/"):
                raise tmdb_error(500)
            return {"results": [rec(9001)]}

        with patch(TMDB_GET, side_effect=fake_get):
            result = self.refresh(db)

        assert result == {"due": 2, "stored": 1, "pruned": 0}
        assert titles_due(db, None, NOW) == [("movie", 1)]

    def test_a_title_gone_from_tmdb_gets_an_empty_list_and_is_not_asked_again(self, db, user):
        track(db, 1)
        with patch(TMDB_GET, side_effect=tmdb_error(404)) as tmdb:
            self.refresh(db)
            self.refresh(db)
        assert tmdb.call_count == 1
        assert stored_list(db, "movie", 1) == []

    def test_prunes_what_no_refresh_has_touched_in_ninety_days(self, db, user):
        from app.models.title_recs import RecCandidate
        from app.services.title_recs_service import store_recs

        track(db, 2)
        store_recs(db, {("movie", 1): [rec(9001)]}, NOW - timedelta(days=91))  # untracked since
        store_recs(db, {("movie", 2): [rec(9002)]}, NOW - timedelta(days=10))
        db.commit()

        with patch(TMDB_GET) as tmdb:
            result = self.refresh(db)

        tmdb.assert_not_called()
        assert result == {"due": 0, "stored": 0, "pruned": 2}
        assert stored_list(db, "movie", 1) is None
        assert stored_list(db, "movie", 2) == [("movie", 9002)]
        assert [row.content_id for row in db.query(RecCandidate)] == [9002]

    def test_a_stale_tracked_list_is_refetched_before_it_can_be_pruned(self, db, user):
        from app.services.title_recs_service import store_recs

        track(db, 1)
        store_recs(db, {("movie", 1): [rec(9001)]}, NOW - timedelta(days=120))
        db.commit()

        with patch(TMDB_GET, return_value={"results": [rec(9001), rec(9003)]}):
            result = self.refresh(db)

        assert result == {"due": 1, "stored": 1, "pruned": 0}
        assert stored_list(db, "movie", 1) == [("movie", 9001), ("movie", 9003)]
