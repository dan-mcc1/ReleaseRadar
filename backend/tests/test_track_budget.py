"""Routes that add a title or mark something watched share one rate budget per
signed-in user, so a script walking TMDb ids on one free account can't burn
the TMDb quota. Ids on those routes are bounded so an oversized one is a 422,
not a Postgres integer overflow."""

import inspect
from datetime import date

import pytest

from app.config import settings
from app.core import limiter as limiter_module
from app.dependencies.auth import get_current_user
from app.services import shelf_service
from app.routers.collections import RANKING_MAX_MOVIES
from tests.test_collection_service import seed_collection  # noqa: F401  (fixture)
from tests.test_http_cache import _dependency_calls, _routes
from tests.test_shelf_service import _add_movie, _add_user

# Every (method, path) that is on the shared budget.
COVERED = {
    ("POST", "/watch-status/set"),
    ("POST", "/watchlist/add"),
    ("POST", "/watched/add"),
    ("POST", "/currently-watching/add"),
    ("POST", "/watched-episode/add"),
    ("POST", "/watched-episode/season/add"),
    ("POST", "/shelf/{shelf_id}/items"),
    ("POST", "/rewatch/add"),
    ("POST", "/favorites/add"),
    ("POST", "/communities/{community_id}/media"),
    ("POST", "/reviews"),
    ("PUT", "/season-rating"),
    ("POST", "/recommendations/send"),
    ("PUT", "/collections/{collection_id}/ranking"),
}

MAX_INT = 2_147_483_647


@pytest.fixture
def budget_on(monkeypatch):
    monkeypatch.setattr(limiter_module.limiter, "enabled", True)
    limiter_module._public_storage.reset()
    yield
    limiter_module._public_storage.reset()


def _set_status(client):
    # Rejected after the budget check (400), so it never reaches TMDb.
    return client.post(
        "/watch-status/set",
        json={"content_type": "movie", "content_id": 550, "target": "bogus"},
    )


def _shelf_add(client):
    # 404: no such shelf, again after the budget check.
    return client.post("/shelf/999/items", json={"content_type": "movie", "content_id": 550})


class TestSharedPerUserBudget:
    def test_hits_on_different_routes_count_against_one_total(
        self, client, budget_on, monkeypatch
    ):
        monkeypatch.setattr(settings, "TRACK_RATE_LIMIT", "3/minute")
        codes = [_set_status(client).status_code, _shelf_add(client).status_code,
                 _set_status(client).status_code]
        assert codes == [400, 404, 400]
        over = _shelf_add(client)
        assert over.status_code == 429
        assert int(over.headers["retry-after"]) >= 1
        assert _set_status(client).status_code == 429

    def test_reviews_count_against_the_same_total(self, client, budget_on, monkeypatch):
        monkeypatch.setattr(settings, "TRACK_RATE_LIMIT", "2/minute")
        assert _set_status(client).status_code == 400
        review = {"content_type": "movie", "content_id": 550, "review_text": "   "}
        assert client.post("/reviews", json=review).status_code == 422  # blank text
        over = client.post("/reviews", json=review)
        assert over.status_code == 429
        assert "retry-after" in over.headers

    def test_each_user_has_their_own_budget(self, client, client2, budget_on, monkeypatch):
        monkeypatch.setattr(settings, "TRACK_RATE_LIMIT", "2/minute")
        assert [_set_status(client).status_code for _ in range(3)] == [400, 400, 429]
        # Same IP, different user: untouched by the first user's hits.
        assert [_set_status(client2).status_code for _ in range(3)] == [400, 400, 429]

    def test_budget_is_off_when_the_limiter_is_disabled(self, client, monkeypatch):
        monkeypatch.setattr(settings, "TRACK_RATE_LIMIT", "1/minute")
        assert {_set_status(client).status_code for _ in range(4)} == {400}

    def test_default_allows_a_season_of_episodes_and_more(self):
        assert settings.TRACK_RATE_LIMIT == "120/minute"


