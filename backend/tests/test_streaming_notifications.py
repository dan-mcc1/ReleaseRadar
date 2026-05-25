"""
Tests for app.services.streaming_notification_service.

Covers:
  - _diff_and_update_providers: adds new flatrate, detects removed, deletes
    stale, falls back to DB lookup for removed provider names
  - ensure_providers_populated: skip when stored, swallows errors
  - ensure_providers_populated_bg: opens its own session
  - refresh_streaming_providers: end-to-end sweep, fan-out to watchlist +
    currently-watching users, respects per-user prefs (email + push)
"""

from datetime import date
from unittest.mock import patch, MagicMock

import pytest


def _seed_user(db, uid="user-1", email_notifications=True,
               notify_streaming_changes=True,
               push_notifications_enabled=False,
               push_notify_streaming_changes=True,
               email="u@t.com"):
    from app.models.user import User
    u = User(
        id=uid, username=f"u-{uid}", email=email,
        email_notifications=email_notifications,
        notify_streaming_changes=notify_streaming_changes,
        push_notifications_enabled=push_notifications_enabled,
        push_notify_streaming_changes=push_notify_streaming_changes,
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


def _provider_response(flatrate=(), rent=(), buy=()):
    """Build a TMDb-shape /watch/providers response for the US."""
    def _p(items):
        return [
            {"provider_id": pid, "provider_name": pname, "logo_path": f"/p{pid}.png"}
            for pid, pname in items
        ]
    return {
        "watch/providers": {
            "results": {
                "US": {
                    "flatrate": _p(flatrate),
                    "rent": _p(rent),
                    "buy": _p(buy),
                }
            }
        }
    }


# ── _diff_and_update_providers ────────────────────────────────────────────


class TestDiffAndUpdateProviders:
    def test_adds_new_flatrate_provider(self, db):
        from app.services.streaming_notification_service import _diff_and_update_providers
        from app.models.provider import Provider, MovieProvider

        _seed_movie(db, mid=1)
        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        added, removed = _diff_and_update_providers(db, 1, "movie", fresh)
        db.commit()
        assert added == ["Netflix"]
        assert removed == []
        assert db.query(Provider).filter_by(id=8).first().name == "Netflix"
        assert db.query(MovieProvider).filter_by(movie_id=1, provider_id=8).first().flatrate is True

    def test_detects_removed_flatrate(self, db):
        from app.services.streaming_notification_service import _diff_and_update_providers
        from app.models.provider import Provider, MovieProvider

        _seed_movie(db, mid=1)
        db.add(Provider(id=8, name="Netflix"))
        db.add(MovieProvider(movie_id=1, provider_id=8, flatrate=True))
        db.commit()

        # Empty fresh -> Netflix removed
        fresh = _provider_response()["watch/providers"]["results"]["US"]
        added, removed = _diff_and_update_providers(db, 1, "movie", fresh)
        db.commit()
        assert added == []
        assert removed == ["Netflix"]
        # Stale junction row should be deleted
        assert db.query(MovieProvider).filter_by(movie_id=1).count() == 0

    def test_detects_added_and_removed_simultaneously(self, db):
        from app.services.streaming_notification_service import _diff_and_update_providers
        from app.models.provider import Provider, MovieProvider

        _seed_movie(db, mid=1)
        db.add(Provider(id=8, name="Netflix"))
        db.add(Provider(id=9, name="Hulu"))
        db.add(MovieProvider(movie_id=1, provider_id=8, flatrate=True))
        db.commit()

        fresh = _provider_response(flatrate=[(9, "Hulu")])["watch/providers"]["results"]["US"]
        added, removed = _diff_and_update_providers(db, 1, "movie", fresh)
        db.commit()
        assert added == ["Hulu"]
        assert removed == ["Netflix"]

    def test_flatrate_to_rent_only_counts_as_removed(self, db):
        from app.services.streaming_notification_service import _diff_and_update_providers
        from app.models.provider import Provider, MovieProvider

        _seed_movie(db, mid=1)
        db.add(Provider(id=8, name="Netflix"))
        db.add(MovieProvider(movie_id=1, provider_id=8, flatrate=True))
        db.commit()

        # Now Netflix is rent only — flatrate False
        fresh = _provider_response(rent=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        added, removed = _diff_and_update_providers(db, 1, "movie", fresh)
        db.commit()
        assert added == []
        assert removed == ["Netflix"]
        # Junction row should still exist but flatrate False
        row = db.query(MovieProvider).filter_by(movie_id=1, provider_id=8).first()
        assert row is not None
        assert row.flatrate is False
        assert row.rent is True

    def test_tv_uses_show_provider(self, db):
        from app.services.streaming_notification_service import _diff_and_update_providers
        from app.models.provider import ShowProvider

        _seed_show(db, sid=10)
        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        added, removed = _diff_and_update_providers(db, 10, "tv", fresh)
        db.commit()
        assert added == ["Netflix"]
        assert db.query(ShowProvider).filter_by(show_id=10, provider_id=8).first() is not None

    def test_empty_in_and_out_returns_empty_lists(self, db):
        from app.services.streaming_notification_service import _diff_and_update_providers

        _seed_movie(db, mid=1)
        added, removed = _diff_and_update_providers(db, 1, "movie", {})
        assert added == []
        assert removed == []


# ── ensure_providers_populated ────────────────────────────────────────────


class TestEnsureProvidersPopulated:
    def test_skips_when_already_stored(self, db):
        from app.services import streaming_notification_service as svc
        from app.models.provider import Provider, MovieProvider

        _seed_movie(db, mid=1)
        db.add(Provider(id=8, name="Netflix"))
        db.add(MovieProvider(movie_id=1, provider_id=8, flatrate=True))
        db.commit()

        with patch.object(svc, "_fetch_fresh_us_providers") as mock_fetch:
            svc.ensure_providers_populated(db, 1, "movie")
            mock_fetch.assert_not_called()

    def test_populates_when_empty(self, db):
        from app.services import streaming_notification_service as svc
        from app.models.provider import MovieProvider

        _seed_movie(db, mid=1)
        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            svc.ensure_providers_populated(db, 1, "movie")
        # caller commits — we'll commit here ourselves to make it visible
        db.commit()
        assert db.query(MovieProvider).count() == 1

    def test_swallows_errors(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1)
        with patch.object(
            svc, "_fetch_fresh_us_providers", side_effect=RuntimeError("api down")
        ):
            # Should not raise
            svc.ensure_providers_populated(db, 1, "movie")


class TestEnsureProvidersPopulatedBg:
    def test_uses_own_session(self):
        from app.services import streaming_notification_service as svc

        fake_db = MagicMock()
        with patch.object(svc, "SessionLocal", return_value=fake_db):
            with patch.object(svc, "ensure_providers_populated") as mock_ensure:
                svc.ensure_providers_populated_bg(1, "movie")
                mock_ensure.assert_called_once_with(fake_db, 1, "movie")
                fake_db.commit.assert_called_once()
                fake_db.close.assert_called_once()

    def test_rolls_back_on_error(self):
        from app.services import streaming_notification_service as svc

        fake_db = MagicMock()
        with patch.object(svc, "SessionLocal", return_value=fake_db):
            with patch.object(
                svc, "ensure_providers_populated",
                side_effect=RuntimeError("boom"),
            ):
                svc.ensure_providers_populated_bg(1, "movie")
                fake_db.rollback.assert_called_once()
                fake_db.close.assert_called_once()


# ── refresh_streaming_providers ───────────────────────────────────────────


class TestRefreshStreamingProviders:
    def test_no_tracked_content_returns(self, db):
        from app.services import streaming_notification_service as svc

        with patch.object(svc, "_fetch_fresh_us_providers") as mock_fetch:
            svc.refresh_streaming_providers(db)
            mock_fetch.assert_not_called()

    def test_no_changes_does_not_query_users(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1")
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_fresh_us_providers", return_value={}):
            with patch("app.services.streaming_notification_service.send_streaming_alert_email") as mock_email:
                svc.refresh_streaming_providers(db)
                mock_email.assert_not_called()

    def test_emails_watchlist_user_on_added_provider(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1, title="Fight Club")
        _seed_user(db, uid="u1", email_notifications=True,
                   notify_streaming_changes=True, email="u1@t.com")
        _watchlist(db, "u1", 1, "movie", notify=True)

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch("app.services.streaming_notification_service.send_streaming_alert_email") as mock_email:
                svc.refresh_streaming_providers(db)
                mock_email.assert_called_once()
                args, kwargs = mock_email.call_args
                assert args[0] == "u1@t.com"
                alerts = args[2]
                assert len(alerts) == 1
                assert alerts[0]["title"] == "Fight Club"
                assert alerts[0]["added"] == ["Netflix"]

    def test_emails_currently_watching_users_too(self, db):
        from app.services import streaming_notification_service as svc

        _seed_show(db, sid=10, name="Breaking Bad")
        _seed_user(db, uid="u_cw", email_notifications=True,
                   notify_streaming_changes=True, email="cw@t.com")
        _cw(db, "u_cw", 10, "tv")

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch("app.services.streaming_notification_service.send_streaming_alert_email") as mock_email:
                svc.refresh_streaming_providers(db)
                mock_email.assert_called_once()

    def test_respects_notify_streaming_changes_flag(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", notify_streaming_changes=False)
        _watchlist(db, "u1", 1, "movie")

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch("app.services.streaming_notification_service.send_streaming_alert_email") as mock_email:
                svc.refresh_streaming_providers(db)
                mock_email.assert_not_called()

    def test_respects_watchlist_notify_false(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1")
        _watchlist(db, "u1", 1, "movie", notify=False)

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch("app.services.streaming_notification_service.send_streaming_alert_email") as mock_email:
                svc.refresh_streaming_providers(db)
                mock_email.assert_not_called()

    def test_no_email_when_email_notifications_off(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1", email_notifications=False)
        _watchlist(db, "u1", 1, "movie")

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch("app.services.streaming_notification_service.send_streaming_alert_email") as mock_email:
                svc.refresh_streaming_providers(db)
                mock_email.assert_not_called()

    def test_push_notification_sent_when_enabled(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1, title="Fight Club")
        _seed_user(
            db, uid="u1",
            email_notifications=False,  # disable email path
            push_notifications_enabled=True,
            push_notify_streaming_changes=True,
        )
        _watchlist(db, "u1", 1, "movie")

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch("app.services.streaming_notification_service.push_notification") as mock_push:
                svc.refresh_streaming_providers(db)
                mock_push.assert_called_once()
                kwargs = mock_push.call_args.kwargs
                assert kwargs["type"] == "streaming_change"
                assert "Fight Club" in kwargs["title"]
                assert "Netflix" in kwargs["body"]

    def test_push_body_includes_removed(self, db):
        from app.services import streaming_notification_service as svc
        from app.models.provider import Provider, MovieProvider

        _seed_movie(db, mid=1, title="Fight Club")
        db.add(Provider(id=8, name="Netflix"))
        db.add(MovieProvider(movie_id=1, provider_id=8, flatrate=True))
        db.commit()

        _seed_user(
            db, uid="u1",
            email_notifications=False,
            push_notifications_enabled=True,
            push_notify_streaming_changes=True,
        )
        _watchlist(db, "u1", 1, "movie")

        # Empty fresh -> Netflix removed
        with patch.object(svc, "_fetch_fresh_us_providers", return_value={}):
            with patch("app.services.streaming_notification_service.push_notification") as mock_push:
                svc.refresh_streaming_providers(db)
                mock_push.assert_called_once()
                assert "leaving Netflix" in mock_push.call_args.kwargs["body"]

    def test_second_run_no_diff_skips_push(self, db):
        """After providers are already stored, another sweep with the same
        data produces no diff and sends nothing."""
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1, title="Fight Club")
        _seed_user(
            db, uid="u1",
            email_notifications=False,
            push_notifications_enabled=True,
            push_notify_streaming_changes=True,
        )
        _watchlist(db, "u1", 1, "movie")

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        # First run: changes applied; mock push so we don't actually send.
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch("app.services.streaming_notification_service.push_notification"):
                svc.refresh_streaming_providers(db)

        # Second run: same data -> no diff -> short-circuits at "if not changes".
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch("app.services.streaming_notification_service.push_notification") as mock_push:
                svc.refresh_streaming_providers(db)
                mock_push.assert_not_called()

    def test_email_failure_swallowed_and_push_still_runs(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(
            db, uid="u1",
            email_notifications=True,
            push_notifications_enabled=True,
            push_notify_streaming_changes=True,
        )
        _watchlist(db, "u1", 1, "movie")

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch(
                "app.services.streaming_notification_service.send_streaming_alert_email",
                side_effect=RuntimeError("smtp down"),
            ):
                with patch(
                    "app.services.streaming_notification_service.push_notification"
                ) as mock_push:
                    # Should not raise
                    svc.refresh_streaming_providers(db)
                    mock_push.assert_called_once()

    def test_push_failure_swallowed(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(
            db, uid="u1",
            email_notifications=False,
            push_notifications_enabled=True,
            push_notify_streaming_changes=True,
        )
        _watchlist(db, "u1", 1, "movie")

        fresh = _provider_response(flatrate=[(8, "Netflix")])["watch/providers"]["results"]["US"]
        with patch.object(svc, "_fetch_fresh_us_providers", return_value=fresh):
            with patch(
                "app.services.streaming_notification_service.push_notification",
                side_effect=RuntimeError("fcm down"),
            ):
                # Should not raise
                svc.refresh_streaming_providers(db)

    def test_fetch_error_in_loop_is_swallowed(self, db):
        from app.services import streaming_notification_service as svc

        _seed_movie(db, mid=1)
        _seed_user(db, uid="u1")
        _watchlist(db, "u1", 1, "movie")

        with patch.object(svc, "_fetch_fresh_us_providers", side_effect=RuntimeError("api down")):
            with patch("app.services.streaming_notification_service.send_streaming_alert_email") as mock_email:
                # Should not raise; no email since no changes recorded
                svc.refresh_streaming_providers(db)
                mock_email.assert_not_called()


# ── _fetch_fresh_us_providers ─────────────────────────────────────────────


class TestFetchFreshUsProviders:
    def test_movie_path(self):
        from app.services import streaming_notification_service as svc

        with patch.object(
            svc, "fetch_movie_from_tmdb",
            return_value={"watch/providers": {"results": {"US": {"flatrate": []}}}},
        ) as mock_fn:
            result = svc._fetch_fresh_us_providers(1, "movie")
            mock_fn.assert_called_once_with(1, "watch/providers")
            assert result == {"flatrate": []}

    def test_tv_path(self):
        from app.services import streaming_notification_service as svc

        with patch.object(
            svc, "fetch_show_from_tmdb",
            return_value={"watch/providers": {"results": {"US": {"flatrate": []}}}},
        ) as mock_fn:
            result = svc._fetch_fresh_us_providers(1, "tv")
            mock_fn.assert_called_once_with(1, "watch/providers")
            assert result == {"flatrate": []}

    def test_empty_response_returns_empty_dict(self):
        from app.services import streaming_notification_service as svc

        with patch.object(svc, "fetch_movie_from_tmdb", return_value=None):
            assert svc._fetch_fresh_us_providers(1, "movie") == {}
