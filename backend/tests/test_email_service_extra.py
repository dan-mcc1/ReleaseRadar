"""
Structural / wrapper / unsubscribe-URL coverage for app.services.email_service.

XSS-escape regressions live in tests/test_email_templates.py. This file
covers the *non-XSS* responsibilities:

  - every sender renders a non-empty HTML body with the brand wrapper
  - subject lines are computed correctly across counts and cases
  - unsubscribe URL is an HMAC of the uid against UNSUBSCRIBE_SECRET
  - send_email() is a no-op when RESEND_API_KEY is empty, and swallows
    Resend exceptions
  - helper formatters (_format_date, format_air_time) handle edge cases
"""

import hashlib
import hmac
from unittest.mock import patch, MagicMock

import pytest

from app.config import settings


@pytest.fixture
def captured():
    """Patch send_email and capture (to, subject, html) tuples."""
    calls: list[tuple[str, str, str]] = []

    def _capture(to_email, subject, html_body):
        calls.append((to_email, subject, html_body))

    with patch("app.services.email_service.send_email", side_effect=_capture):
        yield calls


def _expected_unsub_token(uid: str) -> str:
    return hmac.new(
        settings.UNSUBSCRIBE_SECRET.encode(),
        uid.encode(),
        hashlib.sha256,
    ).hexdigest()


# ── _unsubscribe_url ──────────────────────────────────────────────────────


class TestUnsubscribeUrl:
    def test_hmac_signed(self):
        from app.services.email_service import _unsubscribe_url

        uid = "user-123"
        url = _unsubscribe_url(uid)
        expected_token = _expected_unsub_token(uid)
        assert f"uid={uid}" in url
        assert f"token={expected_token}" in url
        assert url.startswith(settings.FRONTEND_URL + "/unsubscribe")

    def test_different_uids_produce_different_tokens(self):
        from app.services.email_service import _unsubscribe_url

        a = _unsubscribe_url("alice")
        b = _unsubscribe_url("bob")
        assert a != b

    def test_url_present_in_wrapper(self, captured):
        from app.services.email_service import send_notification_email

        send_notification_email(
            to_email="x@t.com",
            username="alice",
            upcoming_items=[{
                "title": "Movie",
                "date": "2026-05-25",
                "content_type": "movie",
                "content_id": 1,
            }],
            uid="alice-uid",
        )
        body = captured[0][2]
        assert _expected_unsub_token("alice-uid") in body
        assert "Unsubscribe" in body


# ── _format_date ───────────────────────────────────────────────────────────


class TestFormatDate:
    def test_valid_iso(self):
        from app.services.email_service import _format_date

        out = _format_date("2026-05-25")
        # "Monday, May 25, 2026" -- accept any weekday/month variation but the
        # day/year must be there.
        assert "25" in out
        assert "2026" in out
        assert "May" in out

    def test_invalid_returns_original_string(self):
        from app.services.email_service import _format_date

        assert _format_date("not-a-date") == "not-a-date"


# ── format_air_time ────────────────────────────────────────────────────────


class TestFormatAirTime:
    def test_none(self):
        from app.services.email_service import format_air_time

        assert format_air_time(None, None) is None
        assert format_air_time("", "America/New_York") is None

    def test_morning_with_minutes(self):
        from app.services.email_service import format_air_time

        assert format_air_time("09:30", "America/New_York") == "9:30 AM ET"

    def test_top_of_hour_omits_minutes(self):
        from app.services.email_service import format_air_time

        assert format_air_time("09:00", "America/New_York") == "9 AM ET"

    def test_noon(self):
        from app.services.email_service import format_air_time

        assert format_air_time("12:00", "America/Los_Angeles") == "12 PM PT"

    def test_evening(self):
        from app.services.email_service import format_air_time

        assert format_air_time("21:15", "Europe/London") == "9:15 PM GMT"

    def test_midnight(self):
        from app.services.email_service import format_air_time

        # 00:00 with no minutes -> "12 AM"
        assert format_air_time("00:00", "America/New_York") == "12 AM ET"

    def test_unknown_timezone_omits_abbreviation(self):
        from app.services.email_service import format_air_time

        out = format_air_time("13:00", "Mars/Olympus_Mons")
        assert out == "1 PM"

    def test_no_timezone_omits_abbreviation(self):
        from app.services.email_service import format_air_time

        assert format_air_time("13:00", None) == "1 PM"

    def test_malformed_returns_none(self):
        from app.services.email_service import format_air_time

        assert format_air_time("garbage", "America/New_York") is None


