"""
Tests for app.services.trailer_notification_service.

Covers:
  - _detect_new_videos: skip duplicates, skip non-Trailer types, skip
    non-official, persist new rows
  - refresh_trailers: end-to-end sweep, premium-tier gating, per-user
    email + push opt-ins, error swallowing
"""

from unittest.mock import patch

import pytest


def _seed_user(db, uid="user-1", subscription_tier="premium",
               notify_trailers=True, email_notifications=True,
               push_notifications_enabled=False,
               push_notify_trailers=True,
               email="u@t.com"):
    from app.models.user import User
    u = User(
        id=uid, username=f"u-{uid}", email=email,
        subscription_tier=subscription_tier,
        notify_trailers=notify_trailers,
        email_notifications=email_notifications,
        push_notifications_enabled=push_notifications_enabled,
        push_notify_trailers=push_notify_trailers,
    )
    db.add(u)
    db.commit()
    return u


def _seed_movie(db, mid=100, title="Movie"):
    from app.models.movie import Movie
    m = Movie(id=mid, title=title, status="Released", tracking_count=0, vote_average=0.0)
    db.add(m)
    db.commit()
    return m


def _seed_show(db, sid=200, name="Show"):
    from app.models.show import Show
    s = Show(id=sid, name=name, tracking_count=0, vote_average=0.0)
    db.add(s)
    db.commit()
    return s


def _watchlist(db, user_id, content_id, content_type, notify=True):
    from app.models.watchlist import Watchlist
    db.add(Watchlist(
        user_id=user_id, content_id=content_id,
        content_type=content_type, notify=notify,
    ))
    db.commit()


def _cw(db, user_id, content_id, content_type):
    from app.models.currently_watching import CurrentlyWatching
    db.add(CurrentlyWatching(
        user_id=user_id, content_id=content_id, content_type=content_type,
    ))
    db.commit()


def _video(key, name="Official Trailer", vtype="Trailer", official=True):
    return {"key": key, "name": name, "type": vtype, "official": official}


# ── _detect_new_videos ────────────────────────────────────────────────────


class TestDetectNewVideos:
    def test_new_official_trailer_added(self, db):
        from app.services.trailer_notification_service import _detect_new_videos
        from app.models.movie_video import MovieVideo

        _seed_movie(db, mid=1)
        result = _detect_new_videos(db, 1, "movie", [_video("k1")])
        db.commit()
        assert len(result) == 1
        assert result[0]["key"] == "k1"
        assert db.query(MovieVideo).filter_by(movie_id=1, video_key="k1").first() is not None

    def test_duplicate_key_skipped(self, db):
        from app.services.trailer_notification_service import _detect_new_videos
        from app.models.movie_video import MovieVideo

        _seed_movie(db, mid=1)
        db.add(MovieVideo(movie_id=1, video_key="k1", name="existing"))
        db.commit()

        result = _detect_new_videos(db, 1, "movie", [_video("k1")])
        db.commit()
        assert result == []
        assert db.query(MovieVideo).filter_by(movie_id=1).count() == 1

    def test_unofficial_video_skipped(self, db):
        from app.services.trailer_notification_service import _detect_new_videos

        _seed_movie(db, mid=1)
        result = _detect_new_videos(db, 1, "movie", [_video("k1", official=False)])
        db.commit()
        assert result == []

    def test_non_trailer_type_skipped(self, db):
        from app.services.trailer_notification_service import _detect_new_videos

        _seed_movie(db, mid=1)
        result = _detect_new_videos(db, 1, "movie", [_video("k1", vtype="Featurette")])
        db.commit()
        assert result == []

    def test_missing_key_skipped(self, db):
        from app.services.trailer_notification_service import _detect_new_videos

        _seed_movie(db, mid=1)
        result = _detect_new_videos(db, 1, "movie", [{"name": "x", "type": "Trailer", "official": True}])
        db.commit()
        assert result == []

    def test_tv_uses_show_video(self, db):
        from app.services.trailer_notification_service import _detect_new_videos
        from app.models.show_video import ShowVideo

        _seed_show(db, sid=10)
        result = _detect_new_videos(db, 10, "tv", [_video("k1")])
        db.commit()
        assert len(result) == 1
        assert db.query(ShowVideo).filter_by(show_id=10, video_key="k1").first() is not None

    def test_dedupes_within_same_batch(self, db):
        from app.services.trailer_notification_service import _detect_new_videos
        from app.models.movie_video import MovieVideo

        _seed_movie(db, mid=1)
        result = _detect_new_videos(
            db, 1, "movie",
            [_video("k1"), _video("k1", name="Duplicate")],
        )
        db.commit()
        assert len(result) == 1
        assert db.query(MovieVideo).filter_by(movie_id=1).count() == 1


# ── refresh_trailers ──────────────────────────────────────────────────────


