from typing import Literal
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.services.favorite_service import (
    add_to_favorites,
    remove_from_favorites,
    get_favorites,
    is_favorited,
)
from app.core.limiter import limiter

router = APIRouter()

FavoriteContentType = Literal["movie", "tv", "collection"]


class FavoriteRef(BaseModel):
    content_type: FavoriteContentType
    content_id: int = Field(..., ge=1)


@router.get("")
def get_user_favorites(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_favorites(db, uid)


@router.get("/status")
def get_favorite_status(
    content_type: FavoriteContentType = Query(...),
    content_id: int = Query(..., ge=1),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return {"favorited": is_favorited(db, uid, content_type, content_id)}


@router.post("/add")
@limiter.limit("10/minute")
def add_favorite(
    request: Request,
    body: FavoriteRef,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return add_to_favorites(db, uid, body.content_type, body.content_id)


@router.delete("/remove")
def remove_favorite(
    body: FavoriteRef,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return remove_from_favorites(db, uid, body.content_type, body.content_id)