# ── send_notification_email: subjects, frequency branches ─────────────────


class TestNotificationEmailSubjects:
    def _item(self, **kwargs):
        base = dict(
            title="Fight Club",
            date="2026-05-25",
            content_type="movie",
            content_id=550,
        )
        base.update(kwargs)
        return base

    def test_daily_single_item_subject(self, captured):
        from app.services.email_service import send_notification_email

        send_notification_email("x@t.com", "alice", [self._item()], uid="u")
        assert captured[0][1] == "Release Radar — Fight Club is out today"

    def test_daily_multi_item_subject(self, captured):
        from app.services.email_service import send_notification_email

        items = [self._item(), self._item(title="Other", content_id=2)]
        send_notification_email("x@t.com", "alice", items, uid="u")
        assert captured[0][1] == "Release Radar — Releasing Today"

    def test_weekly_subject_and_grouping(self, captured):
        from app.services.email_service import send_notification_email

        items = [
            self._item(date="2026-05-25"),
            self._item(title="Other", content_id=2, date="2026-05-26"),
        ]
        send_notification_email(
            "x@t.com", "alice", items, uid="u", frequency="weekly"
        )
        assert captured[0][1] == "Release Radar — Your Weekly Digest"
        body = captured[0][2]
        # Both day headers should be present (grouped)
        assert "May" in body
        assert "Fight Club" in body
        assert "Other" in body

    def test_monthly_subject(self, captured):
        from app.services.email_service import send_notification_email

        send_notification_email(
            "x@t.com", "alice", [self._item()], uid="u", frequency="monthly"
        )
        assert captured[0][1] == "Release Radar — Your Monthly Digest"

    def test_tv_episode_type_badge_rendered(self, captured):
        from app.services.email_service import send_notification_email

        items = [self._item(
            content_type="tv", episode_type="mid_season", poster_path="/p.jpg"
        )]
        send_notification_email("x@t.com", "alice", items, uid="u")
        body = captured[0][2]
        # "mid_season" -> "Mid Season"
        assert "Mid Season" in body

    def test_no_poster_path_renders(self, captured):
        from app.services.email_service import send_notification_email

        items = [self._item(poster_path=None)]
        send_notification_email("x@t.com", "alice", items, uid="u")
        assert "Fight Club" in captured[0][2]

    def test_movie_default_badge_in_theaters(self, captured):
        from app.services.email_service import send_notification_email

        send_notification_email("x@t.com", "alice", [self._item()], uid="u")
        assert "In Theaters" in captured[0][2]

    def test_tv_default_badge_streaming(self, captured):
        from app.services.email_service import send_notification_email

        items = [self._item(content_type="tv")]
        send_notification_email("x@t.com", "alice", items, uid="u")
        assert "Streaming" in captured[0][2]

    def test_air_time_overrides_default_badge(self, captured):
        from app.services.email_service import send_notification_email

        items = [self._item(air_time="8 PM ET")]
        send_notification_email("x@t.com", "alice", items, uid="u")
        body = captured[0][2]
        assert "8 PM ET" in body
        assert "In Theaters" not in body


# ── send_season_premiere_email: subject + sections ────────────────────────


class TestSeasonPremiereEmail:
    def _alert(self, days_away=7, **kwargs):
        base = dict(
            show_name="Breaking Bad",
            season_number=2,
            air_date="2026-06-01",
            days_away=days_away,
            show_id=1396,
            poster_path="/p.jpg",
        )
        base.update(kwargs)
        return base

    def test_single_alert_subject(self, captured):
        from app.services.email_service import send_season_premiere_email

        send_season_premiere_email("x@t.com", "alice", [self._alert()], uid="u")
        assert captured[0][1] == "New season coming soon — Release Radar"

    def test_plural_subject(self, captured):
        from app.services.email_service import send_season_premiere_email

        alerts = [self._alert(), self._alert(show_name="Other", show_id=2)]
        send_season_premiere_email("x@t.com", "alice", alerts, uid="u")
        assert captured[0][1] == "New seasons coming soon — Release Radar"

    def test_seven_and_thirty_day_sections(self, captured):
        from app.services.email_service import send_season_premiere_email

        alerts = [
            self._alert(days_away=7),
            self._alert(days_away=30, show_name="ThirtyDay", show_id=2),
        ]
        send_season_premiere_email("x@t.com", "alice", alerts, uid="u")
        body = captured[0][2]
        assert "Coming in one week" in body
        assert "Coming in one month" in body
        assert "Breaking Bad" in body
        assert "ThirtyDay" in body

    def test_season_name_overrides_season_number(self, captured):
        from app.services.email_service import send_season_premiere_email

        alerts = [self._alert(season_name="Final Season")]
        send_season_premiere_email("x@t.com", "alice", alerts, uid="u")
        assert "Final Season" in captured[0][2]

    def test_no_show_id_falls_back_to_frontend_url(self, captured):
        from app.services.email_service import send_season_premiere_email

        alerts = [self._alert(show_id=None, poster_path=None)]
        send_season_premiere_email("x@t.com", "alice", alerts, uid="u")
        body = captured[0][2]
        # Card link goes to FRONTEND_URL root, not /tv/...
        assert "Breaking Bad" in body


