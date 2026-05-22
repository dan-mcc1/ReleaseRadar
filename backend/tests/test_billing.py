"""
Tests for billing router (/billing).

All Stripe API calls are mocked so no real network requests are made.
"""

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from tests.conftest import make_client


# ── Helpers ───────────────────────────────────────────────────────────────────


def _seed_user(db, uid="test-uid-1", tier="free"):
    from app.models.user import User

    db.add(User(id=uid, username="alice", email="alice@test.com", subscription_tier=tier))
    db.commit()


def _seed_subscription(db, uid="test-uid-1", status="active",
                       customer_id="cus_test", subscription_id="sub_test",
                       cancel_at_period_end=False):
    from app.models.subscription import Subscription

    sub = Subscription(
        user_id=uid,
        status=status,
        source="stripe",
        stripe_customer_id=customer_id,
        stripe_subscription_id=subscription_id,
        current_period_end=datetime(2025, 12, 31, tzinfo=timezone.utc),
        cancel_at_period_end=cancel_at_period_end,
    )
    db.add(sub)
    db.commit()
    return sub


def _fake_stripe_sub(status="active", cancel_at_period_end=False) -> dict:
    return {
        "id": "sub_test",
        "status": status,
        "current_period_start": 1700000000,
        "current_period_end": 1702678400,
        "cancel_at_period_end": cancel_at_period_end,
    }


# ── GET /billing/status ───────────────────────────────────────────────────────


class TestBillingStatus:
    def test_no_subscription_returns_free(self, client, db):
        _seed_user(db)
        r = client.get("/billing/status")
        assert r.status_code == 200
        data = r.json()
        assert data["tier"] == "free"
        assert data["status"] is None
        assert data["cancel_at_period_end"] is False

    def test_with_active_subscription(self, client, db):
        _seed_user(db, tier="premium")
        _seed_subscription(db, status="active")
        r = client.get("/billing/status")
        assert r.status_code == 200
        data = r.json()
        assert data["tier"] == "premium"
        assert data["status"] == "active"
        assert data["source"] == "stripe"

    def test_cancel_at_period_end_reflected(self, client, db):
        _seed_user(db, tier="premium")
        _seed_subscription(db, cancel_at_period_end=True)
        r = client.get("/billing/status")
        assert r.json()["cancel_at_period_end"] is True

    def test_no_user_returns_free_tier(self, client):
        # No user row at all — falls back gracefully
        r = client.get("/billing/status")
        assert r.status_code == 200
        assert r.json()["tier"] == "free"


# ── POST /billing/create-checkout-session ─────────────────────────────────────


class TestCreateCheckoutSession:
    def test_invalid_interval_returns_400(self, client, db):
        _seed_user(db)
        r = client.post("/billing/create-checkout-session", json={"interval": "quarterly"})
        assert r.status_code == 400

    def test_unconfigured_price_returns_503(self, client, db):
        _seed_user(db)
        # Default test env has empty price IDs
        with patch("app.routers.billing._INTERVAL_TO_PRICE", {"monthly": "", "yearly": ""}):
            r = client.post("/billing/create-checkout-session", json={"interval": "monthly"})
        assert r.status_code == 503

    def test_missing_user_returns_404(self, client):
        # Price ID must be non-empty so the check reaches the user lookup
        with patch("app.routers.billing._INTERVAL_TO_PRICE", {"monthly": "price_test", "yearly": "price_yearly"}):
            r = client.post("/billing/create-checkout-session", json={"interval": "monthly"})
        assert r.status_code == 404

    def test_success_returns_url(self, client, db):
        _seed_user(db)
        mock_customer = MagicMock()
        mock_customer.id = "cus_new"
        mock_session = MagicMock()
        mock_session.url = "https://checkout.stripe.com/test"

        with patch("app.routers.billing._INTERVAL_TO_PRICE", {"monthly": "price_test", "yearly": "price_yearly"}):
            with patch("stripe.Customer.create", return_value=mock_customer):
                with patch("stripe.checkout.Session.create", return_value=mock_session):
                    r = client.post("/billing/create-checkout-session", json={"interval": "monthly"})
        assert r.status_code == 200
        assert r.json()["url"] == "https://checkout.stripe.com/test"


