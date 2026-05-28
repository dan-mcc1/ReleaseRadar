"""League-owner admin actions: manual entry of renewal/cancellation events,
and triggering scoring runs on demand."""
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.fantasy import (
    FantasyLeagueMember,
    FantasyRenewalEvent,
)
from app.models.show import Show

VALID_RENEWAL_TYPES = {"renewed", "cancelled"}


def _user_owns_any_league(db: Session, user_id: str) -> bool:
    return (
        db.query(FantasyLeagueMember.user_id)
        .filter(
            FantasyLeagueMember.user_id == user_id,
            FantasyLeagueMember.role == "owner",
        )
        .first()
        is not None
    )


def record_renewal_event(
    db: Session,
    user_id: str,
    *,
    show_id: int,
    event_type: str,
    announced_at: datetime,
    note: str | None = None,
) -> dict:
    """Renewal events are global — they affect all leagues that have the show
    rostered. Restricted to users who own at least one league so randos can't
    write noise into the table."""
    if not _user_owns_any_league(db, user_id):
        raise HTTPException(
            status_code=403,
            detail="Only league owners can record renewal events.",
        )

    if event_type not in VALID_RENEWAL_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"event_type must be one of {sorted(VALID_RENEWAL_TYPES)}.",
        )

    if not db.query(Show.id).filter(Show.id == show_id).first():
        raise HTTPException(status_code=404, detail="Show not found.")

    event = FantasyRenewalEvent(
        show_id=show_id,
        event_type=event_type,
        announced_at=announced_at,
        note=note,
        created_by=user_id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _serialize_renewal(event)


def list_renewal_events(db: Session, show_id: int) -> list[dict]:
    rows = (
        db.query(FantasyRenewalEvent)
        .filter(FantasyRenewalEvent.show_id == show_id)
        .order_by(FantasyRenewalEvent.announced_at.desc())
        .all()
    )
    return [_serialize_renewal(r) for r in rows]


def delete_renewal_event(db: Session, user_id: str, event_id: int) -> None:
    event = db.get(FantasyRenewalEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if event.created_by != user_id and not _user_owns_any_league(db, user_id):
        raise HTTPException(status_code=403, detail="Not allowed.")
    db.delete(event)
    db.commit()


def _serialize_renewal(event: FantasyRenewalEvent) -> dict:
    return {
        "id": event.id,
        "show_id": event.show_id,
        "event_type": event.event_type,
        "announced_at": event.announced_at,
        "note": event.note,
        "created_by": event.created_by,
        "created_at": event.created_at,
    }
