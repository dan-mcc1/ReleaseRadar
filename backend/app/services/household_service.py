"""
Households: small private circles (a couple, a family) that share a Watch
together list, see each other's progress on shows they're both watching, and
can log a watch for everyone who was in the room.

Rules:
- 2 to MAX_MEMBERS people; a user can be in up to MAX_HOUSEHOLDS.
- Any member can invite, but only a friend (accepted friendship).
- Joining means housemates see your status and progress on shared titles and
  can log watches for you; the invite screen says so.
- The owner renames, removes members and deletes. Anyone can leave; an owner
  leaving hands ownership to the longest-standing member, and the last member
  leaving deletes the household.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.household import Household, HouseholdInvite, HouseholdItem, HouseholdMember
from app.models.movie import Movie
from app.models.provider import Provider
from app.models.show import Show
from app.models.user import User
from app.models.user_streaming_service import UserStreamingService
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.db.upsert import insert_if_absent
from app.services.friends_service import are_friends
from app.services.media_upsert import ensure_movie_stub_in_db, ensure_show_stub_in_db
from app.services.provider_utils import all_ids_for_service, canonical_provider_id, canonical_provider_name

MAX_MEMBERS = 6
MAX_HOUSEHOLDS = 5
NAME_MAX = 60


class HouseholdError(Exception):
    """A request the rules don't allow. status is the HTTP status to answer with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ── Lookups ──────────────────────────────────────────────────────────────────


def _membership(db: Session, hid: int, uid: str) -> HouseholdMember:
    """The caller's membership, or 404: a household you're not in doesn't
    exist as far as you can tell."""
    row = db.get(HouseholdMember, (hid, uid))
    if row is None:
        raise HouseholdError(404, "Household not found")
    return row


def _lock_household(db: Session, hid: int) -> Household | None:
    """Lock the household row for the rest of the transaction, so concurrent
    invites and accepts count members one at a time. (A no-op on SQLite.)"""
    return db.query(Household).filter(Household.id == hid).with_for_update().first()


def _require_owner(db: Session, hid: int, uid: str) -> None:
    if _membership(db, hid, uid).role != "owner":
        raise HouseholdError(403, "Only the household's owner can do that")


def _member_ids(db: Session, hid: int) -> list[str]:
    return [
        uid for (uid,) in db.query(HouseholdMember.user_id)
        .filter(HouseholdMember.household_id == hid)
        .order_by(HouseholdMember.joined_at, HouseholdMember.user_id)
    ]


def _people(db: Session, uids) -> dict[str, dict]:
    uids = list(uids)
    if not uids:
        return {}
    return {
        u.id: {
            "user_id": u.id,
            "username": u.username,
            "display_name": u.display_name,
            "avatar_key": u.avatar_key,
        }
        for u in db.query(User).filter(User.id.in_(uids))
    }


def _members(db: Session, hid: int) -> list[dict]:
    rows = (
        db.query(HouseholdMember)
        .filter(HouseholdMember.household_id == hid)
        .order_by(HouseholdMember.joined_at, HouseholdMember.user_id)
        .all()
    )
    people = _people(db, [r.user_id for r in rows])
    return [{**people.get(r.user_id, {"user_id": r.user_id}), "role": r.role} for r in rows]


def _clean_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        raise HouseholdError(422, "Give the household a name")
    if len(name) > NAME_MAX:
        raise HouseholdError(422, f"Keep the name under {NAME_MAX} characters")
    return name


def _household_count(db: Session, uid: str) -> int:
    return db.query(func.count()).select_from(HouseholdMember).filter(HouseholdMember.user_id == uid).scalar()


# ── Households ───────────────────────────────────────────────────────────────


def _summary(db: Session, h: Household, uid: str) -> dict:
    members = _members(db, h.id)
    item_count = (
        db.query(func.count()).select_from(HouseholdItem)
        .filter(HouseholdItem.household_id == h.id).scalar()
    )
    role = next((m["role"] for m in members if m["user_id"] == uid), None)
    return {"id": h.id, "name": h.name, "role": role, "members": members, "item_count": item_count}


def list_for_user(db: Session, uid: str) -> dict:
    households = (
        db.query(Household)
        .join(HouseholdMember, HouseholdMember.household_id == Household.id)
        .filter(HouseholdMember.user_id == uid)
        .order_by(Household.created_at, Household.id)
        .all()
    )
    return {
        "households": [_summary(db, h, uid) for h in households],
        "invites": pending_invites(db, uid),
    }


