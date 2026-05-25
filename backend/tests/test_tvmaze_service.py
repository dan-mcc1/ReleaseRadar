"""Tests for app.services.tvmaze_service — TVmaze air-time lookup."""

from unittest.mock import MagicMock, patch

import requests


def _resp(ok=True, json_data=None):
    r = MagicMock()
    r.ok = ok
    r.json.return_value = json_data if json_data is not None else []
    return r


class TestFetchShowAirTime:
    def test_request_failure_returns_none_none(self):
        from app.services.tvmaze_service import fetch_show_air_time
        with patch(
            "app.services.tvmaze_service.requests.get",
            return_value=_resp(ok=False),
        ):
            assert fetch_show_air_time("foo") == (None, None)

    def test_no_results_returns_none_none(self):
        from app.services.tvmaze_service import fetch_show_air_time
        with patch(
            "app.services.tvmaze_service.requests.get",
            return_value=_resp(json_data=[]),
        ):
            assert fetch_show_air_time("foo") == (None, None)

    def test_extracts_air_time_and_network_timezone(self):
        from app.services.tvmaze_service import fetch_show_air_time
        data = [{
            "show": {
                "schedule": {"time": "21:00"},
                "network": {"country": {"timezone": "America/New_York"}},
                "webChannel": None,
            }
        }]
        with patch(
            "app.services.tvmaze_service.requests.get",
            return_value=_resp(json_data=data),
        ):
            assert fetch_show_air_time("foo") == ("21:00", "America/New_York")

    def test_falls_back_to_webchannel(self):
        from app.services.tvmaze_service import fetch_show_air_time
        data = [{
            "show": {
                "schedule": {"time": "20:00"},
                "network": None,
                "webChannel": {"country": {"timezone": "Europe/London"}},
            }
        }]
        with patch(
            "app.services.tvmaze_service.requests.get",
            return_value=_resp(json_data=data),
        ):
            assert fetch_show_air_time("foo") == ("20:00", "Europe/London")

    def test_no_country_returns_none_timezone(self):
        from app.services.tvmaze_service import fetch_show_air_time
        data = [{
            "show": {
                "schedule": {"time": "09:00"},
                "network": {"country": None},
                "webChannel": {"country": None},
            }
        }]
        with patch(
            "app.services.tvmaze_service.requests.get",
            return_value=_resp(json_data=data),
        ):
            assert fetch_show_air_time("foo") == ("09:00", None)

    def test_empty_schedule_time(self):
        from app.services.tvmaze_service import fetch_show_air_time
        data = [{
            "show": {
                "schedule": {"time": ""},
                "network": {"country": {"timezone": "UTC"}},
                "webChannel": None,
            }
        }]
        with patch(
            "app.services.tvmaze_service.requests.get",
            return_value=_resp(json_data=data),
        ):
            air_time, tz = fetch_show_air_time("foo")
        assert air_time is None
        assert tz == "UTC"

    def test_exception_returns_none_none(self):
        from app.services.tvmaze_service import fetch_show_air_time
        with patch(
            "app.services.tvmaze_service.requests.get",
            side_effect=requests.RequestException("boom"),
        ):
            assert fetch_show_air_time("foo") == (None, None)

    def test_passes_query_param(self):
        from app.services.tvmaze_service import fetch_show_air_time
        with patch(
            "app.services.tvmaze_service.requests.get",
            return_value=_resp(json_data=[]),
        ) as m:
            fetch_show_air_time("the office")
        assert m.call_args.kwargs["params"] == {"q": "the office"}
        assert "search/shows" in m.call_args[0][0]
