"""Tests for app.services.tvmaze_service — TVmaze air-time lookup.

Shows are matched by TVDB / IMDb id (from TMDb's external_ids). A plain name
search returned the most popular show with that name — e.g. the UK "Ghosts"
for the US one — and episode pushes then went out at the wrong time.
"""

from unittest.mock import MagicMock, patch

import requests

from app.services.tvmaze_service import fetch_show_air_time


def _resp(ok=True, json_data=None):
    r = MagicMock()
    r.ok = ok
    r.json.return_value = json_data
    return r


def _tvmaze_show(name="Ghosts", premiered="2021-10-07", time="20:30",
                 tz="America/New_York", web_tz=None):
    return {
        "name": name,
        "premiered": premiered,
        "schedule": {"time": time},
        "network": {"country": {"timezone": tz}} if tz else None,
        "webChannel": {"country": {"timezone": web_tz}} if web_tz else None,
    }


US_GHOSTS = {"name": "Ghosts", "first_air_date": "2021-10-07",
             "external_ids": {"tvdb_id": 397041, "imdb_id": "tt11379026"}}


class TestLookupById:
    def test_uses_the_tvdb_id(self):
        with patch("app.services.tvmaze_service.requests.get",
                   return_value=_resp(json_data=_tvmaze_show())) as get:
            assert fetch_show_air_time(US_GHOSTS) == ("20:30", "America/New_York")
        assert get.call_args_list[0].args[0].endswith("/lookup/shows")
        assert get.call_args_list[0].kwargs["params"] == {"thetvdb": 397041}

    def test_falls_back_to_the_imdb_id(self):
        show = {**US_GHOSTS, "external_ids": {"tvdb_id": None, "imdb_id": "tt11379026"}}
        with patch("app.services.tvmaze_service.requests.get",
                   return_value=_resp(json_data=_tvmaze_show())) as get:
            assert fetch_show_air_time(show) == ("20:30", "America/New_York")
        assert get.call_args_list[0].kwargs["params"] == {"imdb": "tt11379026"}

    def test_unknown_tvdb_id_tries_imdb_next(self):
        responses = [_resp(ok=False), _resp(json_data=_tvmaze_show())]
        with patch("app.services.tvmaze_service.requests.get", side_effect=responses) as get:
            assert fetch_show_air_time(US_GHOSTS) == ("20:30", "America/New_York")
        assert get.call_args_list[1].kwargs["params"] == {"imdb": "tt11379026"}


class TestNameFallback:
    """Only for shows without TVDB/IMDb ids, and only on an exact name +
    premiere-year match."""

    NO_IDS = {"name": "Ghosts", "first_air_date": "2021-10-07", "external_ids": {}}

    def test_same_name_different_show_is_rejected(self):
        uk = [{"show": _tvmaze_show(premiered="2019-04-15", time="21:00", tz="Europe/London")}]
        with patch("app.services.tvmaze_service.requests.get", return_value=_resp(json_data=uk)):
            assert fetch_show_air_time(self.NO_IDS) == (None, None)

    def test_exact_name_and_year_match_is_used(self):
        results = [
            {"show": _tvmaze_show(premiered="2019-04-15", time="21:00", tz="Europe/London")},
            {"show": _tvmaze_show()},
        ]
        with patch("app.services.tvmaze_service.requests.get",
                   return_value=_resp(json_data=results)) as get:
            assert fetch_show_air_time(self.NO_IDS) == ("20:30", "America/New_York")
        assert get.call_args.kwargs["params"] == {"q": "Ghosts"}


class TestScheduleParsing:
    def test_web_channel_timezone_when_no_network(self):
        show = _tvmaze_show(tz=None, web_tz="Europe/London", time="20:00")
        with patch("app.services.tvmaze_service.requests.get", return_value=_resp(json_data=show)):
            assert fetch_show_air_time(US_GHOSTS) == ("20:00", "Europe/London")

    def test_no_country_returns_none_timezone(self):
        show = {**_tvmaze_show(tz=None), "network": {"country": None}}
        with patch("app.services.tvmaze_service.requests.get", return_value=_resp(json_data=show)):
            assert fetch_show_air_time(US_GHOSTS) == ("20:30", None)

    def test_empty_schedule_time_is_none(self):
        show = _tvmaze_show(time="")
        with patch("app.services.tvmaze_service.requests.get", return_value=_resp(json_data=show)):
            assert fetch_show_air_time(US_GHOSTS) == (None, "America/New_York")


class TestFailures:
    def test_request_failure_returns_none_none(self):
        with patch("app.services.tvmaze_service.requests.get", return_value=_resp(ok=False)):
            assert fetch_show_air_time(US_GHOSTS) == (None, None)

    def test_exception_returns_none_none(self):
        with patch("app.services.tvmaze_service.requests.get",
                   side_effect=requests.RequestException("boom")):
            assert fetch_show_air_time(US_GHOSTS) == (None, None)