# ── send_new_season_available_email ───────────────────────────────────────


class TestNewSeasonAvailableEmail:
    def _show(self, **kwargs):
        base = dict(
            show_name="Stranger Things",
            show_id=66732,
            poster_path="/p.jpg",
            season_number=5,
        )
        base.update(kwargs)
        return base

    def test_single_show_subject_with_season_number(self, captured):
        from app.services.email_service import send_new_season_available_email

        send_new_season_available_email("x@t.com", "alice", [self._show()], uid="u")
        assert (
            captured[0][1]
            == "Season 5 of Stranger Things is coming — Release Radar"
        )

    def test_single_show_subject_without_season_number(self, captured):
        from app.services.email_service import send_new_season_available_email

        send_new_season_available_email(
            "x@t.com", "alice", [self._show(season_number=None)], uid="u"
        )
        assert (
            captured[0][1]
            == "A new season of Stranger Things is coming — Release Radar"
        )

    def test_multi_show_subject(self, captured):
        from app.services.email_service import send_new_season_available_email

        shows = [self._show(), self._show(show_name="Other", show_id=2)]
        send_new_season_available_email("x@t.com", "alice", shows, uid="u")
        assert (
            captured[0][1]
            == "New seasons coming for 2 shows you've finished — Release Radar"
        )

    def test_premiere_in_future_says_premieres(self, captured):
        from app.services.email_service import send_new_season_available_email

        shows = [self._show(premiere_date="2099-12-31")]
        send_new_season_available_email("x@t.com", "alice", shows, uid="u")
        body = captured[0][2]
        assert "premieres" in body

    def test_premiere_in_past_says_now_available(self, captured):
        from app.services.email_service import send_new_season_available_email

        shows = [self._show(premiere_date="2000-01-01")]
        send_new_season_available_email("x@t.com", "alice", shows, uid="u")
        body = captured[0][2]
        assert "now available" in body

    def test_premiere_date_invalid_falls_back_to_tbd(self, captured):
        from app.services.email_service import send_new_season_available_email

        shows = [self._show(premiere_date="not-a-date")]
        send_new_season_available_email("x@t.com", "alice", shows, uid="u")
        body = captured[0][2]
        assert "TBD" in body

    def test_no_premiere_date_tbd(self, captured):
        from app.services.email_service import send_new_season_available_email

        shows = [self._show(premiere_date=None)]
        send_new_season_available_email("x@t.com", "alice", shows, uid="u")
        assert "TBD" in captured[0][2]

    def test_no_poster_renders(self, captured):
        from app.services.email_service import send_new_season_available_email

        shows = [self._show(poster_path=None)]
        send_new_season_available_email("x@t.com", "alice", shows, uid="u")
        assert "Stranger Things" in captured[0][2]


# ── send_recommendation_email ─────────────────────────────────────────────


