"""
Helper for keeping the navbar badge counts (pending friend requests, unread
recommendations) live across tabs via SSE.

Any handler that mutates a user's pending_requests or unread_recs should call
notify_counts_changed(db, user_id) afterwards. It publishes a single
counts_update event with the freshly recomputed numbers so the frontend
doesn't have to refetch.
"""

from sqlalchemy.orm import Session

from app.core.event_bus import publish
from app.services.friends_service import get_incoming_request_count
from app.services.recommendation_service import get_unread_count


def notify_counts_changed(db: Session, user_id: str) -> None:
    publish(
        user_id,
        {
            "type": "counts_update",
            "pending_requests": get_incoming_request_count(db, user_id),
            "unread_recs": get_unread_count(db, user_id),
        },
    )
