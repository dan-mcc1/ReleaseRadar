"""Households: shared Watch together lists, progress on shared shows, and
logging a watch for everyone in the room. Rules live in household_service."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.limiter import limiter, track_budget
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.schemas.common import MAX_ID, MAX_SEASON_EPISODE_NUMBER
from app.services import household_picks as household_picks_svc
from app.services import household_recs, household_service as svc, household_sessions
from app.services.household_service import HouseholdError
from app.services.nav_counts import notify_counts_changed
from app.services.stats_service import invalidate_stats_cache

router = APIRouter()


class NameBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=svc.NAME_MAX)


class InviteBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)


class ItemBody(BaseModel):
    content_type: str = Field(..., pattern="^(tv|movie)$")
    content_id: int = Field(..., ge=1, le=MAX_ID)


class LogBody(BaseModel):
    user_ids: list[str] = Field(..., min_length=1, max_length=svc.MAX_MEMBERS)
    content_type: str = Field(..., pattern="^(tv|movie)$")
    content_id: int = Field(..., ge=1, le=MAX_ID)
    season_number: int | None = Field(None, ge=0, le=MAX_SEASON_EPISODE_NUMBER)
    episode_number: int | None = Field(None, ge=0, le=MAX_SEASON_EPISODE_NUMBER)


def _run(fn, *args):
    try:
        return fn(*args)
    except HouseholdError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


@router.get("")
def my_households(db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    return svc.list_for_user(db, uid)


@router.post("", status_code=201)
@limiter.limit("10/minute")
def create_household(
    request: Request, body: NameBody,
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    return _run(svc.create, db, uid, body.name)


@router.get("/invites/count")
def invite_count(db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    return {"count": svc.pending_invite_count(db, uid)}


@router.post("/invites/{invite_id}/accept")
def accept_invite(invite_id: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    result = _run(svc.accept_invite, db, uid, invite_id)
    notify_counts_changed(db, uid)
    return result


@router.post("/invites/{invite_id}/decline")
def decline_invite(invite_id: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    _run(svc.decline_invite, db, uid, invite_id)
    notify_counts_changed(db, uid)
    return {"ok": True}


@router.get("/containing")
def households_containing(
    content_type: str = Query(..., pattern="^(tv|movie)$"),
    content_id: int = Query(..., ge=1, le=MAX_ID),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Which of your households have this title on their shared list."""
    return {"household_ids": svc.containing(db, uid, content_type, content_id)}