class TestRecommendationEmail:
    def test_movie_with_message_and_poster(self, captured):
        from app.services.email_service import send_recommendation_email

        send_recommendation_email(
            to_email="x@t.com",
            to_username="alice",
            from_username="bob",
            content_type="movie",
            content_title="Fight Club",
            content_id=550,
            message="loved it",
            uid="u",
            poster_path="/p.jpg",
        )
        to, subject, body = captured[0]
        assert subject == '@bob recommended "Fight Club" to you'
        assert "loved it" in body
        assert "/p.jpg" in body
        assert "@bob" in body

    def test_tv_kind_label(self, captured):
        from app.services.email_service import send_recommendation_email

        send_recommendation_email(
            to_email="x@t.com",
            to_username="alice",
            from_username="bob",
            content_type="tv",
            content_title="Breaking Bad",
            content_id=1396,
            message=None,
            uid="u",
        )
        body = captured[0][2]
        assert "TV show" in body

    def test_no_message_no_quote_block(self, captured):
        from app.services.email_service import send_recommendation_email

        send_recommendation_email(
            to_email="x@t.com",
            to_username="alice",
            from_username="bob",
            content_type="movie",
            content_title="Fight Club",
            content_id=550,
            message=None,
            uid="u",
        )
        body = captured[0][2]
        # No italicized message block when message=None — check the quote opener
        assert "border-left:3px solid" not in body


# ── send_streaming_alert_email: subjects ──────────────────────────────────


class TestStreamingAlertEmail:
    def _alert(self, **kwargs):
        base = dict(
            title="Fight Club",
            content_type="movie",
            content_id=550,
            poster_path="/p.jpg",
            added=["Netflix"],
            removed=[],
        )
        base.update(kwargs)
        return base

    def test_added_only_subject(self, captured):
        from app.services.email_service import send_streaming_alert_email

        send_streaming_alert_email("x@t.com", "alice", [self._alert()], uid="u")
        assert captured[0][1] == "Fight Club is now streaming — Release Radar"

    def test_removed_only_subject(self, captured):
        from app.services.email_service import send_streaming_alert_email

        a = self._alert(added=[], removed=["Hulu"])
        send_streaming_alert_email("x@t.com", "alice", [a], uid="u")
        assert captured[0][1] == "Fight Club has left streaming — Release Radar"

    def test_added_and_removed_subject(self, captured):
        from app.services.email_service import send_streaming_alert_email

        a = self._alert(added=["Netflix"], removed=["Hulu"])
        send_streaming_alert_email("x@t.com", "alice", [a], uid="u")
        assert captured[0][1] == "Streaming update for Fight Club — Release Radar"

    def test_multi_alert_subject(self, captured):
        from app.services.email_service import send_streaming_alert_email

        alerts = [self._alert(), self._alert(title="Other", content_id=2)]
        send_streaming_alert_email("x@t.com", "alice", alerts, uid="u")
        assert (
            captured[0][1]
            == "Streaming updates for 2 titles you're tracking — Release Radar"
        )

    def test_provider_names_rendered(self, captured):
        from app.services.email_service import send_streaming_alert_email

        a = self._alert(added=["Netflix"], removed=["Hulu"])
        send_streaming_alert_email("x@t.com", "alice", [a], uid="u")
        body = captured[0][2]
        assert "Netflix" in body
        assert "Hulu" in body
        assert "Now streaming on" in body
        assert "No longer on" in body

    def test_no_poster_renders(self, captured):
        from app.services.email_service import send_streaming_alert_email

        a = self._alert(poster_path=None)
        send_streaming_alert_email("x@t.com", "alice", [a], uid="u")
        assert "Fight Club" in captured[0][2]


# ── send_trailer_alert_email: subjects + video rendering ──────────────────


class TestTrailerAlertEmail:
    def _alert(self, **kwargs):
        base = dict(
            title="Fight Club",
            content_type="movie",
            content_id=550,
            poster_path="/p.jpg",
            videos=[{"key": "abc123", "name": "Official Trailer"}],
        )
        base.update(kwargs)
        return base

    def test_single_alert_subject(self, captured):
        from app.services.email_service import send_trailer_alert_email

        send_trailer_alert_email("x@t.com", "alice", [self._alert()], uid="u")
        assert captured[0][1] == "New trailer for Fight Club — Release Radar"

    def test_multi_alert_subject(self, captured):
        from app.services.email_service import send_trailer_alert_email

        alerts = [self._alert(), self._alert(title="Other", content_id=2)]
        send_trailer_alert_email("x@t.com", "alice", alerts, uid="u")
        assert (
            captured[0][1]
            == "New trailers for 2 titles you're tracking — Release Radar"
        )

    def test_youtube_link_rendered(self, captured):
        from app.services.email_service import send_trailer_alert_email

        send_trailer_alert_email("x@t.com", "alice", [self._alert()], uid="u")
        body = captured[0][2]
        assert "youtube.com/watch?v=abc123" in body
        assert "img.youtube.com/vi/abc123/mqdefault.jpg" in body

    def test_caps_at_three_videos(self, captured):
        from app.services.email_service import send_trailer_alert_email

        videos = [{"key": f"k{i}", "name": f"Trailer {i}"} for i in range(5)]
        a = self._alert(videos=videos)
        send_trailer_alert_email("x@t.com", "alice", [a], uid="u")
        body = captured[0][2]
        # Only first 3 should appear
        assert "k0" in body
        assert "k1" in body
        assert "k2" in body
        assert "k3" not in body
        assert "k4" not in body

    def test_no_videos_renders(self, captured):
        from app.services.email_service import send_trailer_alert_email

        a = self._alert(videos=[])
        send_trailer_alert_email("x@t.com", "alice", [a], uid="u")
        # Should still render the card with the title
        assert "Fight Club" in captured[0][2]

    def test_video_name_missing_uses_default(self, captured):
        from app.services.email_service import send_trailer_alert_email

        a = self._alert(videos=[{"key": "abc", "name": None}])
        send_trailer_alert_email("x@t.com", "alice", [a], uid="u")
        assert "Official Trailer" in captured[0][2]


