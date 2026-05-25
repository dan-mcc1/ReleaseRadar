"""
Regression tests for HTML escaping in email templates.

User- or third-party-controlled values (usernames, content titles, review
text, provider names, video names, show names, recommendation messages)
must be escaped before interpolation into the f-string HTML templates,
otherwise a name like '<script>alert(1)</script>' would be live HTML in
the inbox. These tests assert the rendered HTML never contains the raw
payload and always contains the escaped form.
"""

from datetime import datetime, timezone
from unittest.mock import patch

import pytest


PAYLOAD = '<script>alert("xss")</script>'
# After html.escape, < and > and quotes become entities.
ESCAPED_FRAGMENT = "&lt;script&gt;"


@pytest.fixture
def captured_html():
    """Patches send_email and yields a list that the test populates with
    the html_body of each call."""
    captured: list[str] = []

    def _capture(to_email, subject, html_body):
        captured.append(html_body)

    with patch("app.services.email_service.send_email", side_effect=_capture):
        yield captured


def _assert_escaped(html: str, payload: str = PAYLOAD):
    """Body must contain the escaped form, not the raw payload."""
    assert payload not in html, (
        "Raw HTML payload leaked into the email body — escaping regression"
    )
    assert ESCAPED_FRAGMENT in html


# ── Recommendation email ──────────────────────────────────────────────────


class TestRecommendationEmail:
    def test_from_username_escaped(self, captured_html):
        from app.services.email_service import send_recommendation_email

        send_recommendation_email(
            to_email="x@test.com",
            to_username="alice",
            from_username=PAYLOAD,
            content_type="movie",
            content_title="Fight Club",
            content_id=550,
            message=None,
            uid="uid",
        )
        _assert_escaped(captured_html[0])

    def test_to_username_escaped(self, captured_html):
        from app.services.email_service import send_recommendation_email

        send_recommendation_email(
            to_email="x@test.com",
            to_username=PAYLOAD,
            from_username="bob",
            content_type="movie",
            content_title="Fight Club",
            content_id=550,
            message=None,
            uid="uid",
        )
        _assert_escaped(captured_html[0])

    def test_content_title_escaped(self, captured_html):
        from app.services.email_service import send_recommendation_email

        send_recommendation_email(
            to_email="x@test.com",
            to_username="alice",
            from_username="bob",
            content_type="movie",
            content_title=PAYLOAD,
            content_id=550,
            message=None,
            uid="uid",
        )
        _assert_escaped(captured_html[0])

    def test_message_escaped(self, captured_html):
        from app.services.email_service import send_recommendation_email

        send_recommendation_email(
            to_email="x@test.com",
            to_username="alice",
            from_username="bob",
            content_type="movie",
            content_title="Fight Club",
            content_id=550,
            message=PAYLOAD,
            uid="uid",
        )
        _assert_escaped(captured_html[0])


# ── Digest / notification email ───────────────────────────────────────────


class TestDigestEmail:
    def test_username_escaped(self, captured_html):
        from app.services.email_service import send_notification_email

        items = [{
            "title": "Fight Club",
            "date": "2026-05-25",
            "content_type": "movie",
            "content_id": 550,
        }]
        send_notification_email(
            to_email="x@test.com",
            username=PAYLOAD,
            upcoming_items=items,
            uid="uid",
        )
        _assert_escaped(captured_html[0])

    def test_item_title_escaped_in_link(self, captured_html):
        from app.services.email_service import send_notification_email

        items = [{
            "title": PAYLOAD,
            "date": "2026-05-25",
            "content_type": "movie",
            "content_id": 550,
            "poster_path": "/p.jpg",
        }]
        send_notification_email(
            to_email="x@test.com",
            username="alice",
            upcoming_items=items,
            uid="uid",
        )
        _assert_escaped(captured_html[0])


# ── Season premiere alert ─────────────────────────────────────────────────


