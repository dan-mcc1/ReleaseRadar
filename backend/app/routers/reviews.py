from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from app.core.limiter import limiter
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from app.db.session import get_db
from app.dependencies.auth import get_current_user, require_not_silenced
from app.core.firebase import verify_token
from app.models.review import Review
from app.models.review_like import ReviewLike
from app.models.user import User
from app.models.watched import Watched
from app.models.block import Block
from app.services.omdb_service import get_omdb_scores
from app.schemas.common import ContentType, REVIEW_TEXT_MAX_LEN


class ReviewUpsert(BaseModel):
    content_type: ContentType
    content_id: int = Field(..., ge=1)
    review_text: str = Field(..., min_length=1, max_length=REVIEW_TEXT_MAX_LEN)
    is_spoiler: bool = False


class ReviewDelete(BaseModel):
    content_type: ContentType
    content_id: int = Field(..., ge=1)


SortOrder = Literal["newest", "top"]

_bearer = HTTPBearer(auto_error=False)


def _optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)) -> Optional[str]:
    if not credentials:
        return None
    try:
        return verify_token(credentials.credentials)["uid"]
    except Exception:
        return None

router = APIRouter()


@router.get("")
@limiter.limit("60/minute")
def get_reviews(
    request: Request,
    content_type: ContentType = Query(...),
    content_id: int = Query(..., ge=1),
    sort: SortOrder = Query("newest"),
    db: Session = Depends(get_db),
    uid: Optional[str] = Depends(_optional_user),
):
    """Get reviews for a piece of content, sorted by newest or top (most liked)."""
    like_uid = uid or ""

    # One LEFT JOIN against ReviewLike with GROUP BY replaces two per-row
    # correlated subqueries. case() + sum() is the portable equivalent of
    # COUNT(*) FILTER (WHERE user_id = :uid) — SQLite (tests) and Postgres
    # (prod) both compile it down to the same plan.
    like_count_col = func.count(ReviewLike.id).label("like_count")
    user_liked_col = func.coalesce(
        func.sum(case((ReviewLike.user_id == like_uid, 1), else_=0)), 0
    ).label("user_has_liked")

    query = (
        db.query(
            Review,
            User.username,
            Watched.rating,
            like_count_col,
            user_liked_col,
        )
        .join(User, Review.user_id == User.id)
        .outerjoin(
            Watched,
            (Watched.user_id == Review.user_id)
            & (Watched.content_type == Review.content_type)
            & (Watched.content_id == Review.content_id),
        )
        .outerjoin(ReviewLike, ReviewLike.review_id == Review.id)
        .filter(Review.content_type == content_type, Review.content_id == content_id)
        .group_by(Review.id, User.username, Watched.rating)
    )

    if uid:
        blocked_ids = [
            b.blocked_id
            for b in db.query(Block.blocked_id).filter(Block.blocker_id == uid).all()
        ]
        if blocked_ids:
            query = query.filter(Review.user_id.notin_(blocked_ids))

    if sort == "top":
        query = query.order_by(like_count_col.desc(), Review.created_at.desc())
    else:
        query = query.order_by(Review.created_at.desc())

    rows = query.limit(5).all()
    return [
        {
            "id": row.Review.id,
            "user_id": row.Review.user_id,
            "username": row.username,
            "review_text": row.Review.review_text,
            "is_spoiler": row.Review.is_spoiler,
            "rating": row.rating,
            "created_at": row.Review.created_at,
            "updated_at": row.Review.updated_at,
            "like_count": row.like_count,
            "user_has_liked": bool(row.user_has_liked),
        }
        for row in rows
    ]


@router.get("/aggregate")
@limiter.limit("60/minute")
def get_aggregate_ratings(
    request: Request,
    content_type: ContentType = Query(...),
    content_id: int = Query(..., ge=1),
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
    imdb_id: str = Query(..., min_length=1, max_length=20, pattern=r"^tt\d+$"),
    uid: str = Depends(get_current_user),
):
    """Fetch RT, Metacritic, and IMDb scores from OMDB."""
    return get_omdb_scores(imdb_id)


@router.post("/{review_id}/like")
def toggle_like(
    review_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Toggle a like on a review. Cannot like your own review."""
    review = db.query(Review).filter_by(id=review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Review not found.")
    if review.user_id == uid:
        raise HTTPException(status_code=400, detail="Cannot like your own review.")

    existing = db.query(ReviewLike).filter_by(user_id=uid, review_id=review_id).first()
    if existing:
        db.delete(existing)
        db.commit()
        liked = False
    else:
        db.add(ReviewLike(user_id=uid, review_id=review_id))
        db.commit()
        liked = True

    count = db.query(func.count(ReviewLike.id)).filter(ReviewLike.review_id == review_id).scalar()
    return {"liked": liked, "like_count": count}


@router.post("")
def add_or_update_review(
    body: ReviewUpsert,
    db: Session = Depends(get_db),
    uid: str = Depends(require_not_silenced),
):
    """Add or update the current user's review."""
    content_type = body.content_type
    content_id = body.content_id
    is_spoiler = body.is_spoiler
    review_text = body.review_text.strip()
    if not review_text:
        raise HTTPException(status_code=422, detail="Review text cannot be empty.")

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
        like_count = db.query(func.count(ReviewLike.id)).filter(ReviewLike.review_id == r.id).scalar()
        return {
            "id": r.id,
            "user_id": r.user_id,
            "username": u.username if u else "",
            "review_text": r.review_text,
            "is_spoiler": r.is_spoiler,
            "rating": watched.rating if watched else None,
            "created_at": r.created_at,
            "updated_at": r.updated_at,
            "like_count": like_count,
            "user_has_liked": False,
        }

    if existing:
        existing.review_text = review_text
        existing.is_spoiler = is_spoiler
        db.commit()
        db.refresh(existing)
        user_obj = db.query(User).filter_by(id=uid).first()
        return _with_rating(existing, user_obj)

    review = Review(
        user_id=uid,
        content_type=content_type,
        content_id=content_id,
        review_text=review_text,
        is_spoiler=is_spoiler,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    user_obj = db.query(User).filter_by(id=uid).first()
    return _with_rating(review, user_obj)


@router.delete("")
def delete_review(
    body: ReviewDelete,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Delete the current user's review."""
    review = (
        db.query(Review)
        .filter_by(user_id=uid, content_type=body.content_type, content_id=body.content_id)
        .first()
    )
    if not review:
        raise HTTPException(status_code=404, detail="Review not found.")
    db.delete(review)
    db.commit()
    return {"message": "Review deleted."}