def create(db: Session, uid: str, name: str) -> dict:
    name = _clean_name(name)
    if _household_count(db, uid) >= MAX_HOUSEHOLDS:
        raise HouseholdError(409, f"You can be in up to {MAX_HOUSEHOLDS} households")
    h = Household(name=name, created_by=uid)
    db.add(h)
    db.flush()
    db.add(HouseholdMember(household_id=h.id, user_id=uid, role="owner"))
    db.commit()
    return _summary(db, h, uid)


def rename(db: Session, uid: str, hid: int, name: str) -> dict:
    _require_owner(db, hid, uid)
    h = db.get(Household, hid)
    h.name = _clean_name(name)
    db.commit()
    return _summary(db, h, uid)


def delete(db: Session, uid: str, hid: int) -> list[str]:
    """Delete the household. Returns the pending invitees, whose badge count
    changes."""
    _require_owner(db, hid, uid)
    invitees = _delete_household(db, hid)
    db.commit()
    return invitees


def _delete_household(db: Session, hid: int) -> list[str]:
    invitees = [
        uid for (uid,) in db.query(HouseholdInvite.user_id)
        .filter(HouseholdInvite.household_id == hid, HouseholdInvite.status == "pending")
    ]
    # Explicit rather than relying on ON DELETE CASCADE, like account deletion.
    for model in (HouseholdItem, HouseholdInvite, HouseholdMember):
        db.query(model).filter(model.household_id == hid).delete(synchronize_session=False)
    db.query(Household).filter(Household.id == hid).delete(synchronize_session=False)
    return invitees


def remove_member(db: Session, uid: str, hid: int, target: str) -> list[str]:
    """Leave (target is yourself) or, as the owner, remove someone. Returns
    pending invitees whose invite went with the household, if it emptied."""
    me = _membership(db, hid, uid)
    if target != uid and me.role != "owner":
        raise HouseholdError(403, "Only the household's owner can remove people")
    row = db.get(HouseholdMember, (hid, target))
    if row is None:
        raise HouseholdError(404, "They're not in this household")
    invitees = _leave(db, row)
    db.commit()
    return invitees


def _leave(db: Session, row: HouseholdMember) -> list[str]:
    hid, was_owner = row.household_id, row.role == "owner"
    db.delete(row)
    db.flush()
    remaining = (
        db.query(HouseholdMember)
        .filter(HouseholdMember.household_id == hid)
        .order_by(HouseholdMember.joined_at, HouseholdMember.user_id)
        .all()
    )
    if not remaining:
        return _delete_household(db, hid)
    if was_owner:
        remaining[0].role = "owner"
    return []


def remove_user_everywhere(db: Session, uid: str) -> None:
    """For account deletion: leave every household (handing ownership on or
    deleting empty ones) and drop the user's invites. Doesn't commit."""
    for row in db.query(HouseholdMember).filter(HouseholdMember.user_id == uid).all():
        _leave(db, row)
    db.query(HouseholdInvite).filter(HouseholdInvite.user_id == uid).delete(synchronize_session=False)


# ── Invites ──────────────────────────────────────────────────────────────────


def pending_invites(db: Session, uid: str) -> list[dict]:
    rows = (
        db.query(HouseholdInvite, Household)
        .join(Household, Household.id == HouseholdInvite.household_id)
        .filter(HouseholdInvite.user_id == uid, HouseholdInvite.status == "pending")
        .order_by(HouseholdInvite.created_at.desc())
        .all()
    )
    people = _people(db, {i.invited_by for i, _ in rows if i.invited_by})
    return [
        {
            "id": i.id,
            "household": {"id": h.id, "name": h.name, "member_count": len(_member_ids(db, h.id))},
            "invited_by": people.get(i.invited_by),
            "created_at": i.created_at.isoformat() if i.created_at else None,
        }
        for i, h in rows
    ]


