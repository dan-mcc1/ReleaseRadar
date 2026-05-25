"""
Tests for app.services.collection_service helpers + the /collections routes
that use them.

Focuses on the DB-backed functions (browse, search, stats, watch status,
rankings, overview). get_collection_detail is just a TMDb passthrough and
is tested via mock at the endpoint layer.
"""

from datetime import date, timedelta
from unittest.mock import patch

import pytest


# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture
def seed_collection(db):
    """One collection (id=10) with three parts: two released, one upcoming."""
    from app.models.collection import Collection, CollectionMovie
    from app.models.movie import Movie

    c = Collection(
        id=10,
        name="The Test Trilogy",
        poster_path="/poster.jpg",
        backdrop_path="/backdrop.jpg",
        size=3,
        avg_rating=7.5,
        popularity=80.0,
        min_year=2010,
        max_year=2022,
    )
    today = date.today()
    m1 = Movie(
        id=101, title="Part One", status="Released",
        release_date=today - timedelta(days=365 * 5),
        runtime=120, tracking_count=0, vote_average=7.0,
        budget=100_000_000, revenue=300_000_000,
    )
    m2 = Movie(
        id=102, title="Part Two", status="Released",
        release_date=today - timedelta(days=365 * 2),
        runtime=140, tracking_count=0, vote_average=8.0,
        budget=120_000_000, revenue=400_000_000,
    )
    m3 = Movie(
        id=103, title="Part Three", status="Post Production",
        release_date=today + timedelta(days=365),
        runtime=None, tracking_count=0, vote_average=0.0,
        budget=0, revenue=0,
    )
    db.add_all([c, m1, m2, m3])
    db.flush()
    db.add_all([
        CollectionMovie(collection_id=10, movie_id=101, sort_order=1),
        CollectionMovie(collection_id=10, movie_id=102, sort_order=2),
        CollectionMovie(collection_id=10, movie_id=103, sort_order=3),
    ])
    db.commit()
    return c


@pytest.fixture
def user_and_collection(db, seed_collection):
    from app.models.user import User
    db.add(User(id="test-uid-1", username="alice", email="a@test.com"))
    db.commit()
    return seed_collection


# ── Search ────────────────────────────────────────────────────────────────


class TestSearchCollections:
    def test_empty_query_returns_empty(self, db, seed_collection):
        from app.services.collection_service import search_collections
        assert search_collections(db, "   ") == []

    def test_partial_match_returns_collection(self, db, seed_collection):
        from app.services.collection_service import search_collections
        results = search_collections(db, "trilogy")
        assert len(results) == 1
        assert results[0].id == 10

    def test_no_match_returns_empty(self, db, seed_collection):
        from app.services.collection_service import search_collections
        assert search_collections(db, "nonexistent") == []


# ── Stats ─────────────────────────────────────────────────────────────────


class TestGetCollectionStats:
    def test_unknown_collection_returns_none(self, db):
        from app.services.collection_service import get_collection_stats
        assert get_collection_stats(db, 99999) is None

    def test_aggregates_basic_stats(self, db, seed_collection):
        from app.services.collection_service import get_collection_stats
        stats = get_collection_stats(db, 10)
        assert stats["collection_id"] == 10
        assert stats["count"] == 3
        # Only m1+m2 have nonzero ratings; avg = (7.0 + 8.0) / 2 = 7.5
        assert stats["avg_rating"] == 7.5
        assert stats["highest_rating"] == 8.0
        assert stats["lowest_rating"] == 7.0
        # avg_budget over nonzero budgets: (100M + 120M) / 2 = 110M
        assert stats["avg_budget"] == 110_000_000
        assert stats["total_budget"] == 220_000_000
        assert stats["total_revenue"] == 700_000_000


# ── Watch status (single + bulk) ──────────────────────────────────────────


