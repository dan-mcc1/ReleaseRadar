from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services import (
    fantasy_league_service as league_svc,
    fantasy_standings_service as standings_svc,
)

router = APIRouter()


# ─── Request bodies ─────────────────────────────────────────────────────────


class CreateLeagueBody(BaseModel):
    name: str = Field(
        ...,
        min_length=league_svc.LEAGUE_NAME_MIN_LEN,
        max_length=league_svc.LEAGUE_NAME_MAX_LEN,
    )
    starting_budget: int | None = Field(None, ge=50, le=1000)
    weekly_allowance: int | None = Field(None, ge=0, le=100)
    roster_movie_slots: int | None = Field(None, ge=1, le=15)
    roster_tv_slots: int | None = Field(None, ge=0, le=15)
    roster_flex_slots: int | None = Field(None, ge=0, le=5)
    bench_slots: int | None = Field(None, ge=0, le=10)
    boost_slots: int | None = Field(None, ge=0, le=5)
    max_members: int | None = Field(None, ge=2, le=24)


class UpdateLeagueBody(BaseModel):
    name: str | None = Field(
        None,
        min_length=league_svc.LEAGUE_NAME_MIN_LEN,
        max_length=league_svc.LEAGUE_NAME_MAX_LEN,
    )
    starting_budget: int | None = Field(None, ge=50, le=1000)
    weekly_allowance: int | None = Field(None, ge=0, le=100)
    roster_movie_slots: int | None = Field(None, ge=1, le=15)
    roster_tv_slots: int | None = Field(None, ge=0, le=15)
    roster_flex_slots: int | None = Field(None, ge=0, le=5)
    bench_slots: int | None = Field(None, ge=0, le=10)
    boost_slots: int | None = Field(None, ge=0, le=5)
    max_members: int | None = Field(None, ge=2, le=24)


class InviteMemberBody(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)


class RespondInvitationBody(BaseModel):
    accept: bool


class CreateSeasonBody(BaseModel):
    code: str = Field(..., max_length=20)
    year: int = Field(..., ge=2000, le=2100)
    starts_at: datetime
    ends_at: datetime
    name: str | None = Field(None, max_length=40)
    make_current: bool = False


class UpdateSeasonStatusBody(BaseModel):
    status: str = Field(..., max_length=20)


# ─── League routes ──────────────────────────────────────────────────────────


@router.post("")
def create_league(
    body: CreateLeagueBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.create_league(db, uid, **body.model_dump(exclude_none=True))


@router.get("")
def list_my_leagues(
    db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    return league_svc.list_my_leagues(db, uid)


@router.get("/{league_id}")
def get_league(
    league_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.get_league(db, uid, league_id)


@router.patch("/{league_id}")
def update_league(
    league_id: int,
    body: UpdateLeagueBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.update_league(
        db, uid, league_id, **body.model_dump(exclude_none=True)
    )


@router.delete("/{league_id}", status_code=204)
def delete_league(
    league_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    league_svc.delete_league(db, uid, league_id)


# ─── Members ────────────────────────────────────────────────────────────────


@router.get("/{league_id}/members")
def list_members(
    league_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.list_members(db, uid, league_id)


@router.delete("/{league_id}/members/{target_user_id}", status_code=204)
def remove_member(
    league_id: int,
    target_user_id: str,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    league_svc.remove_member(db, uid, league_id, target_user_id)


@router.post("/{league_id}/leave", status_code=204)
def leave_league(
    league_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    league_svc.leave_league(db, uid, league_id)


# ─── Invitations ────────────────────────────────────────────────────────────


@router.post("/{league_id}/invitations")
def invite_member(
    league_id: int,
    body: InviteMemberBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.invite_user_by_username(
        db, uid, league_id, username=body.username
    )


@router.get("/{league_id}/invitations")
def list_league_invitations(
    league_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.list_league_invitations(db, uid, league_id)


@router.delete("/{league_id}/invitations/{invitation_id}", status_code=204)
def cancel_invitation(
    league_id: int,
    invitation_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    league_svc.cancel_invitation(db, uid, league_id, invitation_id)


# ─── Seasons ────────────────────────────────────────────────────────────────


@router.get("/{league_id}/seasons")
def list_seasons(
    league_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.list_seasons(db, uid, league_id)


@router.post("/{league_id}/seasons")
def create_season(
    league_id: int,
    body: CreateSeasonBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.create_season(
        db, uid, league_id, **body.model_dump(exclude_none=True)
    )


@router.patch("/{league_id}/seasons/{season_id}/status")
def update_season_status(
    league_id: int,
    season_id: int,
    body: UpdateSeasonStatusBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.update_season_status(
        db, uid, league_id, season_id, status=body.status
    )


@router.post("/{league_id}/seasons/{season_id}/set-current")
def set_current_season(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.set_current_season(db, uid, league_id, season_id)


@router.get("/{league_id}/seasons/{season_id}/assets")
def list_active_assets(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.list_active_assets(db, uid, league_id, season_id)


# ─── Standings ──────────────────────────────────────────────────────────────


@router.get("/{league_id}/seasons/{season_id}/standings")
def get_standings(
    league_id: int,
    season_id: int,
    through_week: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return standings_svc.get_standings(
        db, uid, league_id, season_id, through_week=through_week
    )


@router.get("/{league_id}/seasons/{season_id}/users/{user_id}/breakdown")
def get_user_breakdown(
    league_id: int,
    season_id: int,
    user_id: str,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return standings_svc.get_user_breakdown(
        db, uid, league_id, season_id, user_id
    )


@router.get("/{league_id}/seasons/{season_id}/chart")
def get_weekly_chart(
    league_id: int,
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return standings_svc.get_weekly_chart(db, uid, league_id, season_id)


@router.get("/{league_id}/assets/{asset_id}/weekly-scores")
def get_asset_weekly_scores(
    league_id: int,
    asset_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return standings_svc.get_asset_weekly_scores(db, uid, league_id, asset_id)