def invitable(db: Session, uid: str, hid: int) -> list[dict]:
    """The caller's friends who aren't in the household, for the invite
    picker, each marked with whether they already have a pending invite."""
    from app.services.friends_service import get_friends

    _membership(db, hid, uid)
    members = set(_member_ids(db, hid))
    pending = {
        user_id for (user_id,) in db.query(HouseholdInvite.user_id)
        .filter(HouseholdInvite.household_id == hid, HouseholdInvite.status == "pending")
    }
    friend_ids = [f["friend"]["id"] for f in get_friends(db, uid)]
    people = _people(db, [f for f in friend_ids if f not in members])
    return sorted(
        ({**p, "invited": p["user_id"] in pending} for p in people.values()),
        key=lambda p: (p["display_name"] or p["username"] or "").lower(),
    )


def pending_invite_count(db: Session, uid: str) -> int:
    return (
        db.query(func.count()).select_from(HouseholdInvite)
        .filter(HouseholdInvite.user_id == uid, HouseholdInvite.status == "pending")
        .scalar()
    )


def invite(db: Session, uid: str, hid: int, username: str) -> dict:
    """Invite a friend. Returns the invitee's id and username."""
    _membership(db, hid, uid)
    invitee = db.query(User).filter(func.lower(User.username) == (username or "").strip().lower()).first()
    if invitee is None or invitee.id == uid or not are_friends(db, uid, invitee.id):
        # Same answer for "no such user" and "not your friend": no probing.
        raise HouseholdError(404, "You can only invite people you're friends with")
    if db.get(HouseholdMember, (hid, invitee.id)) is not None:
        raise HouseholdError(409, f"{invitee.username} is already in this household")
    _lock_household(db, hid)
    row = (
        db.query(HouseholdInvite)
        .filter(HouseholdInvite.household_id == hid, HouseholdInvite.user_id == invitee.id)
        .first()
    )
    if row is not None and row.status == "pending":
        db.commit()  # already invited: nothing to do, and no cap to hit
        return {"id": row.id, "user_id": invitee.id, "username": invitee.username}
    pending = (
        db.query(func.count()).select_from(HouseholdInvite)
        .filter(HouseholdInvite.household_id == hid, HouseholdInvite.status == "pending")
        .scalar()
    )
    if len(_member_ids(db, hid)) + pending >= MAX_MEMBERS:
        raise HouseholdError(409, f"A household can have up to {MAX_MEMBERS} people, invites included")

    if row is None:
        row = HouseholdInvite(household_id=hid, user_id=invitee.id, invited_by=uid)
        db.add(row)
    else:  # re-invite after a decline
        row.status = "pending"
        row.invited_by = uid
        row.created_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": row.id, "user_id": invitee.id, "username": invitee.username}


def cancel_invite(db: Session, uid: str, hid: int, invite_id: int) -> str:
    """Withdraw a pending invite (the owner, or whoever sent it). Returns the
    invitee's id, whose badge count changed."""
    me = _membership(db, hid, uid)
    row = db.get(HouseholdInvite, invite_id)
    if row is None or row.household_id != hid or row.status != "pending":
        raise HouseholdError(404, "Invite not found")
    if me.role != "owner" and row.invited_by != uid:
        raise HouseholdError(403, "Only the owner or the person who sent it can cancel an invite")
    invitee = row.user_id
    db.delete(row)
    db.commit()
    return invitee


def _own_invite(db: Session, uid: str, invite_id: int) -> HouseholdInvite:
    row = db.get(HouseholdInvite, invite_id)
    if row is None or row.user_id != uid or row.status != "pending":
        raise HouseholdError(404, "Invite not found")
    return row


def accept_invite(db: Session, uid: str, invite_id: int) -> dict:
    row = _own_invite(db, uid, invite_id)
    hid = row.household_id
    _lock_household(db, hid)
    if _household_count(db, uid) >= MAX_HOUSEHOLDS:
        raise HouseholdError(409, f"You can be in up to {MAX_HOUSEHOLDS} households. Leave one first.")
    if len(_member_ids(db, hid)) >= MAX_MEMBERS:
        raise HouseholdError(409, "That household is full")
    db.add(HouseholdMember(household_id=hid, user_id=uid, role="member"))
    db.delete(row)
    try:
        db.commit()
    except IntegrityError:  # accepted twice at once: the first one won
        db.rollback()
        if db.get(HouseholdMember, (hid, uid)) is None:
            raise
    return _summary(db, db.get(Household, hid), uid)


def decline_invite(db: Session, uid: str, invite_id: int) -> None:
    row = _own_invite(db, uid, invite_id)
    row.status = "declined"
    db.commit()


# ── The shared list ─────────────────────────────────────────────────────────


