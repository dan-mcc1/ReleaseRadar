from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.user_streaming_service import UserStreamingService
from app.models.provider import Provider, ShowProvider, MovieProvider
from app.models.watchlist import Watchlist
from app.models.currently_watching import CurrentlyWatching
from app.models.show import Show
from app.models.movie import Movie

router = APIRouter()


@router.get("/providers")
def list_all_providers(db: Session = Depends(get_db)):
    """Return all known providers from the DB for the service picker."""
    providers = db.query(Provider).order_by(Provider.name).all()
    return [
        {"id": p.id, "name": p.name, "logo_path": p.logo_path}
        for p in providers
    ]


@router.get("/services")
def get_my_services(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    """Return the provider IDs the current user has saved."""
    rows = (
        db.query(UserStreamingService)
        .filter(UserStreamingService.user_id == user_id)
        .all()
    )
    provider_ids = [r.provider_id for r in rows]
    if not provider_ids:
        return []
    providers = (
        db.query(Provider)
        .filter(Provider.id.in_(provider_ids))
        .order_by(Provider.name)
        .all()
    )
    return [
        {"id": p.id, "name": p.name, "logo_path": p.logo_path}
        for p in providers
    ]


@router.post("/services/{provider_id}", status_code=201)
def add_service(
    provider_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    provider = db.query(Provider).filter(Provider.id == provider_id).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    existing = (
        db.query(UserStreamingService)
        .filter_by(user_id=user_id, provider_id=provider_id)
        .first()
    )
    if not existing:
        db.add(UserStreamingService(user_id=user_id, provider_id=provider_id))
        db.commit()
    return {"ok": True}



@router.get("/optimizer")
def streaming_optimizer(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    """Analyze watchlist coverage across streaming providers."""
    wl_rows = (
        db.query(Watchlist.content_type, Watchlist.content_id)
        .filter(Watchlist.user_id == user_id)
        .all()
    )
    cw_rows = (
        db.query(CurrentlyWatching.content_type, CurrentlyWatching.content_id)
        .filter(CurrentlyWatching.user_id == user_id)
        .all()
    )
    all_items: set[tuple[str, int]] = {(ct, cid) for ct, cid in wl_rows} | {
        (ct, cid) for ct, cid in cw_rows
    }
    if not all_items:
        return {
            "total_items": 0,
            "items_with_streaming": 0,
            "my_services_coverage": 0,
            "coverage_by_provider": [],
            "uncovered_items": [],
            "no_streaming_items": [],
            "suggested_combo": [],
        }

    user_provider_ids: set[int] = {
        r.provider_id
        for r in db.query(UserStreamingService)
        .filter(UserStreamingService.user_id == user_id)
        .all()
    }

    tv_ids = [cid for ct, cid in all_items if ct == "tv"]
    movie_ids = [cid for ct, cid in all_items if ct == "movie"]

    shows = (
        {s.id: s for s in db.query(Show).filter(Show.id.in_(tv_ids)).all()}
        if tv_ids
        else {}
    )
    movies = (
        {m.id: m for m in db.query(Movie).filter(Movie.id.in_(movie_ids)).all()}
        if movie_ids
        else {}
    )

    show_provider_rows = (
        db.query(ShowProvider)
        .filter(ShowProvider.show_id.in_(tv_ids), ShowProvider.flatrate.is_(True))
        .all()
        if tv_ids
        else []
    )
    movie_provider_rows = (
        db.query(MovieProvider)
        .filter(MovieProvider.movie_id.in_(movie_ids), MovieProvider.flatrate.is_(True))
        .all()
        if movie_ids
        else []
    )

    # item -> set of provider ids (flatrate)
    item_providers: dict[tuple[str, int], set[int]] = {item: set() for item in all_items}
    for sp in show_provider_rows:
        item_providers[("tv", sp.show_id)].add(sp.provider_id)
    for mp in movie_provider_rows:
        item_providers[("movie", mp.movie_id)].add(mp.provider_id)

    # provider -> set of items it covers
    provider_items: dict[int, set[tuple[str, int]]] = {}
    for item, pids in item_providers.items():
        for pid in pids:
            provider_items.setdefault(pid, set()).add(item)

    all_relevant_provider_ids = set(provider_items.keys()) | user_provider_ids
    providers: dict[int, Provider] = (
        {p.id: p for p in db.query(Provider).filter(Provider.id.in_(all_relevant_provider_ids)).all()}
        if all_relevant_provider_ids
        else {}
    )

    def item_info(ct: str, cid: int) -> dict | None:
        if ct == "tv":
            s = shows.get(cid)
            if s:
                return {"id": cid, "type": "tv", "title": s.name, "poster_path": s.poster_path}
        else:
            m = movies.get(cid)
            if m:
                return {"id": cid, "type": "movie", "title": m.title, "poster_path": m.poster_path}
        return None

    coverage_by_provider = []
    for pid, items_covered in sorted(provider_items.items(), key=lambda x: -len(x[1])):
        p = providers.get(pid)
        if not p:
            continue
        coverage_by_provider.append({
            "id": p.id,
            "name": p.name,
            "logo_path": p.logo_path,
            "count": len(items_covered),
            "you_have": pid in user_provider_ids,
        })

    # Items covered by user's current services
    covered: set[tuple[str, int]] = set()
    for pid in user_provider_ids:
        covered |= provider_items.get(pid, set())

    # Items not covered by the user's services
    uncovered = all_items - covered
    uncovered_items = []
    for ct, cid in uncovered:
        info = item_info(ct, cid)
        if not info:
            continue
        available = []
        for pid in item_providers.get((ct, cid), set()):
            p = providers.get(pid)
            if p:
                available.append({"id": p.id, "name": p.name, "logo_path": p.logo_path})
        available.sort(key=lambda x: x["name"])
        info["available_on"] = available
        uncovered_items.append(info)
    uncovered_items.sort(key=lambda x: x["title"])

    no_streaming_items = []
    for ct, cid in all_items:
        if not item_providers.get((ct, cid)):
            info = item_info(ct, cid)
            if info:
                no_streaming_items.append(info)
    no_streaming_items.sort(key=lambda x: x["title"])

    # Greedy set cover — suggest services to maximize additional coverage
    suggested_combo = []
    temp_remaining = set(all_items) - covered
    for _ in range(5):
        if not temp_remaining or not provider_items:
            break
        best_pid = max(
            provider_items.keys(),
            key=lambda pid: len(provider_items[pid] & temp_remaining),
        )
        newly_covered = provider_items[best_pid] & temp_remaining
        if not newly_covered:
            break
        p = providers.get(best_pid)
        if p:
            suggested_combo.append({
                "id": p.id,
                "name": p.name,
                "logo_path": p.logo_path,
                "adds_count": len(newly_covered),
                "you_have": best_pid in user_provider_ids,
            })
        temp_remaining -= newly_covered

    return {
        "total_items": len(all_items),
        "items_with_streaming": sum(1 for i in all_items if item_providers.get(i)),
        "my_services_coverage": len(covered),
        "coverage_by_provider": coverage_by_provider,
        "uncovered_items": uncovered_items,
        "no_streaming_items": no_streaming_items,
        "suggested_combo": suggested_combo,
    }


@router.delete("/services/{provider_id}")
def remove_service(
    provider_id: int,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
):
    row = (
        db.query(UserStreamingService)
        .filter_by(user_id=user_id, provider_id=provider_id)
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return {"ok": True}