class TestEveryCoveredRouteIsWired:
    def _by_route(self):
        found = {}
        for path, methods, route in _routes():
            for method in methods:
                found[(method, path)] = route
        return found

    def test_covered_routes_use_the_shared_user_budget(self):
        routes = self._by_route()
        missing = sorted(key for key in COVERED if key not in routes)
        assert missing == []
        unwired = sorted(
            key for key in COVERED
            if limiter_module.track_budget not in list(_dependency_calls(routes[key].dependant))
        )
        assert unwired == []

    def test_budget_is_keyed_by_the_authenticated_user_not_the_ip(self):
        params = inspect.signature(limiter_module.track_budget).parameters
        assert list(params) == ["uid"]
        assert params["uid"].default.dependency is get_current_user
        assert limiter_module.track_budget.rate_limit_per_user is True

    def test_nothing_else_uses_the_budget(self):
        users = sorted(
            key for key, route in self._by_route().items()
            if limiter_module.track_budget in list(_dependency_calls(route.dependant))
        )
        assert set(users) == COVERED


class TestIdBounds:
    @pytest.mark.parametrize("bad", [0, MAX_INT + 1])
    @pytest.mark.parametrize("path,body", [
        ("/watch-status/set", {"content_type": "movie", "target": "Watched"}),
        ("/watchlist/add", {"content_type": "movie"}),
        ("/watched/add", {"content_type": "movie"}),
        ("/currently-watching/add", {"content_type": "movie"}),
        ("/favorites/add", {"content_type": "movie"}),
        ("/rewatch/add", {"content_type": "movie"}),
        ("/shelf/1/items", {"content_type": "movie"}),
        ("/communities/1/media", {"content_type": "movie"}),
    ])
    def test_bad_content_id_is_422(self, client, path, body, bad):
        assert client.post(path, json={**body, "content_id": bad}).status_code == 422

    @pytest.mark.parametrize("params", [
        {"show_id": MAX_INT + 1, "season_number": 1, "episode_number": 1},
        {"show_id": 0, "season_number": 1, "episode_number": 1},
        {"show_id": 1, "season_number": 10_001, "episode_number": 1},
        {"show_id": 1, "season_number": 1, "episode_number": 10_001},
    ])
    def test_bad_episode_params_are_422(self, client, params):
        assert client.post("/watched-episode/add", params=params).status_code == 422

    def test_bad_season_params_are_422(self, client):
        for params in ({"show_id": MAX_INT + 1, "season_number": 1},
                       {"show_id": 1, "season_number": 10_001}):
            assert client.post("/watched-episode/season/add", params=params).status_code == 422

    def test_largest_valid_id_is_not_rejected_at_the_boundary(self, client):
        r = client.post("/watch-status/set", json={
            "content_type": "movie", "content_id": MAX_INT, "target": "bogus"})
        assert r.status_code == 400


class TestShelfSizeCap:
    def test_a_full_shelf_refuses_another_title(self, client, db, monkeypatch):
        monkeypatch.setattr(shelf_service, "SHELF_MAX_ITEMS", 2)
        _add_user(db)
        for mid in (1, 2, 3):
            _add_movie(db, mid=mid, title=f"M{mid}", release=date(2000, 1, 1).isoformat())
        shelf_id = client.post("/shelf", json={"name": "Favs"}).json()["id"]
        url = f"/shelf/{shelf_id}/items"
        assert client.post(url, json={"content_type": "movie", "content_id": 1}).status_code == 201
        assert client.post(url, json={"content_type": "movie", "content_id": 2}).status_code == 201
        full = client.post(url, json={"content_type": "movie", "content_id": 3})
        assert full.status_code == 400
        assert full.json()["detail"] == "A shelf can hold up to 2 titles."
        # Re-adding a title already on the shelf is still fine.
        assert client.post(url, json={"content_type": "movie", "content_id": 1}).status_code == 201

    def test_the_cap_is_5000(self):
        assert shelf_service.SHELF_MAX_ITEMS == 5_000
        assert f"{shelf_service.SHELF_MAX_ITEMS:,}" == "5,000"