def _statuses(db: Session, uids: list[str], keys: set[tuple[str, int]]) -> dict[tuple[str, int], dict[str, str]]:
    """Each member's list status for each title: {key: {user_id: status}}."""
    out: dict[tuple[str, int], dict[str, str]] = {k: {} for k in keys}
    if not uids or not keys:
        return out
    ids = {cid for _, cid in keys}
    for model, label in ((Watchlist, "Want To Watch"), (CurrentlyWatching, "Currently Watching"), (Watched, "Watched")):
        for user_id, ct, cid in db.query(model.user_id, model.content_type, model.content_id).filter(
            model.user_id.in_(uids), model.content_id.in_(ids)
        ):
            if (ct, cid) in out:
                out[(ct, cid)][user_id] = label
    return out


def _title_rows(db: Session, keys: set[tuple[str, int]]) -> dict[tuple[str, int], dict]:
    info: dict[tuple[str, int], dict] = {}
    tv = [cid for ct, cid in keys if ct == "tv"]
    mv = [cid for ct, cid in keys if ct == "movie"]
    if tv:
        for s in db.query(Show.id, Show.name, Show.poster_path, Show.first_air_date).filter(Show.id.in_(tv)):
            info[("tv", s.id)] = {"title": s.name, "poster_path": s.poster_path,
                                  "year": s.first_air_date.year if s.first_air_date else None}
    if mv:
        for m in db.query(Movie.id, Movie.title, Movie.poster_path, Movie.release_date).filter(Movie.id.in_(mv)):
            info[("movie", m.id)] = {"title": m.title, "poster_path": m.poster_path,
                                     "year": m.release_date.year if m.release_date else None}
    return info


def _items(db: Session, hid: int, uids: list[str]) -> list[dict]:
    rows = (
        db.query(HouseholdItem)
        .filter(HouseholdItem.household_id == hid)
        .order_by(HouseholdItem.added_at.desc(), HouseholdItem.id.desc())
        .all()
    )
    keys = {(r.content_type, r.content_id) for r in rows}
    info = _title_rows(db, keys)
    statuses = _statuses(db, uids, keys)
    people = _people(db, {r.added_by for r in rows if r.added_by})
    return [
        {
            "content_type": r.content_type,
            "id": r.content_id,
            **info.get((r.content_type, r.content_id), {"title": None, "poster_path": None, "year": None}),
            "added_by": people.get(r.added_by),
            "added_at": r.added_at.isoformat() if r.added_at else None,
            "member_status": statuses.get((r.content_type, r.content_id), {}),
        }
        for r in rows
    ]


def _services(db: Session, uids: list[str]) -> list[dict]:
    """The household's streaming services between them, with who has each."""
    who: dict[int, set[str]] = {}
    for user_id, pid in db.query(UserStreamingService.user_id, UserStreamingService.provider_id).filter(
        UserStreamingService.user_id.in_(uids)
    ):
        who.setdefault(canonical_provider_id(pid), set()).add(user_id)
    if not who:
        return []
    wanted = {pid: cpid for cpid in who for pid in all_ids_for_service(cpid)}
    shown: dict[int, dict] = {}
    for p in db.query(Provider).filter(Provider.id.in_(list(wanted))):
        cpid = wanted[p.id]
        if cpid not in shown or p.id == cpid:
            shown[cpid] = {"name": canonical_provider_name(p.id, p.name), "logo_path": p.logo_path}
    order = {u: i for i, u in enumerate(uids)}
    return sorted(
        (
            {"id": cpid, **shown.get(cpid, {"name": f"Service {cpid}", "logo_path": None}),
             "user_ids": sorted(members, key=lambda u: order.get(u, 99))}
            for cpid, members in who.items()
        ),
        key=lambda s: s["name"].lower(),
    )


def detail(db: Session, uid: str, hid: int) -> dict:
    me = _membership(db, hid, uid)
    h = db.get(Household, hid)
    uids = _member_ids(db, hid)
    invites = (
        db.query(HouseholdInvite)
        .filter(HouseholdInvite.household_id == hid, HouseholdInvite.status == "pending")
        .order_by(HouseholdInvite.created_at)
        .all()
    )
    invitees = _people(db, [i.user_id for i in invites])
    return {
        "id": h.id,
        "name": h.name,
        "role": me.role,
        "members": _members(db, hid),
        "invites": [
            {"id": i.id, **invitees.get(i.user_id, {"user_id": i.user_id}), "invited_by": i.invited_by}
            for i in invites
        ],
        "items": _items(db, hid, uids),
        "services": _services(db, uids),
        "max_members": MAX_MEMBERS,
    }