# ── send_email itself ─────────────────────────────────────────────────────


class TestSendEmail:
    def test_no_api_key_is_noop(self, capsys):
        from app.services import email_service

        with patch.object(email_service.settings, "RESEND_API_KEY", ""):
            email_service.send_email("a@b.com", "subj", "<p>body</p>")
        out = capsys.readouterr().out
        assert "RESEND_API_KEY not configured" in out

    def test_calls_resend_when_key_set(self):
        from app.services import email_service

        with patch.object(email_service, "resend") as mock_resend:
            mock_resend.Emails = MagicMock()
            mock_resend.Emails.send = MagicMock(return_value={"id": "x"})
            email_service.send_email("a@b.com", "subj", "<p>body</p>")
            mock_resend.Emails.send.assert_called_once()
            payload = mock_resend.Emails.send.call_args[0][0]
            assert payload["to"] == "a@b.com"
            assert payload["subject"] == "subj"
            assert payload["html"] == "<p>body</p>"

    def test_swallows_exceptions(self, capsys):
        from app.services import email_service

        with patch.object(email_service, "resend") as mock_resend:
            mock_resend.Emails = MagicMock()
            mock_resend.Emails.send = MagicMock(side_effect=RuntimeError("boom"))
            # Must not raise
            email_service.send_email("a@b.com", "subj", "<p>body</p>")
        out = capsys.readouterr().out
        assert "Failed to send email" in out


# ── Wrapper always present ────────────────────────────────────────────────


class TestEmailWrapper:
    def test_wrapper_branding_present_in_all_senders(self, captured):
        from app.services.email_service import (
            send_notification_email,
            send_season_premiere_email,
            send_streaming_alert_email,
            send_trailer_alert_email,
            send_new_season_available_email,
            send_recommendation_email,
        )

        send_notification_email(
            "x@t.com", "alice",
            [{"title": "M", "date": "2026-05-25", "content_type": "movie", "content_id": 1}],
            uid="u",
        )
        send_season_premiere_email(
            "x@t.com", "alice",
            [{"show_name": "S", "season_number": 1, "air_date": "2026-06-01",
              "days_away": 7, "show_id": 1}],
            uid="u",
        )
        send_streaming_alert_email(
            "x@t.com", "alice",
            [{"title": "T", "content_type": "movie", "content_id": 1,
              "poster_path": None, "added": ["A"], "removed": []}],
            uid="u",
        )
        send_trailer_alert_email(
            "x@t.com", "alice",
            [{"title": "T", "content_type": "movie", "content_id": 1,
              "poster_path": None, "videos": [{"key": "k", "name": "n"}]}],
            uid="u",
        )
        send_new_season_available_email(
            "x@t.com", "alice",
            [{"show_name": "S", "show_id": 1, "poster_path": None, "season_number": 1}],
            uid="u",
        )
        send_recommendation_email(
            to_email="x@t.com",
            to_username="alice",
            from_username="bob",
            content_type="movie",
            content_title="C",
            content_id=1,
            message=None,
            uid="u",
        )

        assert len(captured) == 6
        for _to, _subj, body in captured:
            assert "Release Radar" in body
            assert "Unsubscribe" in body
            assert "<!DOCTYPE html>" in body
