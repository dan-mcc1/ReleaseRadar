from fastapi import APIRouter, Depends, Body, HTTPException, Query, Request
from app.core.limiter import limiter
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.review import Review
from app.models.user import User
from app.models.watched import Watched
from app.services.omdb_service import get_omdb_scores

router = APIRouter()


@router.get("")
@limiter.limit("60/minute")
def get_reviews(
    request: Request,
    content_type: str = Query(...),
    content_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Get all reviews for a piece of content."""
    rows = (
        db.query(Review, User.username, Watched.rating)
        .join(User, Review.user_id == User.id)
        .outerjoin(
            Watched,
            (Watched.user_id == Review.user_id)
            & (Watched.content_type == Review.content_type)
            & (Watched.content_id == Review.content_id),
        )
        .filter(Review.content_type == content_type, Review.content_id == content_id)
        .order_by(Review.created_at.desc())
        .limit(5)
        .all()
    )
    return [
        {
            "id": row.Review.id,
            "user_id": row.Review.user_id,
            "username": row.username,
            "review_text": row.Review.review_text,
            "rating": row.rating,
            "created_at": row.Review.created_at,
            "updated_at": row.Review.updated_at,
        }
        for row in rows
    ]


@router.get("/aggregate")
@limiter.limit("60/minute")
def get_aggregate_ratings(
    request: Request,
    content_type: str = Query(...),
    content_id: int = Query(...),
    db: Session = Depends(get_db),
):
    """Get aggregate ratings from app users for a piece of content."""
    result = (
        db.query(func.avg(Watched.rating), func.count(Watched.rating))
        .filter(
            Watched.content_type == content_type,
            Watched.content_id == content_id,
            Watched.rating.isnot(None),
        )
        .first()
    )
    avg_rating, count = result
    return {
        "average": round(float(avg_rating), 1) if avg_rating else None,
        "count": int(count),
    }


@router.get("/external-scores")
@limiter.limit("30/minute")
def get_external_scores(
    request: Request,
    imdb_id: str = Query(...),
    uid: str = Depends(get_current_user),
):
    """Fetch RT, Metacritic, and IMDb scores from OMDB."""
    return get_omdb_scores(imdb_id)


@router.post("")
def add_or_update_review(
    content_type: str = Body(...),
    content_id: int = Body(...),
    review_text: str = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Add or update the current user's review."""
    review_text = review_text.strip()
    if not review_text:
        raise HTTPException(status_code=422, detail="Review text cannot be empty.")
    if len(review_text) > 2000:
        raise HTTPException(
            status_code=422, detail="Review must be 2000 characters or less."
        )

    existing = (
        db.query(Review)
        .filter_by(user_id=uid, content_type=content_type, content_id=content_id)
        .first()
    )

    def _with_rating(r: Review, u: User | None) -> dict:
        watched = (
            db.query(Watched.rating)
            .filter_by(user_id=uid, content_type=content_type, content_id=content_id)
            .first()
        )
        return {
            "id": r.id,
            "user_id": r.user_id,
            "username": u.username if u else "",
            "review_text": r.review_text,
            "rating": watched.rating if watched else None,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
        }

    if existing:
        existing.review_text = review_text
        db.commit()
        db.refresh(existing)
        user_obj = db.query(User).filter_by(id=uid).first()
        return _with_rating(existing, user_obj)

    review = Review(
        user_id=uid,
        content_type=content_type,
        content_id=content_id,
        review_text=review_text,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    user_obj = db.query(User).filter_by(id=uid).first()
    return _with_rating(review, user_obj)


@router.delete("")
def delete_review(
    content_type: str = Body(...),
    content_id: int = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Delete the current user's review."""
    review = (
        db.query(Review)
        .filter_by(user_id=uid, content_type=content_type, content_id=content_id)
        .first()
    )
    if not review:
        raise HTTPException(status_code=404, detail="Review not found.")
    db.delete(review)
    db.commit()
    return {"message": "Review deleted."}