class TestSeasonPremiereEmail:
    def test_show_name_escaped(self, captured_html):
        from app.services.email_service import send_season_premiere_email

        alerts = [{
            "show_name": PAYLOAD,
            "season_number": 2,
            "air_date": "2026-06-01",
            "days_away": 7,
            "show_id": 1396,
            "poster_path": "/p.jpg",
        }]
        send_season_premiere_email(
            to_email="x@test.com",
            username="alice",
            alerts=alerts,
            uid="uid",
        )
        # show_name is interpolated as both link text AND img alt — both must escape.
        body = captured_html[0]
        _assert_escaped(body)
        # Defensive: count occurrences so we know both spots escaped, not just one
        assert body.count(ESCAPED_FRAGMENT) >= 2


# ── New-season-available (reactivation) email ─────────────────────────────


class TestNewSeasonAvailableEmail:
    def test_show_name_escaped_in_poster_alt(self, captured_html):
        """Regression for the _poster_img alt= fix from the XSS audit."""
        from app.services.email_service import send_new_season_available_email

        shows = [{
            "show_name": PAYLOAD,
            "show_id": 1396,
            "poster_path": "/p.jpg",
            "season_number": 5,
        }]
        send_new_season_available_email(
            to_email="x@test.com",
            username="alice",
            shows=shows,
            uid="uid",
        )
        _assert_escaped(captured_html[0])


# ── Streaming alert ───────────────────────────────────────────────────────


class TestStreamingAlertEmail:
    def test_alert_title_escaped(self, captured_html):
        from app.services.email_service import send_streaming_alert_email

        alerts = [{
            "title": PAYLOAD,
            "content_type": "movie",
            "content_id": 550,
            "poster_path": "/p.jpg",
            "added": ["Netflix"],
            "removed": [],
        }]
        send_streaming_alert_email(
            to_email="x@test.com",
            username="alice",
            alerts=alerts,
            uid="uid",
        )
        _assert_escaped(captured_html[0])

    def test_provider_name_escaped(self, captured_html):
        from app.services.email_service import send_streaming_alert_email

        alerts = [{
            "title": "Fight Club",
            "content_type": "movie",
            "content_id": 550,
            "poster_path": None,
            "added": [PAYLOAD],
            "removed": [],
        }]
        send_streaming_alert_email(
            to_email="x@test.com",
            username="alice",
            alerts=alerts,
            uid="uid",
        )
        _assert_escaped(captured_html[0])


# ── Trailer alert ─────────────────────────────────────────────────────────


class TestTrailerAlertEmail:
    def test_video_name_escaped(self, captured_html):
        from app.services.email_service import send_trailer_alert_email

        alerts = [{
            "title": "Fight Club",
            "content_type": "movie",
            "content_id": 550,
            "poster_path": None,
            "videos": [{"key": "abc123", "name": PAYLOAD}],
        }]
        send_trailer_alert_email(
            to_email="x@test.com",
            username="alice",
            alerts=alerts,
            uid="uid",
        )
        _assert_escaped(captured_html[0])

    def test_alert_title_escaped(self, captured_html):
        from app.services.email_service import send_trailer_alert_email

        alerts = [{
            "title": PAYLOAD,
            "content_type": "movie",
            "content_id": 550,
            "poster_path": "/p.jpg",
            "videos": [{"key": "abc123", "name": "Trailer"}],
        }]
        send_trailer_alert_email(
            to_email="x@test.com",
            username="alice",
            alerts=alerts,
            uid="uid",
        )
        _assert_escaped(captured_html[0])


# ── Subject line / no-op behaviour ────────────────────────────────────────


class TestEdgeCases:
    def test_empty_upcoming_items_sends_nothing(self, captured_html):
        from app.services.email_service import send_notification_email

        send_notification_email(
            to_email="x@test.com",
            username="alice",
            upcoming_items=[],
            uid="uid",
        )
        assert captured_html == []

    def test_empty_alerts_sends_nothing(self, captured_html):
        from app.services.email_service import (
            send_season_premiere_email,
            send_streaming_alert_email,
            send_trailer_alert_email,
            send_new_season_available_email,
        )

        send_season_premiere_email("x@t.com", "alice", [], "uid")
        send_streaming_alert_email("x@t.com", "alice", [], "uid")
        send_trailer_alert_email("x@t.com", "alice", [], "uid")
        send_new_season_available_email("x@t.com", "alice", [], "uid")
        assert captured_html == []