class TestGetWatchStatus:
    def test_unknown_collection_returns_none(self, db):
        from app.services.collection_service import get_watch_status
        assert get_watch_status(db, "test-uid-1", 99999) is None

    def test_no_watched_parts(self, db, user_and_collection):
        from app.services.collection_service import get_watch_status
        s = get_watch_status(db, "test-uid-1", 10)
        assert s["total_parts"] == 3
        assert s["released_parts"] == 2  # m3 is upcoming
        assert s["watched_parts"] == 0
        assert s["finished"] is False

    def test_watched_one_released_part(self, db, user_and_collection):
        from app.models.watched import Watched
        from app.services.collection_service import get_watch_status
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=101))
        db.commit()

        s = get_watch_status(db, "test-uid-1", 10)
        assert s["watched_parts"] == 1
        assert s["finished"] is False
        assert s["watched_movie_ids"] == [101]

    def test_finished_when_all_released_parts_watched(self, db, user_and_collection):
        from app.models.watched import Watched
        from app.services.collection_service import get_watch_status
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=101))
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=102))
        db.commit()

        s = get_watch_status(db, "test-uid-1", 10)
        assert s["finished"] is True


class TestGetWatchStatusBulk:
    def test_empty_input_returns_empty(self, db):
        from app.services.collection_service import get_watch_status_bulk
        assert get_watch_status_bulk(db, "test-uid-1", []) == {}

    def test_returns_aggregates_for_each_collection(self, db, user_and_collection):
        from app.models.watched import Watched
        from app.services.collection_service import get_watch_status_bulk
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=101))
        db.commit()

        out = get_watch_status_bulk(db, "test-uid-1", [10, 99999])
        # Unknown collection IDs are omitted, not included with zero counts
        assert 99999 not in out
        assert out[10]["total_parts"] == 3
        assert out[10]["released_parts"] == 2
        assert out[10]["watched_parts"] == 1
        assert out[10]["finished"] is False


# ── Rankings ──────────────────────────────────────────────────────────────


class TestRankings:
    def test_get_rankings_empty(self, db, user_and_collection):
        from app.services.collection_service import get_rankings
        assert get_rankings(db, "test-uid-1", 10) == []

    def test_set_then_get_rankings(self, db, user_and_collection):
        from app.services.collection_service import set_rankings, get_rankings
        result = set_rankings(db, "test-uid-1", 10, [103, 101, 102])
        assert result == [
            {"movie_id": 103, "rank": 1},
            {"movie_id": 101, "rank": 2},
            {"movie_id": 102, "rank": 3},
        ]
        assert get_rankings(db, "test-uid-1", 10) == result

    def test_set_rankings_replaces_existing(self, db, user_and_collection):
        from app.services.collection_service import set_rankings
        set_rankings(db, "test-uid-1", 10, [101, 102, 103])
        result = set_rankings(db, "test-uid-1", 10, [102, 101])
        assert [r["movie_id"] for r in result] == [102, 101]

    def test_unknown_collection_raises(self, db, user_and_collection):
        from app.services.collection_service import set_rankings
        with pytest.raises(ValueError) as exc:
            set_rankings(db, "test-uid-1", 99999, [101])
        assert "collection_not_found" in str(exc.value)

    def test_movie_not_in_collection_raises(self, db, user_and_collection):
        from app.services.collection_service import set_rankings
        with pytest.raises(ValueError) as exc:
            set_rankings(db, "test-uid-1", 10, [999])
        assert "movie_999_not_in_collection" in str(exc.value)


# ── Browse ────────────────────────────────────────────────────────────────


@pytest.fixture
def multi_collections(db):
    """Three collections with varying size/rating/year for filter+sort tests."""
    from app.models.collection import Collection
    c1 = Collection(id=1, name="Apple", size=3, avg_rating=8.0, popularity=50.0,
                    min_year=2000, max_year=2010, poster_path="/a.jpg")
    c2 = Collection(id=2, name="Banana", size=5, avg_rating=6.5, popularity=80.0,
                    min_year=1990, max_year=2005, poster_path="/b.jpg")
    c3 = Collection(id=3, name="Cherry", size=2, avg_rating=9.0, popularity=30.0,
                    min_year=2015, max_year=2022, poster_path=None)
    db.add_all([c1, c2, c3])
    db.commit()
    return [c1, c2, c3]


