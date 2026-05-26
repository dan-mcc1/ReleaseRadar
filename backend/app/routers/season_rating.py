from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.limiter import limiter
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.season_rating import SeasonRating


class SeasonRatingUpsert(BaseModel):
    show_id: int = Field(..., ge=1)
    season_number: int = Field(..., ge=1)
    rating: float = Field(..., ge=0.5, le=5.0)


class SeasonRatingDelete(BaseModel):
    show_id: int = Field(..., ge=1)
    season_number: int = Field(..., ge=1)


router = APIRouter()


def _serialize(r: SeasonRating) -> dict:
    return {
        "id": r.id,
        "show_id": r.show_id,
        "season_number": r.season_number,
        "rating": r.rating,
        "rated_at": r.rated_at,
    }


@router.get("")
@limiter.limit("120/minute")
def get_my_rating(
    request: Request,
    show_id: int = Query(..., ge=1),
    season_number: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return the current user's rating for a given show season, or null."""
    row = (
        db.query(SeasonRating)
        .filter_by(user_id=uid, show_id=show_id, season_number=season_number)
        .first()
    )
    return _serialize(row) if row else None


@router.get("/aggregate")
@limiter.limit("120/minute")
def get_aggregate(
    request: Request,
    show_id: int = Query(..., ge=1),
    season_number: int = Query(..., ge=1),
    db: Session = Depends(get_db),
):
    """Aggregate season rating across all users."""
    avg_rating, count = (
        db.query(func.avg(SeasonRating.rating), func.count(SeasonRating.id))
        .filter(
            SeasonRating.show_id == show_id,
            SeasonRating.season_number == season_number,
        )
        .first()
    )
    return {
        "average": round(float(avg_rating), 1) if avg_rating else None,
        "count": int(count),
    }


@router.put("")
def upsert_rating(
    body: SeasonRatingUpsert,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Create or update the current user's rating for a season."""
    existing = (
        db.query(SeasonRating)
        .filter_by(
            user_id=uid, show_id=body.show_id, season_number=body.season_number
        )
        .first()
    )
    if existing:
        existing.rating = body.rating
        db.commit()
        db.refresh(existing)
        return _serialize(existing)

    row = SeasonRating(
        user_id=uid,
        show_id=body.show_id,
        season_number=body.season_number,
        rating=body.rating,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


@router.delete("")
def delete_rating(
    body: SeasonRatingDelete,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Clear the current user's rating for a season."""
    row = (
        db.query(SeasonRating)
        .filter_by(
            user_id=uid, show_id=body.show_id, season_number=body.season_number
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Rating not found.")
    db.delete(row)
    db.commit()
    return {"message": "Rating deleted."}