class TestRefreshTrailers:
    def test_no_tracked_returns(self, db):
        from app.services import trailer_notification_service as svc

        with patch.object(svc, "_fetch_videos") as mock_fetch:
            svc.refresh_trailers(db)
            mock_fetch.assert_not_called()

    def test_no_new_videos_no_email(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1")
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[]):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_not_called()

    def test_emails_premium_user_on_new_trailer(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1, title="Fight Club")
        _seed_user(db, uid="u1", subscription_tier="premium")
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1", name="Trailer 1")]):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_called_once()
                args, _ = mock_email.call_args
                assert args[0] == "u@t.com"
                alerts = args[2]
                assert len(alerts) == 1
                assert alerts[0]["title"] == "Fight Club"
                assert alerts[0]["videos"][0]["key"] == "vk1"

    def test_emails_admin_tier(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", subscription_tier="admin")
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1")]):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_called_once()

    def test_skips_free_tier(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", subscription_tier="free")
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1")]):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_not_called()

    def test_respects_notify_trailers_off(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", subscription_tier="premium", notify_trailers=False)
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1")]):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_not_called()

    def test_no_email_when_email_notifications_off(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", subscription_tier="premium", email_notifications=False)
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1")]):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_not_called()

    def test_watchlist_notify_false_no_email(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", subscription_tier="premium")
        _watchlist(db, "u1", 1, "movie", notify=False)

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1")]):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_not_called()

    def test_currently_watching_user_notified(self, db):
        from app.services import trailer_notification_service as svc

        _seed_show(db, sid=10, name="Breaking Bad")
        _seed_user(db, uid="u1", subscription_tier="premium")
        _cw(db, "u1", 10, "tv")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1")]):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_called_once()

    def test_push_notification_sent(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1, title="Fight Club")
        _seed_user(
            db, uid="u1", subscription_tier="premium",
            email_notifications=False,
            push_notifications_enabled=True,
            push_notify_trailers=True,
        )
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1", name="Final Trailer")]):
            with patch("app.services.trailer_notification_service.push_notification") as mock_push:
                svc.refresh_trailers(db)
                mock_push.assert_called_once()
                kwargs = mock_push.call_args.kwargs
                assert kwargs["type"] == "trailer"
                assert "Fight Club" in kwargs["title"]
                assert kwargs["body"] == "Final Trailer"
                assert kwargs["video_key"] == "vk1"

    def test_email_failure_swallowed(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", subscription_tier="premium")
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1")]):
            with patch(
                "app.services.trailer_notification_service.send_trailer_alert_email",
                side_effect=RuntimeError("smtp down"),
            ):
                # Should not raise
                svc.refresh_trailers(db)

    def test_push_failure_swallowed(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(
            db, uid="u1", subscription_tier="premium",
            email_notifications=False,
            push_notifications_enabled=True,
        )
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1")]):
            with patch(
                "app.services.trailer_notification_service.push_notification",
                side_effect=RuntimeError("fcm down"),
            ):
                # Should not raise
                svc.refresh_trailers(db)

    def test_fetch_error_swallowed(self, db):
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", subscription_tier="premium")
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", side_effect=RuntimeError("api down")):
            with patch("app.services.trailer_notification_service.send_trailer_alert_email") as mock_email:
                svc.refresh_trailers(db)
                mock_email.assert_not_called()


# ── _fetch_videos ─────────────────────────────────────────────────────────


class TestFetchVideos:
    def test_movie_path(self):
        from app.services import trailer_notification_service as svc

        with patch.object(
            svc, "fetch_movie_from_tmdb",
            return_value={"videos": {"results": [{"key": "k1"}]}},
        ) as mock_fn:
            result = svc._fetch_videos(1, "movie")
            mock_fn.assert_called_once_with(1, "videos")
            assert result == [{"key": "k1"}]

    def test_tv_path(self):
        from app.services import trailer_notification_service as svc

        with patch.object(
            svc, "fetch_show_from_tmdb",
            return_value={"videos": {"results": [{"key": "k1"}]}},
        ) as mock_fn:
            result = svc._fetch_videos(1, "tv")
            mock_fn.assert_called_once_with(1, "videos")
            assert result == [{"key": "k1"}]

    def test_empty_response_returns_empty_list(self):
        from app.services import trailer_notification_service as svc

        with patch.object(svc, "fetch_movie_from_tmdb", return_value=None):
            assert svc._fetch_videos(1, "movie") == []

    def test_push_video_missing_name_falls_back_to_default(self, db):
        """push body should be 'New trailer' if video has no name."""
        from app.services import trailer_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(
            db, uid="u1", subscription_tier="premium",
            email_notifications=False,
            push_notifications_enabled=True,
        )
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_videos", return_value=[_video("vk1", name=None)]):
            with patch("app.services.trailer_notification_service.push_notification") as mock_push:
                svc.refresh_trailers(db)
                mock_push.assert_called_once()
                assert mock_push.call_args.kwargs["body"] == "New trailer"
