"""Tests for app.routers.news — thin wrapper over the news service."""

from unittest.mock import patch


class TestNewsEndpoint:
    def test_default_dispatches_to_entertainment(self, client):
        with patch(
            "app.routers.news.get_entertainment_news",
            return_value={"articles": ["e"], "totalResults": 1},
        ) as m, patch("app.routers.news.get_movie_news") as mm, patch(
            "app.routers.news.get_tv_news"
        ) as mt, patch(
            "app.routers.news.search_news"
        ) as ms:
            r = client.get("/news/")
        assert r.status_code == 200
        m.assert_called_once_with(1, 20)
        mm.assert_not_called()
        mt.assert_not_called()
        ms.assert_not_called()
        assert r.json()["articles"] == ["e"]

    def test_movies_category_dispatches_to_movie_news(self, client):
        with patch(
            "app.routers.news.get_movie_news",
            return_value={"articles": ["m"]},
        ) as m, patch("app.routers.news.get_entertainment_news") as me:
            r = client.get("/news/?category=movies&page=2&page_size=5")
        m.assert_called_once_with(2, 5)
        me.assert_not_called()
        assert r.json()["articles"] == ["m"]

    def test_tv_category_dispatches_to_tv_news(self, client):
        with patch(
            "app.routers.news.get_tv_news",
            return_value={"articles": ["t"]},
        ) as m:
            r = client.get("/news/?category=tv")
        m.assert_called_once_with(1, 20)
        assert r.json()["articles"] == ["t"]

    def test_query_param_routes_to_search(self, client):
        with patch(
            "app.routers.news.search_news",
            return_value={"articles": ["s"]},
        ) as m, patch(
            "app.routers.news.get_entertainment_news"
        ) as me:
            # Query string takes precedence over category
            r = client.get("/news/?q=dune&category=tv")
        m.assert_called_once_with("dune", 1, 20)
        me.assert_not_called()
        assert r.json()["articles"] == ["s"]

    def test_page_lower_bound_rejected(self, client):
        r = client.get("/news/?page=0")
        assert r.status_code == 422

    def test_page_size_upper_bound_rejected(self, client):
        r = client.get("/news/?page_size=100")
        assert r.status_code == 422
