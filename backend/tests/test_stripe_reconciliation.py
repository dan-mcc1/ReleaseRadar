"""
Tests for app.services.stripe_reconciliation_service.

The Stripe SDK is patched at the import path used inside the service module,
so no real Stripe calls are made.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
import stripe


def _seed_user(db, uid: str = "rec-uid", tier: str = "free"):
    from app.models.user import User

    u = User(id=uid, username=uid, email=f"{uid}@test.com", subscription_tier=tier)
    db.add(u)
    db.commit()
    return u


def _seed_sub(
    db,
    uid: str = "rec-uid",
    sub_id: str = "sub_test",
    status: str = "active",
    cap: bool = False,
):
    from app.models.subscription import Subscription

    s = Subscription(
        user_id=uid,
        status=status,
        source="stripe",
        stripe_customer_id=f"cus_{uid}",
        stripe_subscription_id=sub_id,
        cancel_at_period_end=cap,
        current_period_start=datetime(2024, 1, 1, tzinfo=timezone.utc),
        current_period_end=datetime(2024, 2, 1, tzinfo=timezone.utc),
    )
    db.add(s)
    db.commit()
    return s


def _stripe_sub_payload(
    sub_id: str = "sub_test",
    status: str = "active",
    period_start: int = 1700000000,
    period_end: int = 1702678400,
    cap: bool = False,
):
    return {
        "id": sub_id,
        "status": status,
        "current_period_start": period_start,
        "current_period_end": period_end,
        "cancel_at_period_end": cap,
    }


class TestReconcileStripeSubscriptions:
    def test_no_subs_with_stripe_id_is_a_noop(self, db):
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        with patch("stripe.Subscription.retrieve") as m:
            reconcile_stripe_subscriptions(db)
        assert m.call_count == 0

    def test_skips_subs_without_stripe_id(self, db):
        from app.models.subscription import Subscription
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db)
        db.add(
            Subscription(
                user_id="rec-uid",
                status="active",
                source="promo",
                stripe_subscription_id=None,
            )
        )
        db.commit()

        with patch("stripe.Subscription.retrieve") as m:
            reconcile_stripe_subscriptions(db)
        assert m.call_count == 0

    def test_status_drift_is_repaired(self, db):
        from app.models.subscription import Subscription
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="premium")
        _seed_sub(db, status="past_due")

        with patch(
            "stripe.Subscription.retrieve",
            return_value=_stripe_sub_payload(status="active"),
        ):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        sub = db.query(Subscription).filter_by(stripe_subscription_id="sub_test").first()
        assert sub.status == "active"

    def test_cancel_at_period_end_drift_is_repaired(self, db):
        from app.models.subscription import Subscription
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="premium")
        _seed_sub(db, status="active", cap=False)

        with patch(
            "stripe.Subscription.retrieve",
            return_value=_stripe_sub_payload(status="active", cap=True),
        ):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        sub = db.query(Subscription).filter_by(stripe_subscription_id="sub_test").first()
        assert sub.cancel_at_period_end is True

    def test_premium_status_upgrades_free_user(self, db):
        from app.models.user import User
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="free")
        _seed_sub(db, status="past_due")

        with patch(
            "stripe.Subscription.retrieve",
            return_value=_stripe_sub_payload(status="active"),
        ):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        assert db.query(User).filter_by(id="rec-uid").first().subscription_tier == "premium"

    def test_trialing_status_also_promotes_to_premium(self, db):
        from app.models.user import User
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="free")
        _seed_sub(db, status="past_due")

        with patch(
            "stripe.Subscription.retrieve",
            return_value=_stripe_sub_payload(status="trialing"),
        ):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        assert db.query(User).filter_by(id="rec-uid").first().subscription_tier == "premium"

    def test_canceled_status_downgrades_premium_user(self, db):
        from app.models.user import User
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="premium")
        _seed_sub(db, status="active")

        with patch(
            "stripe.Subscription.retrieve",
            return_value=_stripe_sub_payload(status="canceled"),
        ):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        assert db.query(User).filter_by(id="rec-uid").first().subscription_tier == "free"

    def test_admin_tier_is_never_changed(self, db):
        from app.models.user import User
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="admin")
        _seed_sub(db, status="active")

        with patch(
            "stripe.Subscription.retrieve",
            return_value=_stripe_sub_payload(status="canceled"),
        ):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        assert db.query(User).filter_by(id="rec-uid").first().subscription_tier == "admin"

    def test_invalid_request_error_marks_canceled(self, db):
        """Sub deleted on Stripe side with no webhook delivered → mark canceled
        locally and downgrade the user."""
        from app.models.subscription import Subscription
        from app.models.user import User
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="premium")
        _seed_sub(db, status="active", cap=True)

        # Build a real InvalidRequestError so the except clause matches.
        err = stripe.error.InvalidRequestError("not found", None)
        with patch("stripe.Subscription.retrieve", side_effect=err):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        sub = db.query(Subscription).filter_by(stripe_subscription_id="sub_test").first()
        assert sub.status == "canceled"
        assert sub.cancel_at_period_end is False
        assert db.query(User).filter_by(id="rec-uid").first().subscription_tier == "free"

    def test_generic_stripe_error_is_swallowed_no_change(self, db):
        from app.models.subscription import Subscription
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="premium")
        _seed_sub(db, status="active")

        # Use the base StripeError to exercise the generic-error branch
        err = stripe.error.StripeError("network down")
        with patch("stripe.Subscription.retrieve", side_effect=err):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        sub = db.query(Subscription).filter_by(stripe_subscription_id="sub_test").first()
        # Status unchanged since we couldn't fetch from Stripe
        assert sub.status == "active"

    def test_period_dates_are_synced_from_stripe(self, db):
        from app.models.subscription import Subscription
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="premium")
        _seed_sub(db, status="active")

        new_start = 1710000000
        new_end = 1712592000
        with patch(
            "stripe.Subscription.retrieve",
            return_value=_stripe_sub_payload(
                status="active", period_start=new_start, period_end=new_end
            ),
        ):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        sub = db.query(Subscription).filter_by(stripe_subscription_id="sub_test").first()
        # SQLite strips tzinfo on round-trip; production (Postgres) keeps it.
        # Compare naive epochs to make this dialect-agnostic.
        # SQLite strips tzinfo; production (Postgres) keeps it. Compare against
        # the UTC datetime (which is what the service writes) with tzinfo stripped.
        expected_start = datetime.fromtimestamp(new_start, tz=timezone.utc).replace(tzinfo=None)
        expected_end = datetime.fromtimestamp(new_end, tz=timezone.utc).replace(tzinfo=None)
        assert sub.current_period_start.replace(tzinfo=None) == expected_start
        assert sub.current_period_end.replace(tzinfo=None) == expected_end

    def test_in_sync_subscription_is_left_alone(self, db):
        """If everything already matches Stripe, the reconcile is a no-write op."""
        from app.models.subscription import Subscription
        from app.services.stripe_reconciliation_service import (
            reconcile_stripe_subscriptions,
        )

        _seed_user(db, tier="premium")
        start = 1700000000
        end = 1702678400
        # Pre-seed with the exact values stripe will return
        from app.models.subscription import Subscription as Sub

        db.add(
            Sub(
                user_id="rec-uid",
                status="active",
                source="stripe",
                stripe_customer_id="cus_rec-uid",
                stripe_subscription_id="sub_test",
                cancel_at_period_end=False,
                current_period_start=datetime.fromtimestamp(start, tz=timezone.utc),
                current_period_end=datetime.fromtimestamp(end, tz=timezone.utc),
            )
        )
        db.commit()

        with patch(
            "stripe.Subscription.retrieve",
            return_value=_stripe_sub_payload(
                status="active", period_start=start, period_end=end, cap=False
            ),
        ):
            reconcile_stripe_subscriptions(db)

        db.expire_all()
        sub = db.query(Subscription).filter_by(stripe_subscription_id="sub_test").first()
        assert sub.status == "active"
        assert sub.cancel_at_period_end is False
