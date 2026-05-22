import logging
import stripe
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.subscription import Subscription
from app.models.user import User

logger = logging.getLogger(__name__)

_PREMIUM_STATUSES = {"active", "trialing"}
_DOWNGRADE_STATUSES = {"canceled", "unpaid", "past_due"}


def reconcile_stripe_subscriptions(db: Session) -> None:
    """
    Fetch every local subscription that has a Stripe ID and compare against
    the live Stripe state.  Fixes any drift caused by missed webhooks.
    """
    subs = (
        db.query(Subscription)
        .filter(Subscription.stripe_subscription_id.isnot(None))
        .all()
    )

    fixed = 0
    for sub in subs:
        try:
            stripe_sub = stripe.Subscription.retrieve(sub.stripe_subscription_id)
        except stripe.error.InvalidRequestError:
            # Subscription deleted on Stripe side with no webhook delivered
            logger.warning(
                "reconcile: stripe sub %s not found; marking canceled for user %s",
                sub.stripe_subscription_id,
                sub.user_id,
            )
            _apply_downgrade(sub, "canceled", db)
            fixed += 1
            continue
        except stripe.error.StripeError as exc:
            logger.error(
                "reconcile: stripe error fetching %s: %s",
                sub.stripe_subscription_id,
                exc,
            )
            continue

        stripe_status = stripe_sub["status"]
        changed = False

        if sub.status != stripe_status:
            sub.status = stripe_status
            changed = True

        period_start = datetime.fromtimestamp(
            stripe_sub["current_period_start"], tz=timezone.utc
        )
        period_end = datetime.fromtimestamp(
            stripe_sub["current_period_end"], tz=timezone.utc
        )
        if sub.current_period_start != period_start:
            sub.current_period_start = period_start
            changed = True
        if sub.current_period_end != period_end:
            sub.current_period_end = period_end
            changed = True
        if sub.cancel_at_period_end != stripe_sub["cancel_at_period_end"]:
            sub.cancel_at_period_end = stripe_sub["cancel_at_period_end"]
            changed = True

        user = db.query(User).filter_by(id=sub.user_id).first()
        if user and user.subscription_tier != "admin":
            if stripe_status in _PREMIUM_STATUSES and user.subscription_tier != "premium":
                logger.info(
                    "reconcile: upgrading user %s to premium (stripe status=%s)",
                    sub.user_id,
                    stripe_status,
                )
                user.subscription_tier = "premium"
                changed = True
            elif stripe_status in _DOWNGRADE_STATUSES and user.subscription_tier == "premium":
                logger.info(
                    "reconcile: downgrading user %s to free (stripe status=%s)",
                    sub.user_id,
                    stripe_status,
                )
                user.subscription_tier = "free"
                changed = True

        if changed:
            fixed += 1

    if fixed:
        db.commit()
        logger.info("reconcile: fixed %d subscription(s)", fixed)
    else:
        logger.info("reconcile: all subscriptions in sync")


def _apply_downgrade(sub: Subscription, status: str, db: Session) -> None:
    sub.status = status
    sub.cancel_at_period_end = False
    user = db.query(User).filter_by(id=sub.user_id).first()
    if user and user.subscription_tier != "admin":
        user.subscription_tier = "free"
