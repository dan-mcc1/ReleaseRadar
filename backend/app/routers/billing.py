import stripe
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Body
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.config import settings
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.models.subscription import Subscription
from app.models.processed_stripe_event import ProcessedStripeEvent

router = APIRouter()

stripe.api_key = settings.STRIPE_SECRET_KEY

_INTERVAL_TO_PRICE = {
    "monthly": settings.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
    "yearly": settings.STRIPE_PREMIUM_YEARLY_PRICE_ID,
}


def _get_or_create_stripe_customer(user: User, db: Session) -> str:
    # with_for_update serializes concurrent calls when a subscription row already exists
    sub = db.query(Subscription).filter_by(user_id=user.id).with_for_update().first()
    if sub and sub.stripe_customer_id:
        return sub.stripe_customer_id

    customer = stripe.Customer.create(
        email=user.email,
        metadata={"firebase_uid": user.id},
    )

    try:
        if not sub:
            sub = Subscription(user_id=user.id, source="stripe")
            db.add(sub)
        sub.stripe_customer_id = customer.id
        db.commit()
    except IntegrityError:
        # Concurrent request inserted the row first; use their customer_id
        db.rollback()
        sub = db.query(Subscription).filter_by(user_id=user.id).first()
        if sub and sub.stripe_customer_id:
            return sub.stripe_customer_id
        raise

    return customer.id


def _sync_stripe_subscription(sub: Subscription, stripe_sub: dict, db: Session):
    sub.stripe_subscription_id = stripe_sub["id"]
    sub.status = stripe_sub["status"]
    sub.source = "stripe"
    sub.current_period_start = datetime.fromtimestamp(
        stripe_sub["current_period_start"], tz=timezone.utc
    )
    sub.current_period_end = datetime.fromtimestamp(
        stripe_sub["current_period_end"], tz=timezone.utc
    )
    sub.cancel_at_period_end = stripe_sub["cancel_at_period_end"]

    if stripe_sub["status"] in ("active", "trialing"):
        user = db.query(User).filter_by(id=sub.user_id).first()
        if user and user.subscription_tier != "admin":
            user.subscription_tier = "premium"


@router.post("/create-checkout-session")
def create_checkout_session(
    interval: str = Body(..., embed=True),
    uid: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if interval not in _INTERVAL_TO_PRICE:
        raise HTTPException(status_code=400, detail="interval must be 'monthly' or 'yearly'")

    price_id = _INTERVAL_TO_PRICE[interval]
    if not price_id:
        raise HTTPException(status_code=503, detail="Billing not configured")

    user = db.query(User).filter_by(id=uid).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    customer_id = _get_or_create_stripe_customer(user, db)

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=f"{settings.FRONTEND_URL}/billing?success=1",
        cancel_url=f"{settings.FRONTEND_URL}/pricing",
        subscription_data={"trial_period_days": 7},
        allow_promotion_codes=True,
    )

    return {"url": session.url}


@router.post("/create-portal-session")
def create_portal_session(
    uid: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter_by(user_id=uid).first()
    if not sub or not sub.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No billing account found")

    portal = stripe.billing_portal.Session.create(
        customer=sub.stripe_customer_id,
        return_url=f"{settings.FRONTEND_URL}/billing",
    )

    return {"url": portal.url}


@router.get("/status")
def billing_status(
    uid: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter_by(id=uid).first()
    sub = db.query(Subscription).filter_by(user_id=uid).first()

    if not sub:
        return {
            "tier": user.subscription_tier if user else "free",
            "status": None,
            "source": None,
            "current_period_end": None,
            "cancel_at_period_end": False,
        }

    return {
        "tier": user.subscription_tier if user else "free",
        "status": sub.status,
        "source": sub.source,
        "current_period_end": (
            sub.current_period_end.isoformat() if sub.current_period_end else None
        ),
        "cancel_at_period_end": sub.cancel_at_period_end,
    }


@router.post("/cancel")
def cancel_subscription(
    uid: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter_by(user_id=uid).first()
    if not sub or not sub.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="No active Stripe subscription found")

    stripe.Subscription.modify(sub.stripe_subscription_id, cancel_at_period_end=True)
    sub.cancel_at_period_end = True
    db.commit()

    return {
        "canceled": True,
        "cancel_at_period_end": True,
        "current_period_end": (
            sub.current_period_end.isoformat() if sub.current_period_end else None
        ),
    }


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    # Idempotency: skip replayed events
    try:
        db.add(ProcessedStripeEvent(event_id=event["id"]))
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"received": True}

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        _handle_checkout_completed(data, db)
    elif event_type == "customer.subscription.updated":
        _handle_subscription_updated(data, db)
    elif event_type == "customer.subscription.deleted":
        _handle_subscription_deleted(data, db)
    elif event_type == "invoice.payment_failed":
        _handle_payment_failed(data, db)

    db.commit()
    return {"received": True}


def _handle_checkout_completed(session: dict, db: Session):
    customer_id = session.get("customer")
    subscription_id = session.get("subscription")
    if not customer_id or not subscription_id:
        return

    sub = db.query(Subscription).filter_by(stripe_customer_id=customer_id).first()
    if not sub:
        return

    stripe_sub = stripe.Subscription.retrieve(subscription_id)
    _sync_stripe_subscription(sub, stripe_sub, db)


def _handle_subscription_updated(stripe_sub: dict, db: Session):
    sub = db.query(Subscription).filter_by(
        stripe_subscription_id=stripe_sub.get("id")
    ).first()
    if not sub:
        return

    _sync_stripe_subscription(sub, stripe_sub, db)

    # On hard failure states, downgrade
    if stripe_sub["status"] in ("canceled", "unpaid"):
        user = db.query(User).filter_by(id=sub.user_id).first()
        if user and user.subscription_tier != "admin":
            user.subscription_tier = "free"


def _handle_subscription_deleted(stripe_sub: dict, db: Session):
    sub = db.query(Subscription).filter_by(
        stripe_subscription_id=stripe_sub.get("id")
    ).first()
    if not sub:
        return

    sub.status = "canceled"
    sub.cancel_at_period_end = False

    user = db.query(User).filter_by(id=sub.user_id).first()
    if user and user.subscription_tier != "admin":
        user.subscription_tier = "free"


def _handle_payment_failed(invoice: dict, db: Session):
    subscription_id = invoice.get("subscription")
    if not subscription_id:
        return
    sub = db.query(Subscription).filter_by(
        stripe_subscription_id=subscription_id
    ).first()
    if sub:
        sub.status = "past_due"
