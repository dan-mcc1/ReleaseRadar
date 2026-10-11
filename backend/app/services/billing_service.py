"""Stripe helpers shared by the billing router, account deletion and the
nightly reconciliation."""

import logging
from datetime import datetime, timezone

import stripe
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.models.subscription import Subscription

logger = logging.getLogger(__name__)

stripe.api_key = settings.STRIPE_SECRET_KEY

# Subscriptions in these states can't bill again, so there's nothing to cancel.
_FINISHED_STATUSES = {"canceled", "incomplete_expired"}


def as_dict(obj) -> dict:
    """StripeObjects aren't dicts in stripe-python 12+ (no .get()); handlers
    work on the plain-dict form."""
    return obj.to_dict() if hasattr(obj, "to_dict") else obj


def _timestamp(value) -> datetime | None:
    return datetime.fromtimestamp(value, tz=timezone.utc) if value else None


def subscription_period(stripe_sub: dict) -> tuple[datetime | None, datetime | None]:
    """(start, end) of the current billing period.

    API versions from 2025-03-31 moved current_period_* from the subscription
    onto each subscription item; older versions (and webhook endpoints still
    pinned to one) send them at the top level.
    """
    start = stripe_sub.get("current_period_start")
    end = stripe_sub.get("current_period_end")
    if start is None or end is None:
        items = (stripe_sub.get("items") or {}).get("data") or []
        starts = [i["current_period_start"] for i in items if i.get("current_period_start")]
        ends = [i["current_period_end"] for i in items if i.get("current_period_end")]
        start = min(starts) if starts else None
        end = max(ends) if ends else None
    return _timestamp(start), _timestamp(end)


def invoice_subscription_id(invoice: dict) -> str | None:
    """The subscription an invoice bills. Newer API versions nest it under
    parent.subscription_details; older ones have a top-level field."""
    details = (invoice.get("parent") or {}).get("subscription_details") or {}
    sub = details.get("subscription") or invoice.get("subscription")
    if isinstance(sub, dict):  # expanded object
        sub = sub.get("id")
    return sub


def cancel_subscription_immediately(db: Session, user_id: str) -> None:
    """Cancel the user's Stripe subscription right away (used before deleting
    the account, so a deleted account is never charged again).

    Raises 502 if Stripe can't be reached or refuses, so the caller stops
    before deleting anything. A subscription Stripe no longer has is treated
    as already cancelled.
    """
    sub = db.query(Subscription).filter_by(user_id=user_id).first()
    if not sub or not sub.stripe_subscription_id or sub.status in _FINISHED_STATUSES:
        return
    try:
        stripe.Subscription.cancel(sub.stripe_subscription_id)
    except stripe.InvalidRequestError as e:
        if getattr(e, "code", None) != "resource_missing":
            logger.exception("stripe: cancel failed for user %s", user_id)
            raise HTTPException(
                status_code=502,
                detail="We couldn't cancel your subscription, so your account "
                "wasn't deleted. Please try again.",
            )
    except stripe.StripeError:
        logger.exception("stripe: cancel failed for user %s", user_id)
        raise HTTPException(
            status_code=502,
            detail="We couldn't cancel your subscription, so your account "
            "wasn't deleted. Please try again.",
        )
    sub.status = "canceled"
    sub.cancel_at_period_end = False
