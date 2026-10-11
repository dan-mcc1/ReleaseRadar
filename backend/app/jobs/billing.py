"""Jobs that keep subscriptions in step with Stripe."""
from app.db.session import SessionLocal
from app.jobs.base import logged_task
from app.services.stripe_reconciliation_service import reconcile_stripe_subscriptions


@logged_task
def reconcile_subscriptions() -> None:
    """Bring local subscription state in line with Stripe. A sync, so a
    retry is harmless."""
    db = SessionLocal()
    try:
        reconcile_stripe_subscriptions(db)
    finally:
        db.close()
