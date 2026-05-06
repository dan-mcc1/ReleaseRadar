from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services.calendar_service import get_calendar

router = APIRouter()


@router.get("")
def calendar(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
    from_date: str = Query(None),
    to_date: str = Query(None),
):
    return get_calendar(db, uid, from_date=from_date, to_date=to_date)