# ── POST /billing/create-portal-session ──────────────────────────────────────


class TestCreatePortalSession:
    def test_no_billing_account_returns_400(self, client, db):
        _seed_user(db)
        r = client.post("/billing/create-portal-session")
        assert r.status_code == 400

    def test_subscription_without_customer_id_returns_400(self, client, db):
        from app.models.subscription import Subscription

        _seed_user(db)
        db.add(Subscription(user_id="test-uid-1", source="stripe", stripe_customer_id=None))
        db.commit()
        r = client.post("/billing/create-portal-session")
        assert r.status_code == 400

    def test_success_returns_url(self, client, db):
        _seed_user(db, tier="premium")
        _seed_subscription(db, customer_id="cus_test")
        mock_portal = MagicMock()
        mock_portal.url = "https://billing.stripe.com/portal/test"
        with patch("stripe.billing_portal.Session.create", return_value=mock_portal):
            r = client.post("/billing/create-portal-session")
        assert r.status_code == 200
        assert "stripe.com" in r.json()["url"]


# ── POST /billing/cancel ──────────────────────────────────────────────────────


class TestCancelSubscription:
    def test_no_subscription_returns_400(self, client, db):
        _seed_user(db)
        r = client.post("/billing/cancel")
        assert r.status_code == 400

    def test_subscription_without_stripe_id_returns_400(self, client, db):
        from app.models.subscription import Subscription

        _seed_user(db)
        db.add(Subscription(user_id="test-uid-1", source="stripe",
                            stripe_customer_id="cus_test", stripe_subscription_id=None))
        db.commit()
        r = client.post("/billing/cancel")
        assert r.status_code == 400

    def test_cancel_sets_flag(self, client, db):
        _seed_user(db, tier="premium")
        _seed_subscription(db)
        with patch("stripe.Subscription.modify") as mock_modify:
            r = client.post("/billing/cancel")
        assert r.status_code == 200
        assert r.json()["canceled"] is True
        assert r.json()["cancel_at_period_end"] is True
        mock_modify.assert_called_once_with("sub_test", cancel_at_period_end=True)


# ── Internal webhook handlers (unit tests, no HTTP) ───────────────────────────


