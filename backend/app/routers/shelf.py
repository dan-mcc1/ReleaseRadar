from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.dependencies.auth import get_current_user
from app.dependencies.subscription import feature_gate
from app.db.session import SessionLocal
from app.models.shelf import Shelf
from app.services import shelf_service
from app.services.episode_service import sync_show_episodes_background


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


router = APIRouter()


class ShelfCreate(BaseModel):
    name: str
    description: str | None = None


class ShelfUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class ShelfItemAdd(BaseModel):
    content_type: str
    content_id: int


class ShelfNotifyUpdate(BaseModel):
    notify: bool


@router.post("")
def create_shelf(
    body: ShelfCreate,
    user_id: str = Depends(feature_gate("shelves")),
    db: Session = Depends(get_db),
):
    shelf = shelf_service.create_shelf(db, user_id, body.name, body.description)
    return {"id": shelf.id, "name": shelf.name, "description": shelf.description, "created_at": shelf.created_at.isoformat() if shelf.created_at else None, "item_count": 0}


@router.get("")
def list_shelves(
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return shelf_service.get_user_shelves(db, user_id)


@router.patch("/{shelf_id}")
def update_shelf(
    shelf_id: int,
    body: ShelfUpdate,
    user_id: str = Depends(feature_gate("shelves")),
    db: Session = Depends(get_db),
):
    shelf = shelf_service.update_shelf(db, user_id, shelf_id, body.name, body.description)
    return {"id": shelf.id, "name": shelf.name, "description": shelf.description}


@router.delete("/{shelf_id}", status_code=204)
def delete_shelf(
    shelf_id: int,
    user_id: str = Depends(feature_gate("shelves")),
    db: Session = Depends(get_db),
):
    shelf_service.delete_shelf(db, user_id, shelf_id)


@router.post("/{shelf_id}/items", status_code=201)
def add_item(
    shelf_id: int,
    body: ShelfItemAdd,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(feature_gate("shelves")),
    db: Session = Depends(get_db),
):
    item = shelf_service.add_to_shelf(db, user_id, shelf_id, body.content_type, body.content_id)
    if body.content_type == "tv":
        background_tasks.add_task(sync_show_episodes_background, body.content_id)
    return {"id": item.id, "shelf_id": item.shelf_id, "content_type": item.content_type, "content_id": item.content_id}


@router.delete("/{shelf_id}/items/{content_type}/{content_id}", status_code=204)
def remove_item(
    shelf_id: int,
    content_type: str,
    content_id: int,
    user_id: str = Depends(feature_gate("shelves")),
    db: Session = Depends(get_db),
):
    shelf_service.remove_from_shelf(db, user_id, shelf_id, content_type, content_id)


@router.get("/{shelf_id}/items")
def get_items(
    shelf_id: int,
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return shelf_service.get_shelf_items(db, user_id, shelf_id)


@router.get("/{shelf_id}/calendar")
def get_calendar(
    shelf_id: int,
    from_date: str | None = None,
    to_date: str | None = None,
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return shelf_service.get_shelf_calendar(db, user_id, shelf_id, from_date, to_date)


@router.patch("/{shelf_id}/notify")
def update_shelf_notify(
    shelf_id: int,
    body: ShelfNotifyUpdate,
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    shelf = db.query(Shelf).filter_by(id=shelf_id, user_id=user_id).first()
    if not shelf:
        raise HTTPException(status_code=404, detail="Shelf not found")
    shelf.notify = body.notify
    db.commit()
    return {"id": shelf.id, "notify": shelf.notify}


@router.get("/item-shelves")
def get_item_shelves(
    content_type: str,
    content_id: int,
    user_id: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return shelf IDs that contain this item — used by ShelfButton to show checkmarks."""
    return shelf_service.get_shelves_for_item(db, user_id, content_type, content_id)
