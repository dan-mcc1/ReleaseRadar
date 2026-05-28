"""CRUD + membership + season management for fantasy leagues."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.fantasy import (
    FantasyAsset,
    FantasyLeague,
    FantasyLeagueInvitation,
    FantasyLeagueMember,
    FantasySeason,
)
from app.models.user import User


MAX_LEAGUES_OWNED = 5
LEAGUE_NAME_MIN_LEN = 2
LEAGUE_NAME_MAX_LEN = 80

VALID_SEASON_CODES = {"summer", "fall", "holiday", "spring"}
VALID_SEASON_STATUSES = {"upcoming", "draft", "active", "complete"}
VALID_MEMBER_ROLES = {"owner", "admin", "member"}


# ─── Serializers ────────────────────────────────────────────────────────────


def _serialize_user(u: User | None) -> dict | None:
    if not u:
        return None
    return {"id": u.id, "username": u.username, "display_name": u.display_name}


def _serialize_league(
    league: FantasyLeague, viewer_role: str | None = None
) -> dict:
    return {
        "id": league.id,
        "name": league.name,
        "owner_id": league.owner_id,
        "current_season_id": league.current_season_id,
        "starting_budget": league.starting_budget,
        "weekly_allowance": league.weekly_allowance,
        "roster_movie_slots": league.roster_movie_slots,
        "roster_tv_slots": league.roster_tv_slots,
        "roster_flex_slots": league.roster_flex_slots,
        "bench_slots": league.bench_slots,
        "boost_slots": league.boost_slots,
        "max_members": league.max_members,
        "created_at": league.created_at,
        "viewer_role": viewer_role,
    }


def _serialize_member(member: FantasyLeagueMember, user: User | None) -> dict:
    return {
        "user_id": member.user_id,
        "username": user.username if user else None,
        "user_display_name": user.display_name if user else None,
        "display_name": member.display_name,
        "role": member.role,
        "budget_remaining": member.budget_remaining,
        "joined_at": member.joined_at,
    }


def _serialize_season(season: FantasySeason) -> dict:
    return {
        "id": season.id,
        "league_id": season.league_id,
        "name": season.name,
        "code": season.code,
        "year": season.year,
        "starts_at": season.starts_at,
        "ends_at": season.ends_at,
        "status": season.status,
        "created_at": season.created_at,
    }


# ─── Authorization helpers ──────────────────────────────────────────────────


def _get_member(
    db: Session, league_id: int, user_id: str
) -> FantasyLeagueMember | None:
    return (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == league_id,
            FantasyLeagueMember.user_id == user_id,
        )
        .first()
    )


def _require_league(db: Session, league_id: int) -> FantasyLeague:
    league = db.get(FantasyLeague, league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found.")
    return league


def _require_role(
    db: Session, league_id: int, user_id: str, allowed: tuple[str, ...]
) -> tuple[FantasyLeague, FantasyLeagueMember]:
    league = _require_league(db, league_id)
    member = _get_member(db, league_id, user_id)
    if not member or member.role not in allowed:
        raise HTTPException(
            status_code=403, detail="You don't have permission to do that."
        )
    return league, member


# ─── League CRUD ────────────────────────────────────────────────────────────


def create_league(
    db: Session,
    user_id: str,
    *,
    name: str,
    starting_budget: int | None = None,
    weekly_allowance: int | None = None,
    roster_movie_slots: int | None = None,
    roster_tv_slots: int | None = None,
    roster_flex_slots: int | None = None,
    bench_slots: int | None = None,
    boost_slots: int | None = None,
    max_members: int | None = None,
) -> dict:
    name = (name or "").strip()
    if not (LEAGUE_NAME_MIN_LEN <= len(name) <= LEAGUE_NAME_MAX_LEN):
        raise HTTPException(
            status_code=422,
            detail=f"Name must be {LEAGUE_NAME_MIN_LEN}-{LEAGUE_NAME_MAX_LEN} characters.",
        )

    owned = (
        db.query(func.count(FantasyLeague.id))
        .filter(FantasyLeague.owner_id == user_id)
        .scalar()
        or 0
    )
    if owned >= MAX_LEAGUES_OWNED:
        raise HTTPException(
            status_code=429,
            detail=f"You can own at most {MAX_LEAGUES_OWNED} leagues.",
        )

    league = FantasyLeague(name=name, owner_id=user_id)
    for field, value in {
        "starting_budget": starting_budget,
        "weekly_allowance": weekly_allowance,
        "roster_movie_slots": roster_movie_slots,
        "roster_tv_slots": roster_tv_slots,
        "roster_flex_slots": roster_flex_slots,
        "bench_slots": bench_slots,
        "boost_slots": boost_slots,
        "max_members": max_members,
    }.items():
        if value is not None:
            setattr(league, field, value)

    db.add(league)
    db.flush()
    db.refresh(league)  # populate server_default values before using starting_budget

    db.add(
        FantasyLeagueMember(
            league_id=league.id,
            user_id=user_id,
            role="owner",
            budget_remaining=league.starting_budget,
        )
    )
    db.commit()
    db.refresh(league)
    return _serialize_league(league, viewer_role="owner")


def update_league(
    db: Session,
    user_id: str,
    league_id: int,
    *,
    name: str | None = None,
    starting_budget: int | None = None,
    weekly_allowance: int | None = None,
    roster_movie_slots: int | None = None,
    roster_tv_slots: int | None = None,
    roster_flex_slots: int | None = None,
    bench_slots: int | None = None,
    boost_slots: int | None = None,
    max_members: int | None = None,
) -> dict:
    league, member = _require_role(db, league_id, user_id, ("owner",))

    if name is not None:
        name = name.strip()
        if not (LEAGUE_NAME_MIN_LEN <= len(name) <= LEAGUE_NAME_MAX_LEN):
            raise HTTPException(status_code=422, detail="Invalid name length.")
        league.name = name

    for field, value in {
        "starting_budget": starting_budget,
        "weekly_allowance": weekly_allowance,
        "roster_movie_slots": roster_movie_slots,
        "roster_tv_slots": roster_tv_slots,
        "roster_flex_slots": roster_flex_slots,
        "bench_slots": bench_slots,
        "boost_slots": boost_slots,
        "max_members": max_members,
    }.items():
        if value is not None:
            if value < 0:
                raise HTTPException(status_code=422, detail=f"{field} must be >= 0.")
            setattr(league, field, value)

    db.commit()
    db.refresh(league)
    return _serialize_league(league, viewer_role=member.role)


def delete_league(db: Session, user_id: str, league_id: int) -> None:
    league, _ = _require_role(db, league_id, user_id, ("owner",))
    db.delete(league)
    db.commit()


def get_league(db: Session, viewer_id: str, league_id: int) -> dict:
    league = _require_league(db, league_id)
    member = _get_member(db, league_id, viewer_id)
    if not member:
        raise HTTPException(status_code=404, detail="League not found.")
    payload = _serialize_league(league, viewer_role=member.role)
    payload["members"] = list_members(db, viewer_id, league_id)
    return payload


def list_my_leagues(db: Session, user_id: str) -> list[dict]:
    rows = (
        db.query(FantasyLeague, FantasyLeagueMember.role)
        .join(
            FantasyLeagueMember,
            FantasyLeagueMember.league_id == FantasyLeague.id,
        )
        .filter(FantasyLeagueMember.user_id == user_id)
        .order_by(FantasyLeague.created_at.desc())
        .all()
    )
    return [_serialize_league(league, viewer_role=role) for league, role in rows]


# ─── Members ────────────────────────────────────────────────────────────────


def list_members(db: Session, viewer_id: str, league_id: int) -> list[dict]:
    if not _get_member(db, league_id, viewer_id):
        raise HTTPException(status_code=404, detail="League not found.")
    rows = (
        db.query(FantasyLeagueMember, User)
        .outerjoin(User, User.id == FantasyLeagueMember.user_id)
        .filter(FantasyLeagueMember.league_id == league_id)
        .order_by(FantasyLeagueMember.joined_at.asc())
        .all()
    )
    return [_serialize_member(m, u) for m, u in rows]


def add_member_by_username(
    db: Session,
    owner_id: str,
    league_id: int,
    *,
    username: str,
    display_name: str | None = None,
) -> dict:
    league, _ = _require_role(db, league_id, owner_id, ("owner", "admin"))

    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    if _get_member(db, league_id, target.id):
        raise HTTPException(
            status_code=409, detail="That user is already in the league."
        )

    member_count = (
        db.query(func.count(FantasyLeagueMember.user_id))
        .filter(FantasyLeagueMember.league_id == league_id)
        .scalar()
        or 0
    )
    if member_count >= league.max_members:
        raise HTTPException(status_code=429, detail="League is full.")

    member = FantasyLeagueMember(
        league_id=league_id,
        user_id=target.id,
        role="member",
        display_name=display_name,
        budget_remaining=league.starting_budget,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return _serialize_member(member, target)


def remove_member(
    db: Session, owner_id: str, league_id: int, target_user_id: str
) -> None:
    league, _ = _require_role(db, league_id, owner_id, ("owner",))
    if target_user_id == league.owner_id:
        raise HTTPException(
            status_code=422, detail="Owner cannot be removed; delete the league instead."
        )
    member = _get_member(db, league_id, target_user_id)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found.")
    db.delete(member)
    db.commit()


# ─── Invitations ────────────────────────────────────────────────────────────


def _serialize_invitation(
    inv: FantasyLeagueInvitation,
    league: FantasyLeague | None = None,
    inviter: User | None = None,
    invitee: User | None = None,
) -> dict:
    out: dict = {
        "id": inv.id,
        "league_id": inv.league_id,
        "user_id": inv.user_id,
        "invited_by": inv.invited_by,
        "created_at": inv.created_at,
    }
    if league:
        out["league"] = {
            "id": league.id,
            "name": league.name,
            "owner_id": league.owner_id,
            "starting_budget": league.starting_budget,
            "max_members": league.max_members,
        }
    if inviter:
        out["inviter"] = _serialize_user(inviter)
    if invitee:
        out["invitee"] = _serialize_user(invitee)
    return out


def invite_user_by_username(
    db: Session,
    inviter_id: str,
    league_id: int,
    *,
    username: str,
) -> dict:
    """Owner sends a pending invitation. Invitee must accept before becoming a
    member. Returns the serialized invitation row."""
    league, _ = _require_role(db, league_id, inviter_id, ("owner", "admin"))

    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if target.id == inviter_id:
        raise HTTPException(status_code=400, detail="You can't invite yourself.")
    if _get_member(db, league_id, target.id):
        raise HTTPException(
            status_code=409, detail="That user is already in the league."
        )

    existing = (
        db.query(FantasyLeagueInvitation)
        .filter(
            FantasyLeagueInvitation.league_id == league_id,
            FantasyLeagueInvitation.user_id == target.id,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="That user already has a pending invitation."
        )

    member_count = (
        db.query(func.count(FantasyLeagueMember.user_id))
        .filter(FantasyLeagueMember.league_id == league_id)
        .scalar()
        or 0
    )
    pending_count = (
        db.query(func.count(FantasyLeagueInvitation.id))
        .filter(FantasyLeagueInvitation.league_id == league_id)
        .scalar()
        or 0
    )
    if member_count + pending_count >= league.max_members:
        raise HTTPException(
            status_code=429,
            detail="League is full (members + pending invitations).",
        )

    inv = FantasyLeagueInvitation(
        league_id=league_id, user_id=target.id, invited_by=inviter_id
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _serialize_invitation(inv, league=league, invitee=target)


def list_league_invitations(
    db: Session, viewer_id: str, league_id: int
) -> list[dict]:
    """Owner sees who they've invited and who's pending."""
    _require_role(db, league_id, viewer_id, ("owner", "admin"))
    rows = (
        db.query(FantasyLeagueInvitation, User)
        .outerjoin(User, User.id == FantasyLeagueInvitation.user_id)
        .filter(FantasyLeagueInvitation.league_id == league_id)
        .order_by(FantasyLeagueInvitation.created_at.desc())
        .all()
    )
    return [_serialize_invitation(inv, invitee=user) for inv, user in rows]


def cancel_invitation(
    db: Session, actor_id: str, league_id: int, invitation_id: int
) -> None:
    """Owner cancels a pending invitation."""
    _require_role(db, league_id, actor_id, ("owner", "admin"))
    inv = (
        db.query(FantasyLeagueInvitation)
        .filter(
            FantasyLeagueInvitation.id == invitation_id,
            FantasyLeagueInvitation.league_id == league_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found.")
    db.delete(inv)
    db.commit()


def list_my_invitations(db: Session, user_id: str) -> list[dict]:
    """Pending invitations for the current user, newest first. Includes league
    + inviter metadata so the inbox UI renders without extra calls."""
    rows = (
        db.query(FantasyLeagueInvitation, FantasyLeague, User)
        .join(FantasyLeague, FantasyLeague.id == FantasyLeagueInvitation.league_id)
        .outerjoin(User, User.id == FantasyLeagueInvitation.invited_by)
        .filter(FantasyLeagueInvitation.user_id == user_id)
        .order_by(FantasyLeagueInvitation.created_at.desc())
        .all()
    )
    return [
        _serialize_invitation(inv, league=league, inviter=inviter)
        for inv, league, inviter in rows
    ]


def respond_to_invitation(
    db: Session, user_id: str, invitation_id: int, *, accept: bool
) -> dict:
    """Invitee accepts (joins league) or declines (invite is dropped). Either
    path deletes the invitation row."""
    inv = (
        db.query(FantasyLeagueInvitation)
        .filter(
            FantasyLeagueInvitation.id == invitation_id,
            FantasyLeagueInvitation.user_id == user_id,
        )
        .first()
    )
    if not inv:
        raise HTTPException(status_code=404, detail="Invitation not found.")

    league_id = inv.league_id

    if accept:
        league = db.get(FantasyLeague, league_id)
        if not league:
            db.delete(inv)
            db.commit()
            raise HTTPException(status_code=404, detail="League no longer exists.")

        if not _get_member(db, league_id, user_id):
            member_count = (
                db.query(func.count(FantasyLeagueMember.user_id))
                .filter(FantasyLeagueMember.league_id == league_id)
                .scalar()
                or 0
            )
            if member_count >= league.max_members:
                db.delete(inv)
                db.commit()
                raise HTTPException(status_code=429, detail="League is full.")
            db.add(
                FantasyLeagueMember(
                    league_id=league_id,
                    user_id=user_id,
                    role="member",
                    budget_remaining=league.starting_budget,
                )
            )

    db.delete(inv)
    db.commit()
    return {"league_id": league_id, "accepted": accept}


def leave_league(db: Session, user_id: str, league_id: int) -> None:
    league = _require_league(db, league_id)
    if league.owner_id == user_id:
        raise HTTPException(
            status_code=422,
            detail="Owner cannot leave; transfer ownership or delete the league.",
        )
    member = _get_member(db, league_id, user_id)
    if not member:
        raise HTTPException(status_code=404, detail="You are not in this league.")
    db.delete(member)
    db.commit()


# ─── Seasons ────────────────────────────────────────────────────────────────


def create_season(
    db: Session,
    user_id: str,
    league_id: int,
    *,
    code: str,
    year: int,
    starts_at: datetime,
    ends_at: datetime,
    name: str | None = None,
    make_current: bool = False,
) -> dict:
    league, _ = _require_role(db, league_id, user_id, ("owner",))

    code = (code or "").lower().strip()
    if code not in VALID_SEASON_CODES:
        raise HTTPException(
            status_code=422,
            detail=f"code must be one of {sorted(VALID_SEASON_CODES)}.",
        )
    if starts_at >= ends_at:
        raise HTTPException(
            status_code=422, detail="starts_at must be before ends_at."
        )

    existing = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.league_id == league_id,
            FantasySeason.code == code,
            FantasySeason.year == year,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail="A season with that code and year already exists.",
        )

    season = FantasySeason(
        league_id=league_id,
        name=name or f"{code.capitalize()} {year}",
        code=code,
        year=year,
        starts_at=starts_at,
        ends_at=ends_at,
        status="upcoming",
    )
    db.add(season)
    db.flush()

    if make_current:
        league.current_season_id = season.id

    db.commit()
    db.refresh(season)
    return _serialize_season(season)


def list_seasons(db: Session, viewer_id: str, league_id: int) -> list[dict]:
    if not _get_member(db, league_id, viewer_id):
        raise HTTPException(status_code=404, detail="League not found.")
    seasons = (
        db.query(FantasySeason)
        .filter(FantasySeason.league_id == league_id)
        .order_by(FantasySeason.starts_at.desc())
        .all()
    )
    return [_serialize_season(s) for s in seasons]


def update_season_status(
    db: Session, user_id: str, league_id: int, season_id: int, *, status: str
) -> dict:
    league, _ = _require_role(db, league_id, user_id, ("owner",))
    if status not in VALID_SEASON_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of {sorted(VALID_SEASON_STATUSES)}.",
        )
    season = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.id == season_id, FantasySeason.league_id == league_id
        )
        .first()
    )
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")
    season.status = status
    if status == "active":
        league.current_season_id = season.id
    db.commit()
    db.refresh(season)
    return _serialize_season(season)


def set_current_season(
    db: Session, user_id: str, league_id: int, season_id: int
) -> dict:
    league, _ = _require_role(db, league_id, user_id, ("owner",))
    season = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.id == season_id, FantasySeason.league_id == league_id
        )
        .first()
    )
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")
    league.current_season_id = season.id
    db.commit()
    db.refresh(league)
    return _serialize_league(league, viewer_role="owner")


def list_active_assets(
    db: Session, viewer_id: str, league_id: int, season_id: int
) -> list[dict]:
    """Return all currently-rostered (not dropped) assets in a season."""
    if not _get_member(db, league_id, viewer_id):
        raise HTTPException(status_code=404, detail="League not found.")
    assets = (
        db.query(FantasyAsset)
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.dropped_at.is_(None),
        )
        .order_by(FantasyAsset.owner_user_id, FantasyAsset.drafted_at.asc())
        .all()
    )
    return [
        {
            "id": a.id,
            "content_type": a.content_type,
            "content_id": a.content_id,
            "owner_user_id": a.owner_user_id,
            "auction_price": a.auction_price,
            "slot_type": a.slot_type,
            "drafted_at": a.drafted_at,
        }
        for a in assets
    ]
