"""
Swipe to match: the people watching tonight each swipe yes or no through the
same short snapshot of picks. Nothing is revealed while people are swiping;
once everyone has been through every card, the results show what everyone
said yes to, then what most of you did, and so on.

- Anyone in the household starts a session for two or more people watching
  (themselves included), with Tonight's filters and a round size (default
  DEFAULT_SIZE cards). Everyone sees the same cards in the same order.
- Until the round is finished, a session shows each person only their own
  votes and everyone's progress: no tallies, so nobody can peek.
- One open session per household: starting another ends the old one.
- Only participants vote. Picking a title (usually a match) or ending the
  session closes it; otherwise it expires after SESSION_HOURS.
- Every change is pushed over the per-user live event stream to the whole
  household, so phones update straight away; clients also poll as a backup.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.event_bus import publish
from app.models.household import HouseholdSession, HouseholdSessionVote
from app.services.household_picks import household_picks
from app.services.household_service import HouseholdError, _lock_household, _member_ids, _membership

SESSION_HOURS = 6
DEFAULT_SIZE = 10
MIN_SIZE, MAX_SIZE = 3, 15
EVENT_TYPE = "household_session"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    # SQLite (the tests) hands back naive datetimes; Postgres doesn't.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _key(content_type: str, content_id: int) -> str:
    return f"{content_type}:{content_id}"


def _notify(db: Session, hid: int, session_id: int, event: str, **extra) -> None:
    for member in _member_ids(db, hid):
        publish(member, {"type": EVENT_TYPE, "household_id": hid, "session_id": session_id,
                         "event": event, **extra})


def _latest_session(db: Session, hid: int) -> HouseholdSession | None:
    """The session to show: the open one, or the last pick (so everyone sees
    what was chosen) until it expires or a new round starts. Ended sessions
    aren't shown."""
    row = (
        db.query(HouseholdSession)
        .filter(HouseholdSession.household_id == hid, HouseholdSession.status.in_(("open", "picked")))
        .order_by(HouseholdSession.created_at.desc(), HouseholdSession.id.desc())
        .first()
    )
    if row is None:
        return None
    if _aware(row.expires_at) <= _now():
        if row.status == "open":
            row.status = "ended"
            row.closed_at = _now()
            db.commit()
        return None
    return row


def _participants(db: Session, row: HouseholdSession) -> list[str]:
    """Who's still taking part: someone who has left the household (or
    deleted their account) no longer counts, so they can't block a match."""
    members = set(_member_ids(db, row.household_id))
    return [p for p in row.participants if p in members]


def _open_session(db: Session, hid: int) -> HouseholdSession | None:
    """The household's open session, closing it first if it has expired."""
    row = (
        db.query(HouseholdSession)
        .filter(HouseholdSession.household_id == hid, HouseholdSession.status == "open")
        .order_by(HouseholdSession.created_at.desc(), HouseholdSession.id.desc())
        .first()
    )
    if row is not None and _aware(row.expires_at) <= _now():
        row.status = "ended"
        row.closed_at = _now()
        db.commit()
        return None
    return row


def _session(db: Session, hid: int, sid: int) -> HouseholdSession:
    row = db.get(HouseholdSession, sid)
    if row is None or row.household_id != hid:
        raise HouseholdError(404, "Session not found")
    return row


def _require_open(row: HouseholdSession) -> None:
    if row.status != "open" or _aware(row.expires_at) <= _now():
        raise HouseholdError(409, "This session has ended")


def _tally(db: Session, row: HouseholdSession) -> tuple[list[str], dict[str, set[str]], dict[str, int], list]:
    """(current participants, yes voters per title, swipes per person, votes)."""
    # populate_existing: a vote just changed by the upsert below is read
    # fresh, not from the session's cached copy.
    votes = (
        db.query(HouseholdSessionVote)
        .filter(HouseholdSessionVote.session_id == row.id)
        .execution_options(populate_existing=True)
        .all()
    )
    participants = _participants(db, row)
    yes: dict[str, set[str]] = {}
    progress = {p: 0 for p in participants}
    for v in votes:
        if v.user_id not in progress:
            continue  # someone who has since left
        progress[v.user_id] += 1
        if v.vote:
            yes.setdefault(_key(v.content_type, v.content_id), set()).add(v.user_id)
    return participants, yes, progress, votes


def _finished(row: HouseholdSession, participants: list[str], progress: dict[str, int]) -> bool:
    """Everyone still taking part has swiped every card."""
    total = len(row.candidates)
    return bool(participants) and all(progress.get(p, 0) >= total for p in participants)


def view(db: Session, uid: str, row: HouseholdSession) -> dict:
    participants, yes, progress, votes = _tally(db, row)
    mine = {_key(v.content_type, v.content_id): v.vote for v in votes if v.user_id == uid}
    finished = _finished(row, participants, progress)
    everyone = set(participants)
    # Revealed once the round is done (or the session is over), never before.
    results = None
    matches: list = []
    if finished or row.status != "open":
        ranked = sorted(
            (
                {**c, "yes": len(yes.get(_key(c["content_type"], c["id"]), set()) & everyone),
                 "of": len(everyone)}
                for c in row.candidates
            ),
            key=lambda c: -c["yes"],  # stable: ties keep the cards' order
        )
        results = [c for c in ranked if c["yes"] > 0]
        matches = [c for c in ranked if everyone and c["yes"] == len(everyone)]
    return {
        "id": row.id,
        "household_id": row.household_id,
        "created_by": row.created_by,
        "participants": participants,
        "status": row.status,
        "expires_at": _aware(row.expires_at).isoformat(),
        "picked": {"content_type": row.picked_type, "id": row.picked_id} if row.picked_id else None,
        "candidates": row.candidates,
        "my_votes": mine,
        "progress": progress,
        "finished": finished,
        # Titles anyone said yes to, most yeses first; None until finished.
        "results": results,
        # Titles everyone said yes to; empty until finished.
        "matches": matches,
    }


