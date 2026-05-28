from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services import fantasy_league_service as league_svc

router = APIRouter()


class RespondInvitationBody(BaseModel):
    accept: bool


@router.get("/mine")
def list_my_invitations(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.list_my_invitations(db, uid)


@router.post("/{invitation_id}/respond")
def respond(
    invitation_id: int,
    body: RespondInvitationBody,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return league_svc.respond_to_invitation(
        db, uid, invitation_id, accept=body.accept
    )