class TestBrowseCollections:
    def test_default_returns_all_sorted_by_name(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db)
        assert result["total"] == 3
        names = [r["name"] for r in result["results"]]
        # Collections with posters come first, then by name
        assert "Cherry" in names
        # Apple & Banana have posters, Cherry doesn't → poster-having first
        assert names.index("Apple") < names.index("Cherry")
        assert names.index("Banana") < names.index("Cherry")

    def test_sort_by_size(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db, sort="size")
        sizes = [r["size"] for r in result["results"]]
        assert sizes == sorted(sizes, reverse=True)

    def test_sort_by_rating(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db, sort="rating")
        assert result["results"][0]["name"] == "Cherry"  # 9.0

    def test_sort_by_popularity(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db, sort="popularity")
        assert result["results"][0]["name"] == "Banana"  # 80.0

    def test_sort_by_latest(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db, sort="latest")
        assert result["results"][0]["name"] == "Cherry"  # max_year 2022

    def test_sort_by_earliest(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db, sort="earliest")
        assert result["results"][0]["name"] == "Banana"  # min_year 1990

    def test_filter_by_min_size(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db, min_size=4)
        assert result["total"] == 1
        assert result["results"][0]["name"] == "Banana"

    def test_filter_by_max_size(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db, max_size=2)
        assert result["total"] == 1
        assert result["results"][0]["name"] == "Cherry"

    def test_filter_by_min_rating(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        result = browse_collections(db, min_rating=8.5)
        assert result["total"] == 1
        assert result["results"][0]["name"] == "Cherry"

    def test_filter_by_year_range(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        # year_from=2010: keeps collections whose max_year >= 2010
        result = browse_collections(db, year_from=2010)
        names = {r["name"] for r in result["results"]}
        assert names == {"Apple", "Cherry"}

    def test_pagination_respects_page_size(self, db, multi_collections):
        from app.services.collection_service import browse_collections
        page1 = browse_collections(db, page_size=2, page=1)
        page2 = browse_collections(db, page_size=2, page=2)
        assert len(page1["results"]) == 2
        assert len(page2["results"]) == 1
        # Total reflects unfiltered count, not page length
        assert page1["total"] == 3
        assert page2["total"] == 3


# ── User overview ─────────────────────────────────────────────────────────


class TestGetUserCollectionOverview:
    def test_empty_user_returns_empty_buckets(self, db, user_and_collection):
        from app.services.collection_service import get_user_collection_overview
        result = get_user_collection_overview(db, "test-uid-1")
        assert result == {"favorites": [], "finished": [], "in_progress": []}

    def test_favorites_listed(self, db, user_and_collection):
        from app.models.favorite import Favorite
        from app.services.collection_service import get_user_collection_overview
        db.add(Favorite(user_id="test-uid-1", content_type="collection",
                        content_id=10))
        db.commit()

        result = get_user_collection_overview(db, "test-uid-1")
        assert len(result["favorites"]) == 1
        assert result["favorites"][0]["id"] == 10

    def test_in_progress_after_watching_one_part(
        self, db, user_and_collection
    ):
        from app.models.watched import Watched
        from app.services.collection_service import get_user_collection_overview
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=101))
        db.commit()

        result = get_user_collection_overview(db, "test-uid-1")
        assert len(result["in_progress"]) == 1
        assert result["in_progress"][0]["id"] == 10
        assert result["finished"] == []

    def test_finished_when_all_released_parts_watched(
        self, db, user_and_collection
    ):
        from app.models.watched import Watched
        from app.services.collection_service import get_user_collection_overview
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=101))
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=102))
        db.commit()

        result = get_user_collection_overview(db, "test-uid-1")
        assert len(result["finished"]) == 1
        assert result["finished"][0]["id"] == 10
        assert result["in_progress"] == []