def add_item(db: Session, uid: str, hid: int, content_type: str, content_id: int) -> None:
    _membership(db, hid, uid)
    if content_type not in ("tv", "movie"):
        raise HouseholdError(422, "content_type must be 'tv' or 'movie'")
    exists = (
        db.query(HouseholdItem.id)
        .filter_by(household_id=hid, content_type=content_type, content_id=content_id)
        .first()
    )
    if exists:
        return
    # A stub row so the list can show a title and poster straight away.
    (ensure_show_stub_in_db if content_type == "tv" else ensure_movie_stub_in_db)(db, content_id)
    # ON CONFLICT: a double-click or two members adding it at once.
    insert_if_absent(
        db,
        HouseholdItem,
        {"household_id": hid, "content_type": content_type, "content_id": content_id, "added_by": uid},
        ("household_id", "content_type", "content_id"),
    )
    db.commit()


def remove_item(db: Session, uid: str, hid: int, content_type: str, content_id: int) -> None:
    _membership(db, hid, uid)
    db.query(HouseholdItem).filter_by(
        household_id=hid, content_type=content_type, content_id=content_id
    ).delete(synchronize_session=False)
    db.commit()


def containing(db: Session, uid: str, content_type: str, content_id: int) -> list[int]:
    """Which of the user's households have this title on their shared list."""
    return [
        hid for (hid,) in db.query(HouseholdItem.household_id)
        .join(HouseholdMember, HouseholdMember.household_id == HouseholdItem.household_id)
        .filter(
            HouseholdMember.user_id == uid,
            HouseholdItem.content_type == content_type,
            HouseholdItem.content_id == content_id,
        )
    ]


# ── Progress on shared shows ────────────────────────────────────────────────


def progress(db: Session, uid: str, hid: int, today: date | None = None) -> dict:
    """
    Shows at least two members have started (or one has, if it's on the
    shared list), with each member's furthest-watched episode and next one,
    and the next episode for the group: the furthest-behind member's next.
    Shows everyone has finished are left out.
    """
    _membership(db, hid, uid)
    today = today or date.today()
    uids = _member_ids(db, hid)

    shared = {
        cid for (cid,) in db.query(HouseholdItem.content_id)
        .filter(HouseholdItem.household_id == hid, HouseholdItem.content_type == "tv")
    }
    # Shows two members have started, or one has and it's on the shared list:
    # one aggregate query, so only those shows' watch rows get loaded.
    started = {
        sid: n for sid, n in db.query(EpisodeWatched.show_id, func.count(func.distinct(EpisodeWatched.user_id)))
        .filter(EpisodeWatched.user_id.in_(uids), EpisodeWatched.season_number > 0)
        .group_by(EpisodeWatched.show_id)
    }
    show_ids = [sid for sid, n in started.items() if n >= 2 or sid in shared]
    if not show_ids:
        return {"shows": []}

    furthest: dict[int, dict[str, tuple[int, int]]] = {}
    counts: dict[int, dict[str, int]] = {}
    for user_id, sid, sn, en in db.query(
        EpisodeWatched.user_id, EpisodeWatched.show_id,
        EpisodeWatched.season_number, EpisodeWatched.episode_number,
    ).filter(
        EpisodeWatched.user_id.in_(uids),
        EpisodeWatched.show_id.in_(show_ids),
        EpisodeWatched.season_number > 0,
    ):
        pos = furthest.setdefault(sid, {})
        if user_id not in pos or (sn, en) > pos[user_id]:
            pos[user_id] = (sn, en)
        counts.setdefault(sid, {})
        counts[sid][user_id] = counts[sid].get(user_id, 0) + 1

    aired: dict[int, list[tuple[int, int, str | None, str | None]]] = {}
    for sid, sn, en, name, air_date in (
        db.query(Episode.show_id, Episode.season_number, Episode.episode_number, Episode.name, Episode.air_date)
        .filter(
            Episode.show_id.in_(show_ids),
            Episode.season_number > 0,
            Episode.air_date.isnot(None),
            Episode.air_date <= today,
        )
        .order_by(Episode.show_id, Episode.season_number, Episode.episode_number)
    ):
        aired.setdefault(sid, []).append((sn, en, name, air_date.isoformat()))

    info = _title_rows(db, {("tv", sid) for sid in show_ids})
    shows = []
    for sid in show_ids:
        episodes = aired.get(sid, [])
        def next_index(pos: tuple[int, int] | None) -> int | None:
            if pos is None:
                return 0 if episodes else None
            # The first aired episode after their furthest-watched one.
            for i, (sn, en, _, _) in enumerate(episodes):
                if (sn, en) > pos:
                    return i
            return None

        members = []
        nexts = []
        for user_id in uids:
            pos = furthest[sid].get(user_id)
            ni = next_index(pos)
            if pos is not None or sid in shared:
                nexts.append(ni)
            members.append({
                "user_id": user_id,
                "last_watched": {"season_number": pos[0], "episode_number": pos[1]} if pos else None,
                "watched_count": counts.get(sid, {}).get(user_id, 0),
                "next": _ep(episodes[ni]) if ni is not None else None,
                "_ni": ni,
            })
        pending = [ni for ni in nexts if ni is not None]
        if not pending:
            continue  # everyone involved is caught up
        together = min(pending)
        for m in members:
            ni = m.pop("_ni")
            # How far ahead of the group's next episode this member is.
            m["ahead_by"] = (len(episodes) if ni is None else ni) - together if m["last_watched"] else 0
        shows.append({
            "id": sid,
            **info.get(("tv", sid), {"title": None, "poster_path": None, "year": None}),
            "total_aired": len(episodes),
            "members": members,
            "together_next": _ep(episodes[together]),
        })
    shows.sort(key=lambda s: (s["title"] or "").lower())
    return {"shows": shows}