@router.get("/{hid}")
def household_detail(hid: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    return _run(svc.detail, db, uid, hid)


@router.get("/{hid}/invitable")
def invitable_friends(hid: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    """Your friends who aren't in the household yet, for the invite picker."""
    return _run(svc.invitable, db, uid, hid)


@router.get("/{hid}/recommendations")
def household_recommendations(
    hid: int, background_tasks: BackgroundTasks,
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    """Picks for the household, from what its members share. Never waits on
    TMDb: titles with no stored list are fetched after the response."""
    result = _run(household_recs.household_recommendations, db, uid, hid)
    background_tasks.add_task(household_recs.fetch_missing_lists_bg, result.pop("missing", []))
    return result


@router.get("/{hid}/picks")
@limiter.limit("60/minute")
def household_picks(
    request: Request,
    hid: int,
    background_tasks: BackgroundTasks,
    present: str | None = Query(None, max_length=1000, description="Comma-separated user ids watching tonight"),
    time: str = Query("any", pattern="^(any|short|hour|movie)$"),
    services: bool = Query(False),
    kids: bool = Query(False),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """What should we watch? Ranked picks for the people watching tonight."""
    who = [p for p in (present or "").split(",") if p] or None
    result = _run(household_picks_svc.household_picks, db, uid, hid, who, time, services, kids)
    background_tasks.add_task(household_recs.fetch_missing_lists_bg, result.pop("missing", []))
    return result


class SessionBody(BaseModel):
    present: list[str] = Field(..., min_length=1, max_length=svc.MAX_MEMBERS)
    time: str = Field("any", pattern="^(any|short|hour|movie)$")
    services: bool = False
    kids: bool = False
    size: int = Field(household_sessions.DEFAULT_SIZE, ge=household_sessions.MIN_SIZE, le=household_sessions.MAX_SIZE)


class SwipeBody(BaseModel):
    content_type: str = Field(..., pattern="^(tv|movie)$")
    content_id: int = Field(..., ge=1, le=MAX_ID)
    vote: bool


class TitleRef(BaseModel):
    content_type: str = Field(..., pattern="^(tv|movie)$")
    content_id: int = Field(..., ge=1, le=MAX_ID)


@router.get("/{hid}/sessions/current")
def current_session(hid: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    """The household's open swipe session, or null."""
    return _run(household_sessions.current, db, uid, hid)


@router.post("/{hid}/sessions", status_code=201)
@limiter.limit("10/minute")
def start_session(
    request: Request, hid: int, body: SessionBody,
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    """Start swiping: snapshot tonight's picks for the people watching."""
    return _run(
        household_sessions.start, db, uid, hid, body.present, body.time, body.services, body.kids, body.size
    )


@router.post("/{hid}/sessions/{sid}/votes")
@limiter.limit("120/minute")
def swipe(
    request: Request, hid: int, sid: int, body: SwipeBody,
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    return _run(household_sessions.vote, db, uid, hid, sid, body.content_type, body.content_id, body.vote)


@router.post("/{hid}/sessions/{sid}/pick")
def pick_from_session(
    hid: int, sid: int, body: TitleRef,
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    return _run(household_sessions.pick, db, uid, hid, sid, body.content_type, body.content_id)


@router.post("/{hid}/sessions/{sid}/end")
def end_session(hid: int, sid: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    _run(household_sessions.end, db, uid, hid, sid)
    return {"ok": True}


@router.patch("/{hid}")
def rename_household(
    hid: int, body: NameBody, db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    return _run(svc.rename, db, uid, hid, body.name)


@router.delete("/{hid}")
def delete_household(hid: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    for invitee in _run(svc.delete, db, uid, hid):
        notify_counts_changed(db, invitee)
    return {"ok": True}


@router.post("/{hid}/invites", status_code=201)
@limiter.limit("20/minute")
def invite_member(
    request: Request, hid: int, body: InviteBody,
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    result = _run(svc.invite, db, uid, hid, body.username)
    notify_counts_changed(db, result["user_id"])
    return result


@router.delete("/{hid}/invites/{invite_id}")
def cancel_invite(
    hid: int, invite_id: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    invitee = _run(svc.cancel_invite, db, uid, hid, invite_id)
    notify_counts_changed(db, invitee)
    return {"ok": True}


@router.delete("/{hid}/members/{user_id}")
def remove_member(
    hid: int, user_id: str, db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    """Leave (your own id) or, as the owner, remove someone."""
    for invitee in _run(svc.remove_member, db, uid, hid, user_id):
        notify_counts_changed(db, invitee)
    return {"ok": True}


@router.post("/{hid}/items", status_code=201)
@limiter.limit("60/minute")
def add_item(
    request: Request, hid: int, body: ItemBody,
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    _run(svc.add_item, db, uid, hid, body.content_type, body.content_id)
    return {"ok": True}


@router.delete("/{hid}/items/{content_type}/{content_id}")
def remove_item(
    hid: int,
    content_type: str = Path(..., pattern="^(tv|movie)$"),
    content_id: int = Path(..., ge=1, le=MAX_ID),
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    _run(svc.remove_item, db, uid, hid, content_type, content_id)
    return {"ok": True}


@router.get("/{hid}/progress")
def household_progress(hid: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)):
    return _run(svc.progress, db, uid, hid)


@router.post("/{hid}/log", dependencies=[Depends(track_budget)])
@limiter.limit("30/minute")
def log_together(
    request: Request, hid: int, body: LogBody,
    db: Session = Depends(get_db), uid: str = Depends(get_current_user),
):
    """Log a movie, an episode or a season for the members who watched it."""
    logged = _run(
        svc.log_watch, db, uid, hid, body.user_ids, body.content_type, body.content_id,
        body.season_number, body.episode_number,
    )
    for target in logged:
        invalidate_stats_cache(target)
    return {"logged": logged}