# ── List genres in collections ────────────────────────────────────────────


class TestListGenresInCollections:
    def test_returns_genres_with_collection_counts(self, db, seed_collection):
        from app.models.genre import Genre, MovieGenre
        from app.services.collection_service import list_genres_in_collections

        action = Genre(id=28, name="Action")
        drama = Genre(id=18, name="Drama")
        db.add_all([action, drama])
        db.flush()
        db.add_all([
            MovieGenre(movie_id=101, genre_id=28),
            MovieGenre(movie_id=102, genre_id=28),
            MovieGenre(movie_id=102, genre_id=18),
        ])
        db.commit()

        result = list_genres_in_collections(db)
        # Both genres appear in collection 10 → collection_count = 1 each
        by_name = {g["name"]: g for g in result}
        assert "Action" in by_name
        assert "Drama" in by_name
        assert by_name["Action"]["collection_count"] == 1
        assert by_name["Drama"]["collection_count"] == 1


# ── Endpoint smoke tests ──────────────────────────────────────────────────


class TestCollectionEndpoints:
    def test_my_collections_endpoint(self, client, seed_users, seed_collection):
        r = client.get("/collections/mine")
        assert r.status_code == 200
        assert "favorites" in r.json()

    def test_browse_endpoint(self, client, seed_collection):
        r = client.get("/collections/browse")
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_browse_rejects_bad_sort(self, client):
        r = client.get("/collections/browse?sort=invalid")
        assert r.status_code == 422

    def test_search_endpoint(self, client, seed_collection):
        r = client.get("/collections/search?query=trilogy")
        assert r.status_code == 200
        assert len(r.json()["results"]) == 1

    def test_collection_detail_calls_tmdb(self, client, seed_collection):
        with patch(
            "app.services.collection_service.tmdb_get_collection",
            return_value={"id": 10, "name": "TMDB Name", "parts": []},
        ):
            r = client.get("/collections/10")
            assert r.status_code == 200
            assert r.json()["name"] == "TMDB Name"

    def test_collection_detail_404(self, client):
        with patch(
            "app.services.collection_service.tmdb_get_collection",
            return_value=None,
        ):
            r = client.get("/collections/99999")
            assert r.status_code == 404

    def test_stats_endpoint(self, client, seed_collection):
        r = client.get("/collections/10/stats")
        assert r.status_code == 200
        assert r.json()["count"] == 3

    def test_status_endpoint(self, client, seed_users, seed_collection):
        r = client.get("/collections/10/status")
        assert r.status_code == 200
        assert r.json()["total_parts"] == 3

    def test_status_bulk_endpoint(self, client, seed_users, seed_collection):
        r = client.post("/collections/status/bulk", json={"collection_ids": [10]})
        assert r.status_code == 200
        assert "10" in r.json()

    def test_status_bulk_empty_returns_empty(self, client, seed_users):
        r = client.post("/collections/status/bulk", json={"collection_ids": []})
        assert r.json() == {}

    def test_ranking_get_endpoint(self, client, seed_users, seed_collection):
        r = client.get("/collections/10/ranking")
        assert r.status_code == 200
        assert r.json() == {"ranking": []}

    def test_ranking_put_endpoint(self, client, seed_users, seed_collection):
        r = client.put("/collections/10/ranking",
                       json={"ordered_movie_ids": [102, 101]})
        assert r.status_code == 200
        assert [r["movie_id"] for r in r.json()["ranking"]] == [102, 101]

    def test_ranking_put_unknown_collection_404(self, client, seed_users):
        r = client.put("/collections/99999/ranking",
                       json={"ordered_movie_ids": [1]})
        assert r.status_code == 404

    def test_ranking_put_invalid_movie_400(
        self, client, seed_users, seed_collection
    ):
        r = client.put("/collections/10/ranking",
                       json={"ordered_movie_ids": [999]})
        assert r.status_code == 400