class TestWebhookHandlers:
    def test_subscription_updated_active_promotes_to_premium(self, db):
        from app.models.user import User
        from app.models.subscription import Subscription
        from app.routers.billing import _handle_subscription_updated

        db.add(User(id="test-uid-1", username="alice", email="a@test.com", subscription_tier="free"))
        db.add(Subscription(user_id="test-uid-1", stripe_subscription_id="sub_test"))
        db.commit()

        _handle_subscription_updated(_fake_stripe_sub(status="active"), db)
        db.commit()

        user = db.query(User).filter_by(id="test-uid-1").first()
        assert user.subscription_tier == "premium"

    def test_subscription_updated_canceled_downgrades_to_free(self, db):
        from app.models.user import User
        from app.models.subscription import Subscription
        from app.routers.billing import _handle_subscription_updated

        db.add(User(id="test-uid-1", username="alice", email="a@test.com", subscription_tier="premium"))
        db.add(Subscription(user_id="test-uid-1", stripe_subscription_id="sub_test"))
        db.commit()

        _handle_subscription_updated(_fake_stripe_sub(status="canceled"), db)
        db.commit()

        user = db.query(User).filter_by(id="test-uid-1").first()
        assert user.subscription_tier == "free"

    def test_subscription_deleted_sets_canceled_and_free(self, db):
        from app.models.user import User
        from app.models.subscription import Subscription
        from app.routers.billing import _handle_subscription_deleted

        db.add(User(id="test-uid-1", username="alice", email="a@test.com", subscription_tier="premium"))
        db.add(Subscription(user_id="test-uid-1", stripe_subscription_id="sub_test"))
        db.commit()

        _handle_subscription_deleted({"id": "sub_test"}, db)
        db.commit()

        sub = db.query(Subscription).filter_by(user_id="test-uid-1").first()
        user = db.query(User).filter_by(id="test-uid-1").first()
        assert sub.status == "canceled"
        assert user.subscription_tier == "free"

    def test_subscription_deleted_preserves_admin_tier(self, db):
        from app.models.user import User
        from app.models.subscription import Subscription
        from app.routers.billing import _handle_subscription_deleted

        db.add(User(id="test-uid-1", username="alice", email="a@test.com", subscription_tier="admin"))
        db.add(Subscription(user_id="test-uid-1", stripe_subscription_id="sub_test"))
        db.commit()

        _handle_subscription_deleted({"id": "sub_test"}, db)
        db.commit()

        user = db.query(User).filter_by(id="test-uid-1").first()
        assert user.subscription_tier == "admin"

    def test_payment_failed_sets_past_due(self, db):
        from app.models.subscription import Subscription
        from app.routers.billing import _handle_payment_failed

        db.add(Subscription(user_id="test-uid-1", stripe_subscription_id="sub_test", status="active"))
        db.commit()

        _handle_payment_failed({"subscription": "sub_test"}, db)
        db.commit()

        sub = db.query(Subscription).filter_by(user_id="test-uid-1").first()
        assert sub.status == "past_due"

    def test_handlers_noop_when_subscription_not_found(self, db):
        from app.routers.billing import (
            _handle_subscription_updated,
            _handle_subscription_deleted,
            _handle_payment_failed,
        )

        # No subscription row in DB — handlers must not raise
        _handle_subscription_updated(_fake_stripe_sub(), db)
        _handle_subscription_deleted({"id": "sub_missing"}, db)
        _handle_payment_failed({"subscription": "sub_missing"}, db)


# ── POST /billing/webhook (HTTP) ──────────────────────────────────────────────


class TestStripeWebhook:
    def _post_webhook(self, client, event_type, event_data):
        event = {
            "id": "evt_test_001",
            "type": event_type,
            "data": {"object": event_data},
        }
        mock_event = MagicMock()
        mock_event.__getitem__ = lambda self, key: event[key]
        mock_event.get = lambda key, default=None: event.get(key, default)
        mock_event["id"] = event["id"]
        mock_event["type"] = event_type
        mock_event["data"] = event["data"]

        with patch("stripe.Webhook.construct_event", return_value=mock_event):
            return client.post(
                "/billing/webhook",
                content=b"{}",
                headers={"stripe-signature": "t=123,v1=abc"},
            )

    def test_invalid_signature_returns_400(self, client, db):
        import stripe

        with patch("stripe.Webhook.construct_event",
                   side_effect=stripe.error.SignatureVerificationError("bad sig", "sig_header")):
            r = client.post(
                "/billing/webhook",
                content=b"{}",
                headers={"stripe-signature": "bad"},
            )
        assert r.status_code == 400

    def test_duplicate_event_is_idempotent(self, client, db):
        from app.models.processed_stripe_event import ProcessedStripeEvent

        _seed_user(db)
        # Pre-insert a processed event
        db.add(ProcessedStripeEvent(event_id="evt_dup"))
        db.commit()

        event = MagicMock()
        event.__getitem__ = lambda self, k: {"id": "evt_dup", "type": "unknown", "data": {"object": {}}}[k]
        event["id"] = "evt_dup"
        event["type"] = "unknown"
        event["data"] = {"object": {}}

        with patch("stripe.Webhook.construct_event", return_value=event):
            r = client.post(
                "/billing/webhook",
                content=b"{}",
                headers={"stripe-signature": "t=1,v1=x"},
            )
        assert r.status_code == 200
        assert r.json() == {"received": True}