def current(db: Session, uid: str, hid: int) -> dict | None:
    _membership(db, hid, uid)
    row = _latest_session(db, hid)
    return view(db, uid, row) if row is not None else None


def start(
    db: Session,
    uid: str,
    hid: int,
    present: list[str],
    time: str = "any",
    services: bool = False,
    kids: bool = False,
    size: int = DEFAULT_SIZE,
) -> dict:
    _membership(db, hid, uid)
    if not MIN_SIZE <= size <= MAX_SIZE:
        raise HouseholdError(422, f"A round is {MIN_SIZE} to {MAX_SIZE} cards")
    members = set(_member_ids(db, hid))
    people = list(dict.fromkeys(p for p in present if p in members))
    if uid not in people:
        raise HouseholdError(422, "Include yourself to start swiping")
    if len(people) < 2:
        raise HouseholdError(422, "Swiping needs at least two people")
    picks = household_picks(db, uid, hid, people, time, services, kids, limit=size)["picks"]
    if not picks:
        raise HouseholdError(422, "Nothing to swipe on with these filters. Try loosening them.")

    # Serialise starts, so two phones tapping Start at once can't leave two
    # sessions open.
    _lock_household(db, hid)
    previous = _open_session(db, hid)
    if previous is not None:
        previous.status = "ended"
        previous.closed_at = _now()
    candidates = [
        {k: p[k] for k in ("content_type", "id", "title", "poster_path", "year", "runtime",
                            "certification", "episode", "services", "reasons")}
        for p in picks
    ]
    row = HouseholdSession(
        household_id=hid,
        created_by=uid,
        participants=people,
        candidates=candidates,
        expires_at=_now() + timedelta(hours=SESSION_HOURS),
    )
    db.add(row)
    db.commit()
    if previous is not None:
        _notify(db, hid, previous.id, "ended")
    _notify(db, hid, row.id, "started", by=uid)
    return view(db, uid, row)


def vote(
    db: Session, uid: str, hid: int, sid: int, content_type: str, content_id: int, yes: bool
) -> dict:
    """Record a swipe. Returns the session; when this vote finished the round
    for everyone, its results are in it and the household hears "finished"."""
    _membership(db, hid, uid)
    row = _session(db, hid, sid)
    _require_open(row)
    participants = _participants(db, row)
    if uid not in participants:
        raise HouseholdError(403, "You're not swiping in this session")
    if len(participants) < 2:
        raise HouseholdError(409, "Not enough people are left in this session. Start a new round.")
    candidate = next(
        (c for c in row.candidates if c["content_type"] == content_type and c["id"] == content_id), None
    )
    if candidate is None:
        raise HouseholdError(404, "That title isn't in this session")

    participants_before, _, progress_before, _ = _tally(db, row)
    was_finished = _finished(row, participants_before, progress_before)
    # Upsert: a double tap or a retry changes the vote instead of failing.
    stmt = pg_insert(HouseholdSessionVote).values(
        session_id=sid, user_id=uid, content_type=content_type, content_id=content_id, vote=yes,
    )
    db.execute(stmt.on_conflict_do_update(
        index_elements=["session_id", "user_id", "content_type", "content_id"],
        set_={"vote": stmt.excluded.vote},
    ))
    db.commit()

    result = view(db, uid, row)
    # Nothing is announced mid-round; "finished" once, when the last card is in.
    _notify(db, hid, sid, "finished" if result["finished"] and not was_finished else "vote")
    return result


def pick(db: Session, uid: str, hid: int, sid: int, content_type: str, content_id: int) -> dict:
    """Settle on a title (normally a match) and close the session."""
    _membership(db, hid, uid)
    row = _session(db, hid, sid)
    _require_open(row)
    if uid not in _participants(db, row):
        raise HouseholdError(403, "You're not swiping in this session")
    candidate = next(
        (c for c in row.candidates if c["content_type"] == content_type and c["id"] == content_id), None
    )
    if candidate is None:
        raise HouseholdError(404, "That title isn't in this session")
    # Any candidate, not only a match: someone can just decide.
    row.status = "picked"
    row.picked_type = content_type
    row.picked_id = content_id
    row.closed_at = _now()
    db.commit()
    _notify(db, hid, sid, "picked", title=candidate["title"], content_type=content_type, id=content_id)
    return view(db, uid, row)


def end(db: Session, uid: str, hid: int, sid: int) -> None:
    """Stop the session without a pick. Any member can, so a forgotten
    session never blocks the household."""
    _membership(db, hid, uid)
    row = _session(db, hid, sid)
    if row.status != "open":
        return
    row.status = "ended"
    row.closed_at = _now()
    db.commit()
    _notify(db, hid, sid, "ended")
