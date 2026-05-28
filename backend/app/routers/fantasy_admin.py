from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.fantasy import FantasyLeagueMember, FantasySeason
from app.services import fantasy_admin_service as admin_svc
from app.services import fantasy_scoring_runner as runner

router = APIRouter()


class RenewalEventBody(BaseModel):
    show_id: int = Field(..., ge=1)
    event_type: str = Field(..., pattern="^(renewed|cancelled)$")
    announced_at: datetime
    note: str | None = Field(None, max_length=500)


@router.post("/renewals")
def record_renewal_event(
    body: RenewalEventBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return admin_svc.record_renewal_event(
        db,
        uid,
        show_id=body.show_id,
        event_type=body.event_type,
        announced_at=body.announced_at,
        note=body.note,
    )


@router.get("/renewals/{show_id}")
def list_renewal_events(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return admin_svc.list_renewal_events(db, show_id)


@router.delete("/renewals/{event_id}", status_code=204)
def delete_renewal_event(
    event_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    admin_svc.delete_renewal_event(db, uid, event_id)


@router.post("/scoring/seasons/{season_id}/run")
def trigger_scoring_run(
    season_id: int,
    week: int | None = Query(None, ge=1),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Manually trigger a scoring run for a season. Owner-only — useful for
    testing or after correcting renewal data."""
    season = db.get(FantasySeason, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")
    is_owner = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == season.league_id,
            FantasyLeagueMember.user_id == uid,
            FantasyLeagueMember.role == "owner",
        )
        .first()
        is not None
    )
    if not is_owner:
        raise HTTPException(status_code=403, detail="Owner only.")

    written = runner.run_weekly_scoring(db, season_id=season_id, week_number=week)
    return {"season_id": season_id, "week": week, "rows_written": written}


@router.post("/scoring/seasons/{season_id}/backfill")
def trigger_backfill(
    season_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    season = db.get(FantasySeason, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")
    is_owner = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == season.league_id,
            FantasyLeagueMember.user_id == uid,
            FantasyLeagueMember.role == "owner",
        )
        .first()
        is not None
    )
    if not is_owner:
        raise HTTPException(status_code=403, detail="Owner only.")

    written = runner.backfill_season(db, season_id=season_id)
    return {"season_id": season_id, "rows_written": written}