class TestNewlyBudgetedRoutes:
    @pytest.mark.parametrize("bad", [0, MAX_INT + 1])
    def test_bad_ids_are_422(self, client, bad):
        assert client.post("/reviews", json={
            "content_type": "movie", "content_id": bad, "review_text": "ok"}).status_code == 422
        assert client.put("/season-rating", json={
            "show_id": bad, "season_number": 1, "rating": 4}).status_code == 422
        assert client.post("/recommendations/send", json={
            "recipient_username": "bob", "content_type": "movie",
            "content_id": bad}).status_code == 422

    def test_season_number_is_bounded(self, client):
        assert client.put("/season-rating", json={
            "show_id": 1, "season_number": 10_001, "rating": 4}).status_code == 422

    def test_unknown_show_is_404_not_500(self, client, db):
        _add_user(db)
        r = client.put("/season-rating", json={"show_id": 424242, "season_number": 1, "rating": 4})
        assert (r.status_code, r.json()["detail"]) == (404, "Show not found.")

    def test_unknown_season_is_404(self, client, db, seed_show):
        _add_user(db)
        r = client.put("/season-rating", json={"show_id": 1396, "season_number": 9, "rating": 4})
        assert (r.status_code, r.json()["detail"]) == (404, "Season not found.")

    def test_existing_season_can_be_rated(self, client, db, seed_show):
        _add_user(db)
        r = client.put("/season-rating", json={"show_id": 1396, "season_number": 1, "rating": 4})
        assert r.status_code == 200
        assert r.json()["rating"] == 4

    def test_finish_by_unknown_show_is_404(self, client):
        r = client.post("/watchlist/progress/424242/finish-by", json={"target_date": "2030-01-01"})
        assert (r.status_code, r.json()["detail"]) == (404, "Show not found.")

    def test_finish_by_oversized_show_id_is_422(self, client):
        r = client.post(f"/watchlist/progress/{MAX_INT + 1}/finish-by",
                        json={"target_date": "2030-01-01"})
        assert r.status_code == 422

    def test_external_scores_rejects_a_malformed_imdb_id(self, client):
        for bad in ("12345", "tt", "tt12345678901", "tt1abc"):
            assert client.get("/reviews/external-scores", params={"imdb_id": bad}).status_code == 422

    def test_external_scores_keeps_its_own_limit(self):
        from app.routers.reviews import get_external_scores
        # slowapi registers the decorated function under "<module>.<name>".
        assert "app.routers.reviews.get_external_scores" in limiter_module.limiter._route_limits
        assert get_external_scores


class TestRanking:
    def _url(self):
        return "/collections/10/ranking"

    def test_a_normal_ranking_succeeds(self, client, db, seed_collection):
        _add_user(db)
        r = client.put(self._url(), json={"ordered_movie_ids": [103, 101, 102]})
        assert r.status_code == 200

    def test_duplicates_are_422(self, client, db, seed_collection):
        _add_user(db)
        r = client.put(self._url(), json={"ordered_movie_ids": [101, 101]})
        assert r.status_code == 422

    def test_too_long_a_list_is_422(self, client, db, seed_collection):
        _add_user(db)
        ids = list(range(1, RANKING_MAX_MOVIES + 2))
        assert client.put(self._url(), json={"ordered_movie_ids": ids}).status_code == 422

    def test_bad_ids_and_path_are_422(self, client):
        assert client.put(self._url(), json={"ordered_movie_ids": [0]}).status_code == 422
        assert client.put(f"/collections/{MAX_INT + 1}/ranking",
                          json={"ordered_movie_ids": [1]}).status_code == 422

    def test_bulk_status_ids_are_bounded(self, client):
        r = client.post("/collections/status/bulk", json={"collection_ids": [MAX_INT + 1]})
        assert r.status_code == 422


class TestShelfCount:
    def test_creating_past_the_cap_is_refused(self, client, db, monkeypatch):
        monkeypatch.setattr(shelf_service, "MAX_SHELVES_PER_USER", 2)
        _add_user(db)
        assert client.post("/shelf", json={"name": "a"}).status_code == 200
        assert client.post("/shelf", json={"name": "b"}).status_code == 200
        r = client.post("/shelf", json={"name": "c"})
        assert (r.status_code, r.json()["detail"]) == (400, "You can have up to 2 shelves.")

    def test_the_cap_is_200(self):
        assert shelf_service.MAX_SHELVES_PER_USER == 200
