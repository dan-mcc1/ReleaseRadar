"""Tests for app.services.omdb_service — OMDb ratings fetcher."""

from unittest.mock import MagicMock, patch

import httpx
import pytest


@pytest.fixture(autouse=True)
def clear_cache():
    from app.services.omdb_service import get_omdb_scores
    get_omdb_scores.cache_clear()
    yield
    get_omdb_scores.cache_clear()


def _resp(success=True, json_data=None):
    r = MagicMock()
    r.is_success = success
    r.json.return_value = json_data or {}
    return r


class TestGetOmdbScores:
    def test_missing_api_key_returns_empty(self):
        from app.services import omdb_service
        with patch.object(omdb_service.settings, "OMDB_API_KEY", "", create=True):
            assert omdb_service.get_omdb_scores("tt1") == {}

    def test_missing_imdb_id_returns_empty(self):
        from app.services.omdb_service import get_omdb_scores
        assert get_omdb_scores("") == {}

    def test_http_failure_returns_empty(self):
        from app.services.omdb_service import get_omdb_scores
        with patch(
            "app.services.omdb_service.httpx.get",
            return_value=_resp(success=False),
        ):
            assert get_omdb_scores("tt1") == {}

    def test_response_not_true_returns_empty(self):
        from app.services.omdb_service import get_omdb_scores
        with patch(
            "app.services.omdb_service.httpx.get",
            return_value=_resp(json_data={"Response": "False"}),
        ):
            assert get_omdb_scores("tt2") == {}

    def test_extracts_all_three_ratings(self):
        from app.services.omdb_service import get_omdb_scores
        data = {
            "Response": "True",
            "Ratings": [
                {"Source": "Internet Movie Database", "Value": "8.5/10"},
                {"Source": "Rotten Tomatoes", "Value": "94%"},
                {"Source": "Metacritic", "Value": "88/100"},
                {"Source": "Unknown", "Value": "ignored"},
            ],
        }
        with patch(
            "app.services.omdb_service.httpx.get",
            return_value=_resp(json_data=data),
        ):
            result = get_omdb_scores("tt3")
        assert result == {
            "imdb": "8.5/10",
            "rotten_tomatoes": "94%",
            "metacritic": "88/100",
        }

    def test_missing_ratings_returns_empty_dict(self):
        from app.services.omdb_service import get_omdb_scores
        with patch(
            "app.services.omdb_service.httpx.get",
            return_value=_resp(json_data={"Response": "True"}),
        ):
            assert get_omdb_scores("tt4") == {}

    def test_exception_caught_returns_empty(self):
        from app.services.omdb_service import get_omdb_scores
        with patch(
            "app.services.omdb_service.httpx.get",
            side_effect=httpx.RequestError("boom"),
        ):
            assert get_omdb_scores("tt5") == {}

    def test_call_url_and_params(self):
        from app.services.omdb_service import get_omdb_scores
        with patch(
            "app.services.omdb_service.httpx.get",
            return_value=_resp(json_data={"Response": "True", "Ratings": []}),
        ) as m:
            get_omdb_scores("tt6")
        assert m.call_args[0][0] == "https://www.omdbapi.com/"
        assert m.call_args.kwargs["params"]["i"] == "tt6"
