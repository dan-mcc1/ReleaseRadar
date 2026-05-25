"""
Tests for admin endpoints: reports, appeals, delete_user.

Covers the N+1 fixes in get_reports / list_appeals / delete_user with
both functional assertions and a query-count regression check so the
batching can't silently regress to per-item loops.
"""

from datetime import datetime, timezone

import pytest

from tests.conftest import make_client


# ── Helpers ────────────────────────────────────────────────────────────────


def _make_admin(db, uid: str = "admin-uid", username: str = "admin"):
    from app.models.user import User

    admin = User(id=uid, username=username, email=f"{username}@test.com",
                 subscription_tier="admin")
    db.add(admin)
    db.commit()
    return admin


@pytest.fixture
def admin_client(db):
    _make_admin(db)
    return make_client("admin-uid")


@pytest.fixture
def reporter(db):
    from app.models.user import User

    u = User(id="reporter-uid", username="reporter", email="r@test.com")
    db.add(u)
    db.commit()
    return u


@pytest.fixture
def target_user(db):
    from app.models.user import User

    u = User(id="target-uid", username="badguy", email="bad@test.com")
    db.add(u)
    db.commit()
    return u


def _make_review(db, user_id, content_id=550, text="bad review"):
    from app.models.review import Review

    r = Review(user_id=user_id, content_type="movie", content_id=content_id,
               review_text=text)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _make_report(db, reporter_id, reported_type, reported_id, **snapshot_kwargs):
    from app.models.report import Report

    r = Report(
        reporter_id=reporter_id,
        reported_type=reported_type,
        reported_id=str(reported_id),
        reason="spam",
        status="pending",
        **snapshot_kwargs,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


# ── Auth gate ──────────────────────────────────────────────────────────────


class TestAdminAuthGate:
    def test_non_admin_blocked_from_stats(self, client, seed_users):
        r = client.get("/admin/stats")
        assert r.status_code == 403

    def test_non_admin_blocked_from_reports(self, client, seed_users):
        r = client.get("/admin/reports")
        assert r.status_code == 403

    def test_non_admin_blocked_from_appeals(self, client, seed_users):
        r = client.get("/admin/appeals")
        assert r.status_code == 403

    def test_admin_can_load_stats(self, admin_client):
        r = admin_client.get("/admin/stats")
        assert r.status_code == 200
        data = r.json()
        assert "users" in data and "tracking" in data


# ── get_reports ────────────────────────────────────────────────────────────


class TestGetReports:
    def test_empty_reports_list(self, admin_client):
        r = admin_client.get("/admin/reports")
        assert r.status_code == 200
        assert r.json() == {"reports": [], "total": 0}

    def test_review_report_includes_review_and_author(
        self, admin_client, db, reporter, target_user
    ):
        review = _make_review(db, target_user.id, text="some review text")
        _make_report(db, reporter.id, "review", review.id)

        r = admin_client.get("/admin/reports")
        assert r.status_code == 200
        payload = r.json()
        assert payload["total"] == 1
        rpt = payload["reports"][0]
        assert rpt["reporter"] == "reporter"
        assert rpt["reported_type"] == "review"
        assert rpt["review"]["text"] == "some review text"
        assert rpt["review"]["author"] == "badguy"
        assert rpt["review"]["deleted"] is False

    def test_review_report_falls_back_to_snapshot_when_deleted(
        self, admin_client, db, reporter
    ):
        # Report references a review that no longer exists; only the snapshot survives.
        _make_report(
            db, reporter.id, "review", 99999,
            snapshot_author_id="ghost-uid",
            snapshot_author_username="ghost",
            snapshot_content_type="movie",
            snapshot_content_id=550,
            snapshot_review_text="this was the review",
            snapshot_review_created_at=datetime.now(timezone.utc),
        )
        r = admin_client.get("/admin/reports")
        payload = r.json()
        assert payload["reports"][0]["review"]["deleted"] is True
        assert payload["reports"][0]["review"]["text"] == "this was the review"
        assert payload["reports"][0]["review"]["author"] == "ghost"

    def test_user_report_includes_target_user_with_reviews_and_ratings(
        self, admin_client, db, reporter, target_user, seed_movie
    ):
        _make_review(db, target_user.id, text="r1")
        _make_review(db, target_user.id, content_id=551, text="r2")

        from app.models.watched import Watched
        from datetime import datetime, timezone as tz
        db.add(Watched(user_id=target_user.id, content_type="movie", content_id=550,
                       rating=4.0, watched_at=datetime.now(tz.utc)))
        db.commit()

        _make_report(db, reporter.id, "user", target_user.id)

        r = admin_client.get("/admin/reports")
        rpt = r.json()["reports"][0]
        assert rpt["reported_user"]["username"] == "badguy"
        assert rpt["reported_user"]["deleted"] is False
        assert len(rpt["reported_user"]["reviews"]) == 2
        assert len(rpt["reported_user"]["ratings"]) == 1

    def test_user_report_falls_back_to_snapshot_when_deleted(
        self, admin_client, db, reporter
    ):
        _make_report(
            db, reporter.id, "user", "deleted-uid",
            snapshot_user_username="ghost",
            snapshot_user_email="ghost@test.com",
            snapshot_user_created_at=datetime.now(timezone.utc),
        )
        r = admin_client.get("/admin/reports")
        ru = r.json()["reports"][0]["reported_user"]
        assert ru["deleted"] is True
        assert ru["username"] == "ghost"

    def test_status_filter_defaults_to_pending(self, admin_client, db, reporter):
        _make_report(db, reporter.id, "user", "any-uid",
                     snapshot_user_username="who")
        # Mark it accepted, then default pending filter should hide it.
        from app.models.report import Report
        db.query(Report).update({"status": "accepted"})
        db.commit()

        r = admin_client.get("/admin/reports")
        assert r.json()["total"] == 0
        r2 = admin_client.get("/admin/reports?status=accepted")
        assert r2.json()["total"] == 1

    def test_invalid_status_defaults_to_pending(self, admin_client, db, reporter):
        _make_report(db, reporter.id, "user", "any-uid",
                     snapshot_user_username="who")
        r = admin_client.get("/admin/reports?status=garbage")
        assert r.json()["total"] == 1

    def test_get_reports_avoids_n_plus_1(
        self, admin_client, db, reporter, target_user, count_queries
    ):
        """Regression test for the batched-fetch fix in get_reports.

        Before the fix, each report triggered 1-3 follow-up queries (reporter +
        optional review + optional target user). Now everything is loaded in
        a fixed number of batches regardless of page size.
        """
        for i in range(10):
            rv = _make_review(db, target_user.id, content_id=600 + i,
                              text=f"r{i}")
            _make_report(db, reporter.id, "review", rv.id)
        # User-typed reports against multiple distinct deleted users to
        # exercise the snapshot path and avoid the duplicate-report 409.
        for i in range(5):
            _make_report(
                db, reporter.id, "user", f"deleted-{i}",
                snapshot_user_username=f"ghost{i}",
            )

        with count_queries() as q:
            r = admin_client.get("/admin/reports?limit=100")
        assert r.status_code == 200
        assert r.json()["total"] == 15

        # Legacy pattern: 15 reports × 1-3 follow-ups = ~30-45 queries.
        # Batched version: 1 main + 1 reviews + 1 users + total count = ~4-5.
        # 12 is a generous regression ceiling.
        assert q.value < 12, (
            f"get_reports issued {q.value} queries — "
            "the batch-fetch optimisation looks like it regressed"
        )


# ── list_appeals ───────────────────────────────────────────────────────────


def _make_appeal(db, user_id, message="please reconsider", status="pending"):
    from app.models.appeal import Appeal

    a = Appeal(user_id=user_id, appeal_type="suspension", message=message,
               status=status)
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


class TestListAppeals:
    def test_empty_appeals_list(self, admin_client):
        r = admin_client.get("/admin/appeals")
        assert r.status_code == 200
        assert r.json() == {"appeals": [], "total": 0}

    def test_pending_appeal_includes_appellant(
        self, admin_client, db, target_user
    ):
        _make_appeal(db, target_user.id)

        r = admin_client.get("/admin/appeals")
        a = r.json()["appeals"][0]
        assert a["username"] == "badguy"
        assert a["email"] == "bad@test.com"

    def test_appeal_with_deleted_appellant_falls_back_to_uid(
        self, admin_client, db
    ):
        _make_appeal(db, "ghost-uid")
        r = admin_client.get("/admin/appeals")
        a = r.json()["appeals"][0]
        # Username should fall back to the raw uid when the user is gone.
        assert a["username"] == "ghost-uid"
        assert a["email"] is None
        assert a["is_still_restricted"] is False

    def test_status_filter(self, admin_client, db, target_user):
        _make_appeal(db, target_user.id, status="pending")
        _make_appeal(db, target_user.id, status="approved")
        assert admin_client.get("/admin/appeals").json()["total"] == 1
        assert admin_client.get("/admin/appeals?status=approved").json()["total"] == 1

    def test_list_appeals_avoids_n_plus_1(self, admin_client, db, count_queries):
        from app.models.user import User

        # 20 distinct appellants → legacy pattern: 21+ queries; batched: ~3.
        for i in range(20):
            u = User(id=f"appellant-{i}", username=f"u{i}", email=f"u{i}@t.com")
            db.add(u)
        db.commit()
        for i in range(20):
            _make_appeal(db, f"appellant-{i}")

        with count_queries() as q:
            r = admin_client.get("/admin/appeals?limit=50")
        assert r.status_code == 200
        assert r.json()["total"] == 20
        # Batched version: 1 appeals + 1 users + 1 count = 3 queries.
        assert q.value < 8, (
            f"list_appeals issued {q.value} queries — batch-fetch regression"
        )


# ── delete_user (content cleanup) ─────────────────────────────────────────


class TestDeleteUserCleanup:
    """The delete_user endpoint had two N+1 loops over tracked content
    (one to decrement tracking_count, one to delete orphans). The refactor
    issues bulk loads + bulk DELETEs with careful FK ordering so an
    autoflush mid-cleanup can't violate the episode -> show FK."""

    def test_delete_user_with_no_tracking_succeeds(
        self, admin_client, db, target_user
    ):
        r = admin_client.delete(f"/admin/users/{target_user.id}")
        # Firebase auth.delete_user is mocked in conftest, so it shouldn't fail
        # the request even though there's no real Firebase user.
        assert r.status_code == 200
        from app.models.user import User
        assert db.query(User).filter_by(id=target_user.id).first() is None

    def test_orphan_show_cleanup_deletes_episodes(
        self, admin_client, db, target_user, seed_show
    ):
        """Show is tracked only by the deleted user → tracking_count hits 0 →
        show + its episodes get removed in the right order."""
        from app.models.watchlist import Watchlist
        from app.models.show import Show
        from app.models.episode import Episode

        seed_show.tracking_count = 1
        db.add(Watchlist(user_id=target_user.id, content_type="tv", content_id=1396))
        db.commit()

        r = admin_client.delete(f"/admin/users/{target_user.id}")
        assert r.status_code == 200

        # Show and its episodes should be gone.
        db.expire_all()
        assert db.query(Show).filter_by(id=1396).first() is None
        assert db.query(Episode).filter_by(show_id=1396).count() == 0

    def test_shared_show_decrement_only(
        self, admin_client, db, target_user, seed_show, seed_users
    ):
        """Show is tracked by another user too — should be kept with
        tracking_count decremented, not deleted."""
        from app.models.watchlist import Watchlist
        from app.models.show import Show

        seed_show.tracking_count = 2  # two trackers
        db.add(Watchlist(user_id=target_user.id, content_type="tv", content_id=1396))
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.commit()

        r = admin_client.delete(f"/admin/users/{target_user.id}")
        assert r.status_code == 200

        db.expire_all()
        survivor = db.query(Show).filter_by(id=1396).first()
        assert survivor is not None
        assert survivor.tracking_count == 1

    def test_orphan_movie_cleanup(
        self, admin_client, db, target_user, seed_movie
    ):
        from app.models.watched import Watched
        from app.models.movie import Movie

        seed_movie.tracking_count = 1
        db.add(Watched(user_id=target_user.id, content_type="movie",
                       content_id=550))
        db.commit()

        r = admin_client.delete(f"/admin/users/{target_user.id}")
        assert r.status_code == 200

        db.expire_all()
        assert db.query(Movie).filter_by(id=550).first() is None


# ── Report actions (accept / reject) ──────────────────────────────────────


class TestAcceptReport:
    def test_accept_review_report_deletes_review(
        self, admin_client, db, reporter, target_user, seed_movie
    ):
        review = _make_review(db, target_user.id)
        review_id = review.id  # capture before the other session deletes it
        rpt = _make_report(db, reporter.id, "review", review_id)

        r = admin_client.post(
            f"/admin/reports/{rpt.id}/accept",
            json={"action": "delete_review"},
        )
        assert r.status_code == 200
        from app.models.review import Review
        db.expire_all()
        assert db.query(Review).filter_by(id=review_id).first() is None

    def test_accept_review_with_wrong_action_400(
        self, admin_client, db, reporter, target_user, seed_movie
    ):
        review = _make_review(db, target_user.id)
        rpt = _make_report(db, reporter.id, "review", review.id)
        r = admin_client.post(
            f"/admin/reports/{rpt.id}/accept",
            json={"action": "warn"},
        )
        assert r.status_code == 400

    def test_accept_user_report_warn_increments_count(
        self, admin_client, db, reporter, target_user
    ):
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        r = admin_client.post(
            f"/admin/reports/{rpt.id}/accept",
            json={"action": "warn"},
        )
        assert r.status_code == 200
        db.expire_all()
        from app.models.user import User
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.warning_count == 1
        assert u.has_unread_warning is True

    def test_warn_escalation_silences_at_three_warnings(
        self, admin_client, db, reporter, target_user
    ):
        from app.models.user import User
        # Pre-bump warning_count to 2; one more warn should silence for 30d
        target_user.warning_count = 2
        db.commit()
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        admin_client.post(
            f"/admin/reports/{rpt.id}/accept", json={"action": "warn"}
        )
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.warning_count == 3
        assert u.silenced_until is not None

    def test_warn_escalation_permanently_silences_at_four(
        self, admin_client, db, reporter, target_user
    ):
        from app.models.user import User
        target_user.warning_count = 3
        db.commit()
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        admin_client.post(
            f"/admin/reports/{rpt.id}/accept", json={"action": "warn"}
        )
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_silenced is True
        assert u.silenced_until is None

    def test_accept_user_report_suspend(self, admin_client, db, reporter, target_user):
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        r = admin_client.post(
            f"/admin/reports/{rpt.id}/accept",
            json={"action": "suspend", "suspend_days": 14},
        )
        assert r.status_code == 200
        from app.models.user import User
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_suspended is True
        assert u.suspended_until is not None

    def test_accept_user_report_ban_creates_banned_email(
        self, admin_client, db, reporter, target_user
    ):
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        r = admin_client.post(
            f"/admin/reports/{rpt.id}/accept", json={"action": "ban"}
        )
        assert r.status_code == 200
        from app.models.user import User
        from app.models.banned_email import BannedEmail
        db.expire_all()
        assert db.query(User).filter_by(id=target_user.id).first().is_banned is True
        assert db.query(BannedEmail).filter_by(
            email=target_user.email
        ).first() is not None

    def test_accept_user_report_invalid_action_400(
        self, admin_client, db, reporter, target_user
    ):
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        r = admin_client.post(
            f"/admin/reports/{rpt.id}/accept", json={"action": "explode"}
        )
        assert r.status_code == 400

    def test_already_resolved_report_returns_409(
        self, admin_client, db, reporter, target_user
    ):
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        from app.models.report import Report
        db.query(Report).update({"status": "accepted"})
        db.commit()
        r = admin_client.post(
            f"/admin/reports/{rpt.id}/accept", json={"action": "warn"}
        )
        assert r.status_code == 409

    def test_unknown_report_404(self, admin_client):
        r = admin_client.post(
            "/admin/reports/99999/accept", json={"action": "warn"}
        )
        assert r.status_code == 404


class TestRejectReport:
    def test_reject_marks_resolved(self, admin_client, db, reporter, target_user):
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        r = admin_client.post(
            f"/admin/reports/{rpt.id}/reject", json={"admin_notes": "no action"}
        )
        assert r.status_code == 200
        from app.models.report import Report
        db.expire_all()
        rpt2 = db.query(Report).filter_by(id=rpt.id).first()
        assert rpt2.status == "rejected"
        assert rpt2.resolved_at is not None
        assert rpt2.admin_notes == "no action"

    def test_reject_already_resolved_409(
        self, admin_client, db, reporter, target_user
    ):
        rpt = _make_report(db, reporter.id, "user", target_user.id)
        from app.models.report import Report
        db.query(Report).update({"status": "rejected"})
        db.commit()
        r = admin_client.post(f"/admin/reports/{rpt.id}/reject", json={})
        assert r.status_code == 409


# ── User management ───────────────────────────────────────────────────────


class TestListUsers:
    def test_list_users_returns_paginated_results(
        self, admin_client, db, target_user
    ):
        r = admin_client.get("/admin/users")
        assert r.status_code == 200
        data = r.json()
        # Includes admin + target_user
        assert data["total"] == 2
        usernames = {u["username"] for u in data["users"]}
        assert "admin" in usernames
        assert "badguy" in usernames

    def test_list_users_search_filters_by_username(
        self, admin_client, db, target_user
    ):
        r = admin_client.get("/admin/users?search=bad")
        assert r.json()["total"] == 1
        assert r.json()["users"][0]["username"] == "badguy"


class TestSuspendUnsuspend:
    def test_suspend_user(self, admin_client, db, target_user):
        r = admin_client.post(
            f"/admin/users/{target_user.id}/suspend",
            json={"days": 3, "reason": "test"},
        )
        assert r.status_code == 200
        from app.models.user import User
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_suspended is True
        assert u.suspension_reason == "test"

    def test_suspend_rejects_zero_days(self, admin_client, target_user):
        r = admin_client.post(
            f"/admin/users/{target_user.id}/suspend", json={"days": 0}
        )
        assert r.status_code == 400

    def test_suspend_unknown_user_404(self, admin_client):
        r = admin_client.post(
            "/admin/users/ghost/suspend", json={"days": 1}
        )
        assert r.status_code == 404

    def test_unsuspend_clears_state(self, admin_client, db, target_user):
        from datetime import timedelta
        target_user.is_suspended = True
        target_user.suspended_until = datetime.now(timezone.utc) + timedelta(days=1)
        target_user.suspension_reason = "old"
        db.commit()

        r = admin_client.post(f"/admin/users/{target_user.id}/unsuspend")
        assert r.status_code == 200
        from app.models.user import User
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_suspended is False
        assert u.suspended_until is None
        assert u.suspension_reason is None


class TestBanUnban:
    def test_ban_user_creates_banned_email(self, admin_client, db, target_user):
        r = admin_client.post(
            f"/admin/users/{target_user.id}/ban",
            json={"reason": "abuse"},
        )
        assert r.status_code == 200
        from app.models.user import User
        from app.models.banned_email import BannedEmail
        db.expire_all()
        assert db.query(User).filter_by(id=target_user.id).first().is_banned is True
        assert db.query(BannedEmail).filter_by(email=target_user.email).first()

    def test_admin_cannot_ban_themselves(self, admin_client, db):
        r = admin_client.post("/admin/users/admin-uid/ban", json={})
        assert r.status_code == 400

    def test_unban_clears_state_and_removes_banned_email(
        self, admin_client, db, target_user
    ):
        from app.models.banned_email import BannedEmail
        target_user.is_banned = True
        target_user.ban_reason = "old"
        db.add(BannedEmail(email=target_user.email, user_id=target_user.id))
        db.commit()

        r = admin_client.post(f"/admin/users/{target_user.id}/unban")
        assert r.status_code == 200
        from app.models.user import User
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_banned is False
        assert db.query(BannedEmail).filter_by(user_id=target_user.id).count() == 0


class TestUnsilence:
    def test_unsilence_clears_silence_state(self, admin_client, db, target_user):
        from datetime import timedelta
        target_user.is_silenced = True
        target_user.silenced_until = datetime.now(timezone.utc) + timedelta(days=7)
        db.commit()

        r = admin_client.post(f"/admin/users/{target_user.id}/unsilence")
        assert r.status_code == 200
        from app.models.user import User
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_silenced is False
        assert u.silenced_until is None


class TestSetTier:
    def test_set_tier_to_premium(self, admin_client, db, target_user):
        r = admin_client.post(
            f"/admin/users/{target_user.id}/tier", json={"tier": "premium"}
        )
        assert r.status_code == 200
        from app.models.user import User
        db.expire_all()
        assert db.query(User).filter_by(id=target_user.id).first().subscription_tier == "premium"

    def test_invalid_tier_400(self, admin_client, target_user):
        r = admin_client.post(
            f"/admin/users/{target_user.id}/tier", json={"tier": "diamond"}
        )
        assert r.status_code == 400


class TestBannedEmails:
    def test_list_and_remove_banned_email(self, admin_client, db, target_user):
        from app.models.banned_email import BannedEmail
        be = BannedEmail(email=target_user.email, user_id=target_user.id)
        db.add(be)
        db.commit()
        db.refresh(be)

        r = admin_client.get("/admin/banned-emails")
        assert r.status_code == 200
        assert len(r.json()) == 1

        r2 = admin_client.delete(f"/admin/banned-emails/{be.id}")
        assert r2.status_code == 200
        assert db.query(BannedEmail).count() == 0

    def test_remove_unknown_banned_email_404(self, admin_client):
        r = admin_client.delete("/admin/banned-emails/99999")
        assert r.status_code == 404


# ── Appeals (approve / reject) ────────────────────────────────────────────


class TestApproveAppeal:
    def test_approve_ban_appeal_unbans_user(self, admin_client, db, target_user):
        from app.models.banned_email import BannedEmail
        target_user.is_banned = True
        target_user.ban_reason = "spam"
        db.add(BannedEmail(email=target_user.email, user_id=target_user.id))
        db.commit()
        ap = _make_appeal(db, target_user.id)
        # Force this to be a ban appeal
        from app.models.appeal import Appeal
        db.query(Appeal).update({"appeal_type": "ban"})
        db.commit()

        r = admin_client.post(
            f"/admin/appeals/{ap.id}/approve",
            json={"admin_notes": "ok"},
        )
        assert r.status_code == 200
        from app.models.user import User
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_banned is False
        assert u.ban_reason is None
        assert db.query(BannedEmail).filter_by(user_id=target_user.id).count() == 0

    def test_approve_suspension_appeal_unsuspends(
        self, admin_client, db, target_user
    ):
        from datetime import timedelta
        target_user.is_suspended = True
        target_user.suspended_until = datetime.now(timezone.utc) + timedelta(days=2)
        db.commit()
        ap = _make_appeal(db, target_user.id)
        r = admin_client.post(f"/admin/appeals/{ap.id}/approve", json={})
        assert r.status_code == 200
        from app.models.user import User
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_suspended is False
        assert u.suspended_until is None

    def test_approve_with_lift_silence(self, admin_client, db, target_user):
        from datetime import timedelta
        target_user.is_silenced = True
        target_user.silenced_until = datetime.now(timezone.utc) + timedelta(days=7)
        target_user.is_suspended = True
        db.commit()
        ap = _make_appeal(db, target_user.id)
        admin_client.post(
            f"/admin/appeals/{ap.id}/approve",
            json={"lift_silence": True},
        )
        from app.models.user import User
        db.expire_all()
        u = db.query(User).filter_by(id=target_user.id).first()
        assert u.is_silenced is False
        assert u.silenced_until is None

    def test_approve_unknown_appeal_404(self, admin_client):
        r = admin_client.post("/admin/appeals/99999/approve", json={})
        assert r.status_code == 404

    def test_already_resolved_appeal_409(self, admin_client, db, target_user):
        ap = _make_appeal(db, target_user.id)
        from app.models.appeal import Appeal
        db.query(Appeal).update({"status": "approved"})
        db.commit()
        r = admin_client.post(f"/admin/appeals/{ap.id}/approve", json={})
        assert r.status_code == 409


class TestRejectAppeal:
    def test_reject_marks_resolved(self, admin_client, db, target_user):
        ap = _make_appeal(db, target_user.id)
        r = admin_client.post(
            f"/admin/appeals/{ap.id}/reject", json={"admin_notes": "denied"}
        )
        assert r.status_code == 200
        from app.models.appeal import Appeal
        db.expire_all()
        a2 = db.query(Appeal).filter_by(id=ap.id).first()
        assert a2.status == "rejected"
        assert a2.admin_notes == "denied"

    def test_reject_unknown_404(self, admin_client):
        r = admin_client.post("/admin/appeals/99999/reject", json={})
        assert r.status_code == 404
