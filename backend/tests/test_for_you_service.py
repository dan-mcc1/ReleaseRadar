"""
Tests for app.services.for_you_service.

- seed_weight                  → how much a library title counts (pure)
- rank                         → scoring stored lists against a library (pure)
- get_for_you_recommendations  → end to end: library, stored lists, TMDb only
                                 for titles with no stored list

TMDb is mocked where title_recs_service calls it, so no network traffic happens.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

NOW = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
TMDB_GET = "app.services.title_recs_service.get"


def rec(content_id, *, tv=False, **extra):
    """A TMDb recommendation list item with what For You needs to show it."""
    item = {"id": content_id, "poster_path": f"/{content_id}.jpg", "popularity": 1.0, **extra}
    item["name" if tv else "title"] = extra.get("label", f"Title {content_id}")
    item.pop("label", None)
    return item


def recs_by_path(lists):
    """A stand-in for the TMDb client: `lists` maps '/movie/550' to its results."""
    def fake_get(path, params=None):
        for prefix, results in lists.items():
            if path == f"{prefix}/recommendations":
                return {"results": results}
        return {"results": []}
    return fake_get


@pytest.fixture(autouse=True)
def _tmdb_not_paused():
    """A failed fetch pauses asking TMDb for the whole process; start each test unpaused."""
    from app.services import for_you_service

    for_you_service._inline_paused_until = 0.0
    yield
    for_you_service._inline_paused_until = 0.0


@pytest.fixture
def user(db):
    from app.models.user import User

    db.add(User(id="uid1", username="uid1", email="u@test.com"))
    db.commit()
    return "uid1"


def watched(db, content_id, *, content_type="movie", rating=None, at=None):
    from app.models.watched import Watched

    db.add(Watched(user_id="uid1", content_type=content_type, content_id=content_id,
                   rating=rating, watched_at=at or datetime.now(timezone.utc)))
    db.commit()


# ── seed_weight ────────────────────────────────────────────────────────────


class TestSeedWeight:
    def weight(self, list_name, rating=None, at=NOW):
        from app.services.for_you_service import seed_weight
        return seed_weight(list_name, rating, at, NOW)

    def test_unrated_watched_title_counts_one(self):
        assert self.weight("watched") == 1.0

    @pytest.mark.parametrize("rating, expected", [
        (5.0, 2.0), (3.5, 1.0), (2.0, 0.0), (0.5, 0.0),
    ])
    def test_rating_scales_a_watched_title(self, rating, expected):
        assert self.weight("watched", rating) == pytest.approx(expected)

    def test_watching_counts_more_than_unrated_and_watchlist_less(self):
        assert self.weight("watching") == 1.2
        assert self.weight("watchlist") == 0.6

    def test_a_year_old_title_counts_half(self):
        assert self.weight("watched", at=NOW - timedelta(days=365)) == pytest.approx(0.5)

    def test_age_never_takes_a_title_below_a_quarter(self):
        assert self.weight("watched", at=NOW - timedelta(days=365 * 20)) == 0.25

    def test_no_date_counts_as_old(self):
        assert self.weight("watching", at=None) == pytest.approx(0.3)

    def test_naive_datetime_is_read_as_utc(self):
        assert self.weight("watched", at=NOW.replace(tzinfo=None)) == 1.0

    def test_a_date_in_the_future_counts_as_today(self):
        assert self.weight("watched", at=NOW + timedelta(days=30)) == 1.0


# ── rank ───────────────────────────────────────────────────────────────────


def seed(key, weight=1.0, list_name="watched"):
    from app.services.for_you_service import Seed
    return Seed(key, weight, list_name)


def library(*seeds):
    return {s.key: s for s in seeds}


A, B, C = ("movie", 1), ("movie", 2), ("tv", 3)
X, Y, Z = ("movie", 101), ("movie", 102), ("tv", 103)


class TestRank:
    def rank(self, seeds, lists):
        from app.services.for_you_service import rank
        return rank(seeds, lists)

    def test_a_pick_two_seeds_agree_on_outranks_one_seeds_top_pick(self):
        scores, _ = self.rank(library(seed(A), seed(B)), {A: [X, Y], B: [Z, Y]})
        assert scores[Y] > scores[X]
        assert scores[Y] > scores[Z]

    def test_score_runs_from_full_weight_at_the_top_of_a_list_to_half_at_the_end(self):
        recs = [("movie", 100 + i) for i in range(10)]
        scores, _ = self.rank(library(seed(A, weight=2.0)), {A: recs})
        assert scores[recs[0]] == pytest.approx(2.0)
        assert scores[recs[-1]] == pytest.approx(1.1)

    def test_titles_already_in_the_library_are_left_out(self):
        scores, _ = self.rank(library(seed(A), seed(B)), {A: [B, X]})
        assert B not in scores
        assert X in scores

    def test_a_seed_with_no_weight_recommends_nothing(self):
        scores, because = self.rank(library(seed(A, weight=0.0)), {A: [X]})
        assert scores == {}
        assert because == {}

    def test_a_list_for_a_title_outside_the_library_is_ignored(self):
        scores, _ = self.rank(library(seed(A)), {B: [X]})
        assert scores == {}

    def test_because_names_the_strongest_two_seeds_strongest_first(self):
        seeds = library(seed(A, weight=1.0), seed(B, weight=2.0), seed(C, weight=0.5))
        _, because = self.rank(seeds, {A: [X], B: [X], C: [X]})
        assert because[X] == [B, A]

    def test_a_watchlist_title_scores_a_pick_but_is_never_the_reason(self):
        seeds = library(seed(A, list_name="watchlist"), seed(B, list_name="watching"))
        scores, because = self.rank(seeds, {A: [X, Y], B: [Y]})
        assert X in scores
        assert X not in because
        assert because[Y] == [B]


# ── get_for_you_recommendations ────────────────────────────────────────────


class TestGetForYouRecommendations:
    def get(self, db):
        from app.services.for_you_service import get_for_you_recommendations
        return get_for_you_recommendations(db, "uid1")

    def test_empty_library_returns_empty_lists_without_asking_tmdb(self, db, user):
        with patch(TMDB_GET) as tmdb:
            assert self.get(db) == {"movies": [], "shows": [], "seed_count": 0}
        tmdb.assert_not_called()

    def test_a_pick_recommended_by_two_titles_comes_first(self, db, user):
        watched(db, 550)
        watched(db, 551)
        fake = recs_by_path({
            "/movie/550": [rec(9002), rec(9001)],
            "/movie/551": [rec(9003), rec(9001)],
        })
        with patch(TMDB_GET, side_effect=fake):
            result = self.get(db)

        assert result["movies"][0]["id"] == 9001
        assert {m["id"] for m in result["movies"]} == {9001, 9002, 9003}
        assert result["seed_count"] == 2

    def test_excludes_titles_already_on_a_list(self, db, user):
        from app.models.watchlist import Watchlist

        watched(db, 550)
        db.add(Watchlist(user_id="uid1", content_type="movie", content_id=600))
        db.commit()
        fake = recs_by_path({"/movie/550": [rec(550), rec(600), rec(999)]})
        with patch(TMDB_GET, side_effect=fake):
            result = self.get(db)

        assert [m["id"] for m in result["movies"]] == [999]

    def test_splits_movies_and_shows_in_the_shape_the_frontend_reads(self, db, user):
        watched(db, 550)
        fake = recs_by_path({"/movie/550": [
            rec(9001, label="A Film", release_date="2020-01-02", vote_average=7.1,
                backdrop_path="/b.jpg", genre_ids=[18]),
            rec(9002, tv=True, label="A Show", first_air_date="2021-03-04"),
        ]})
        with patch(TMDB_GET, side_effect=fake):
            result = self.get(db)

        assert result["movies"] == [{
            "id": 9001, "media_type": "movie", "title": "A Film", "release_date": "2020-01-02",
            "poster_path": "/9001.jpg", "backdrop_path": "/b.jpg", "vote_average": 7.1,
            "popularity": 1.0, "genre_ids": [18], "because": [],
        }]
        show = result["shows"][0]
        assert (show["id"], show["media_type"], show["name"], show["first_air_date"]) == (
            9002, "tv", "A Show", "2021-03-04"
        )
        assert "title" not in show

    def test_because_carries_the_titles_that_led_to_a_pick(self, db, user):
        from app.models.movie import Movie
        from app.models.show import Show

        db.add(Movie(id=550, title="Fight Club"))
        db.add(Show(id=1396, name="Breaking Bad"))
        watched(db, 550, rating=5.0)
        watched(db, 1396, content_type="tv")
        fake = recs_by_path({"/movie/550": [rec(9001)], "/tv/1396": [rec(9001)]})
        with patch(TMDB_GET, side_effect=fake):
            result = self.get(db)

        assert result["movies"][0]["because"] == [
            {"id": 550, "content_type": "movie", "title": "Fight Club"},
            {"id": 1396, "content_type": "tv", "title": "Breaking Bad"},
        ]

    def test_a_title_rated_two_stars_is_not_fetched_and_recommends_nothing(self, db, user):
        watched(db, 550, rating=2.0)
        with patch(TMDB_GET, side_effect=recs_by_path({"/movie/550": [rec(9001)]})) as tmdb:
            result = self.get(db)

        tmdb.assert_not_called()
        assert result == {"movies": [], "shows": [], "seed_count": 1}

    def test_stored_lists_are_reused_so_a_second_load_asks_tmdb_nothing(self, db, user):
        watched(db, 550)
        fake = recs_by_path({"/movie/550": [rec(9001)]})
        with patch(TMDB_GET, side_effect=fake) as tmdb:
            first = self.get(db)
            second = self.get(db)

        assert tmdb.call_count == 1
        assert second == first

    def test_a_load_with_every_list_stored_takes_three_queries(self, db, user):
        from sqlalchemy import event
        from app.models.movie import Movie

        db.add(Movie(id=550, title="Fight Club"))
        watched(db, 550)
        watched(db, 1396, content_type="tv")
        fake = recs_by_path({"/movie/550": [rec(9001)], "/tv/1396": [rec(9002, tv=True)]})
        with patch(TMDB_GET, side_effect=fake):
            self.get(db)

        statements = []
        engine = db.get_bind()
        listener = lambda *args: statements.append(args[2])  # noqa: E731
        event.listen(engine, "before_cursor_execute", listener)
        try:
            # The library with its lists, the picks' display rows, the reasons' titles.
            result = self.get(db)
        finally:
            event.remove(engine, "before_cursor_execute", listener)

        assert len(statements) == 3
        assert result["movies"][0]["because"][0]["title"] == "Fight Club"

    def test_one_load_fetches_at_most_twenty_missing_lists_heaviest_first(self, db, user):
        for i in range(25):
            # Older titles weigh less, so 1000..1019 are the heaviest twenty.
            watched(db, 1000 + i, at=datetime.now(timezone.utc) - timedelta(days=30 * i))
        with patch(TMDB_GET, return_value={"results": []}) as tmdb:
            self.get(db)

        fetched = {call.args[0] for call in tmdb.call_args_list}
        assert fetched == {f"/movie/{1000 + i}/recommendations" for i in range(20)}

    def test_tmdb_failure_leaves_the_page_empty_and_the_title_due_for_retry(self, db, user):
        from app.models.title_recs import TitleRecs

        watched(db, 550)
        with patch(TMDB_GET, side_effect=RuntimeError("boom")):
            assert self.get(db) == {"movies": [], "shows": [], "seed_count": 1}
        assert db.query(TitleRecs).count() == 0

    def test_after_a_failed_fetch_page_loads_stop_asking_tmdb_for_a_while(self, db, user):
        from app.services import for_you_service

        watched(db, 550)
        with patch(TMDB_GET, side_effect=RuntimeError("boom")) as tmdb:
            self.get(db)
            self.get(db)
        assert tmdb.call_count == 1

        # Once the pause is over the title is fetched and its picks appear.
        for_you_service._inline_paused_until = 0.0
        with patch(TMDB_GET, side_effect=recs_by_path({"/movie/550": [rec(9001)]})):
            assert [m["id"] for m in self.get(db)["movies"]] == [9001]

    def test_a_slow_tmdb_holds_the_page_no_longer_than_the_fetch_window(self, db, user, monkeypatch):
        import threading
        from app.services import for_you_service

        monkeypatch.setattr(for_you_service, "_INLINE_FETCH_SECONDS", 0.2)
        watched(db, 550)
        watched(db, 551)
        release = threading.Event()

        def fake_get(path, params=None):
            if path.startswith("/movie/551/"):
                release.wait(10)  # TMDb hanging on this one
            return {"results": [rec(9001 if "/550/" in path else 9002)]}

        try:
            with patch(TMDB_GET, side_effect=fake_get):
                result = self.get(db)
        finally:
            release.set()

        assert [m["id"] for m in result["movies"]] == [9001]
        assert for_you_service._inline_paused_until > 0

    def test_a_title_on_two_lists_counts_once_by_the_list_that_says_most(self, db, user):
        from app.models.watchlist import Watchlist
        from app.services.title_recs_service import store_recs

        # Rated 2 stars and still on the watchlist: the rating wins, so it recommends nothing.
        watched(db, 550, rating=2.0)
        db.add(Watchlist(user_id="uid1", content_type="movie", content_id=550))
        store_recs(db, {("movie", 550): [rec(9001)]}, datetime.now(timezone.utc))
        db.commit()

        assert self.get(db) == {"movies": [], "shows": [], "seed_count": 1}

    def test_storing_failure_is_swallowed(self, db, user):
        watched(db, 550)
        with patch("app.services.for_you_service.fetch_and_store", side_effect=RuntimeError("db")):
            assert self.get(db) == {"movies": [], "shows": [], "seed_count": 1}

    def test_popularity_orders_picks_the_library_scores_the_same(self, db, user):
        watched(db, 550)
        watched(db, 551)
        # Same position in two equally weighted single-item lists: a dead heat.
        now = datetime.now(timezone.utc)
        from app.services.title_recs_service import store_recs
        store_recs(db, {
            ("movie", 550): [rec(9001, popularity=5.0)],
            ("movie", 551): [rec(9002, popularity=50.0)],
        }, now)
        db.commit()
        # Equal weights need equal watch dates.
        from app.models.watched import Watched
        db.query(Watched).update({"watched_at": now})
        db.commit()

        with patch(TMDB_GET) as tmdb:
            result = self.get(db)

        tmdb.assert_not_called()
        assert [m["id"] for m in result["movies"]] == [9002, 9001]

    def test_returns_at_most_forty_per_type(self, db, user):
        watched(db, 550)
        fake = recs_by_path({"/movie/550": [rec(9000 + i) for i in range(60)]})
        with patch(TMDB_GET, side_effect=fake):
            result = self.get(db)

        assert [m["id"] for m in result["movies"]] == [9000 + i for i in range(40)]

    def test_another_users_library_does_not_feed_these_picks(self, db, user):
        from app.models.user import User
        from app.models.watched import Watched

        db.add(User(id="uid2", username="uid2", email="u2@test.com"))
        db.add(Watched(user_id="uid2", content_type="movie", content_id=777,
                       watched_at=datetime.now(timezone.utc)))
        db.commit()
        watched(db, 550)
        fake = recs_by_path({"/movie/550": [rec(9001)], "/movie/777": [rec(9002)]})
        with patch(TMDB_GET, side_effect=fake) as tmdb:
            result = self.get(db)

        assert [m["id"] for m in result["movies"]] == [9001]
        assert [call.args[0] for call in tmdb.call_args_list] == ["/movie/550/recommendations"]