def _ep(e: tuple[int, int, str | None, str | None]) -> dict:
    return {"season_number": e[0], "episode_number": e[1], "name": e[2], "air_date": e[3]}


# ── Logging a watch for the room ────────────────────────────────────────────


def log_watch(
    db: Session,
    uid: str,
    hid: int,
    user_ids: list[str],
    content_type: str,
    content_id: int,
    season_number: int | None = None,
    episode_number: int | None = None,
) -> list[str]:
    """
    Log a movie, an episode, or a whole season for each of user_ids (members
    who watched it together, the caller included or not). Goes through the
    same paths as logging it yourself, so auto-complete and list moves
    happen; housemates' entries are marked as logged by the caller.
    Returns the user ids it logged for.
    """
    from app.services.currently_watching_service import remove_from_currently_watching
    from app.services.episode_service import sync_season_episodes
    from app.services.watched_episode_service import add_episode_watched, add_season_watched
    from app.services.watched_service import add_to_watched
    from app.services.watchlist_service import remove_from_watchlist

    _membership(db, hid, uid)
    members = set(_member_ids(db, hid))
    targets = list(dict.fromkeys(user_ids))  # de-dupe, keep order
    if not targets:
        raise HouseholdError(422, "Pick who watched")
    if not set(targets) <= members:
        raise HouseholdError(403, "You can only log watches for people in this household")

    if content_type == "movie":
        for target in targets:
            add_to_watched(db, target, "movie", content_id, logged_by=None if target == uid else uid)
            remove_from_watchlist(db, target, "movie", content_id)
            remove_from_currently_watching(db, target, "movie", content_id)
        db.commit()
        return targets

    if content_type != "tv" or season_number is None:
        raise HouseholdError(422, "Say which season (and episode) you watched")
    # Once, rather than once per person inside add_episode/season_watched.
    sync_season_episodes(db, content_id, season_number)
    if episode_number is None:
        for target in targets:
            add_season_watched(db, target, content_id, season_number)
        return targets

    ep = (
        db.query(Episode.air_date)
        .filter_by(show_id=content_id, season_number=season_number, episode_number=episode_number)
        .first()
    )
    if ep is None:
        raise HouseholdError(404, "We couldn't find that episode")
    # A day's grace, like the watched-episode routes: the client's local date
    # can be a day ahead of UTC.
    latest = datetime.now(timezone.utc).date() + timedelta(days=1)
    if ep.air_date is None or ep.air_date > latest:
        raise HouseholdError(400, "That episode hasn't aired yet")
    for target in targets:
        add_episode_watched(
            db, target, content_id, season_number, episode_number,
            logged_by=None if target == uid else uid,
        )
    return targets
