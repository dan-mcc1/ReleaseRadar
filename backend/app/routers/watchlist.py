from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Body,
    HTTPException,
    Request,
    Query,
)
from datetime import date
from pydantic import BaseModel
from sqlalchemy import tuple_, union_all, select, literal, null, Float
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.services.watchlist_service import (
    add_to_watchlist,
    get_watchlist,
    remove_from_watchlist,
    _get_watchlist_items,
    get_watchlist_status,
    get_tv_calendar,
    reorder_watchlist_item,
)
from app.models.watchlist import Watchlist
from app.models.watched import Watched
from app.models.currently_watching import CurrentlyWatching
from app.models.show import Show
from app.models.movie import Movie
from app.dependencies.auth import get_current_user
from app.dependencies.subscription import feature_gate
from app.core.limiter import limiter
from app.services.episode_service import sync_show_episodes_background
from app.services.binge_planner_service import (
    get_binge_plan,
    get_binge_plans_bulk,
    set_finish_by_goal,
    clear_finish_by_goal,
)

router = APIRouter()


@router.post("/add")
def add_item(
    background_tasks: BackgroundTasks,
    content_type: str = Body(...),
    content_id: int = Body(...),
    notify: bool = Body(True),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(
            status_code=400, detail="content_type must be 'movie' or 'tv'"
        )

    result = add_to_watchlist(db, uid, content_type, content_id, notify=notify)
    if content_type == "tv":
        background_tasks.add_task(sync_show_episodes_background, content_id)
    return result


@router.delete("/remove")
def remove_item(
    content_type: str = Body(...),
    content_id: int = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(
            status_code=400, detail="content_type must be 'movie' or 'tv'"
        )
    return remove_from_watchlist(db, uid, content_type, content_id)


@router.get("")
def get_user_watchlist(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    return get_watchlist(db, uid)


@router.post("/reorder")
@limiter.limit("60/minute")
def reorder_item(
    request: Request,
    content_type: str = Body(...),
    content_id: int = Body(...),
    before_id: int | None = Body(None),
    after_id: int | None = Body(None),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    if content_type not in ("movie", "tv"):
        raise HTTPException(
            status_code=400, detail="content_type must be 'movie' or 'tv'"
        )
    try:
        return reorder_watchlist_item(
            db, uid, content_type, content_id, before_id, after_id
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/tv/calendar")
def watchlist_tv_calendar(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
    from_date: str = Query(...),
    to_date: str = Query(...),
):
    return get_tv_calendar(db, uid, from_date=from_date, to_date=to_date)


@router.get("/tv")
def watchlist_tv_info(
    db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    return _get_watchlist_items(db, uid, "tv")


@router.get("/movie")
def watchlist_movie_info(
    db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    return _get_watchlist_items(db, uid, "movie")


@router.post("/status/bulk")
@limiter.limit("60/minute")
def bulk_status(
    request: Request,
    items: list[dict] = Body(...),
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """
    Return the watch status for a list of {content_type, content_id} pairs.
    3 DB queries regardless of list size.
    Response: { "movie:123": {status, rating}, "tv:456": {status, rating}, ... }
    """
    if not items:
        return {}
    if len(items) > 500:
        items = items[:500]
    pairs = [(i["content_type"], i["content_id"]) for i in items]

    # Single UNION ALL — one DB round-trip instead of three.
    # Priority (highest wins): Currently Watching > Want To Watch > Watched.
    cw_q = select(
        literal("Currently Watching").label("status"),
        CurrentlyWatching.content_type,
        CurrentlyWatching.content_id,
        null().cast(Float).label("rating"),
    ).where(
        CurrentlyWatching.user_id == uid,
        tuple_(CurrentlyWatching.content_type, CurrentlyWatching.content_id).in_(pairs),
    )
    wl_q = select(
        literal("Want To Watch").label("status"),
        Watchlist.content_type,
        Watchlist.content_id,
        null().cast(Float).label("rating"),
    ).where(
        Watchlist.user_id == uid,
        tuple_(Watchlist.content_type, Watchlist.content_id).in_(pairs),
    )
    wd_q = select(
        literal("Watched").label("status"),
        Watched.content_type,
        Watched.content_id,
        Watched.rating,
    ).where(
        Watched.user_id == uid,
        tuple_(Watched.content_type, Watched.content_id).in_(pairs),
    )

    rows = db.execute(union_all(cw_q, wl_q, wd_q)).all()

    _PRIORITY = {"Watched": 1, "Want To Watch": 2, "Currently Watching": 3}
    result = {f"{ct}:{cid}": {"status": "none", "rating": None} for ct, cid in pairs}
    for status, ct, cid, rating in rows:
        key = f"{ct}:{cid}"
        if _PRIORITY.get(status, 0) > _PRIORITY.get(result[key]["status"], 0):
            result[key] = {"status": status, "rating": rating}

    return result


@router.get("/movie/{id}/status")
def watchlist_movie_status(
    id: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    return get_watchlist_status(id, db, uid, "movie")


@router.get("/tv/{id}/status")
def watchlist_tv_status(
    id: int, db: Session = Depends(get_db), uid: str = Depends(get_current_user)
):
    return get_watchlist_status(id, db, uid, "tv")


@router.get("/notify-prefs")
def get_notify_prefs(
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    """Return all watchlist items with their notify flag and display name (3 queries total)."""
    rows = db.query(Watchlist).filter_by(user_id=uid).all()
    if not rows:
        return []

    tv_ids = [r.content_id for r in rows if r.content_type == "tv"]
    movie_ids = [r.content_id for r in rows if r.content_type == "movie"]

    show_names = {}
    if tv_ids:
        for sid, name in db.query(Show.id, Show.name).filter(Show.id.in_(tv_ids)).all():
            show_names[sid] = name

    movie_names = {}
    if movie_ids:
        for mid, title in db.query(Movie.id, Movie.title).filter(Movie.id.in_(movie_ids)).all():
            movie_names[mid] = title

    result = []
    for r in rows:
        name_map = show_names if r.content_type == "tv" else movie_names
        name = name_map.get(r.content_id)
        if name is None:
            continue  # skip orphaned watchlist entries with no cached media data
        result.append({
            "content_type": r.content_type,
            "content_id": r.content_id,
            "name": name,
            "notify": r.notify,
        })
    return result


class NotifyPrefUpdate(BaseModel):
    content_type: str
    content_id: int
    notify: bool


class NotifyAllUpdate(BaseModel):
    notify: bool
    content_type: str | None = None  # optional filter: "movie" or "tv"


@router.patch("/notify-all")
def update_notify_all(
    body: NotifyAllUpdate,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    q = db.query(Watchlist).filter_by(user_id=uid)
    if body.content_type:
        q = q.filter_by(content_type=body.content_type)
    q.update({"notify": body.notify}, synchronize_session=False)
    db.commit()
    return {"updated": True, "notify": body.notify}


@router.patch("/notify")
def update_notify_pref(
    body: NotifyPrefUpdate,
    db: Session = Depends(get_db),
    uid: str = Depends(get_current_user),
):
    item = (
        db.query(Watchlist)
        .filter_by(user_id=uid, content_type=body.content_type, content_id=body.content_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not in watchlist")
    item.notify = body.notify
    db.commit()
    return {"content_type": item.content_type, "content_id": item.content_id, "notify": item.notify}


@router.get("/progress/{show_id}")
def show_progress(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(feature_gate("binge_planner")),
):
    """Return remaining runtime + pace estimate for a single show."""
    return get_binge_plan(db, uid, show_id)


class ProgressBulkBody(BaseModel):
    show_ids: list[int]


@router.post("/progress-bulk")
def show_progress_bulk(
    body: ProgressBulkBody,
    db: Session = Depends(get_db),
    uid: str = Depends(feature_gate("binge_planner")),
):
    """Returns progress for each show in the request body."""
    return get_binge_plans_bulk(db, uid, body.show_ids)


class FinishByBody(BaseModel):
    target_date: date


@router.post("/progress/{show_id}/finish-by")
def set_finish_by(
    show_id: int,
    body: FinishByBody,
    db: Session = Depends(get_db),
    uid: str = Depends(feature_gate("finish_by_goal")),
):
    """Set (or update) a finish-by goal date for a show."""
    set_finish_by_goal(db, uid, show_id, body.target_date)
    return {"show_id": show_id, "target_date": body.target_date.isoformat()}


@router.delete("/progress/{show_id}/finish-by")
def delete_finish_by(
    show_id: int,
    db: Session = Depends(get_db),
    uid: str = Depends(feature_gate("finish_by_goal")),
):
    """Clear the finish-by goal for a show."""
    clear_finish_by_goal(db, uid, show_id)
    return {"show_id": show_id, "cleared": True}
