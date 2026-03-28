import base64
import hashlib
import hmac
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from icalendar import Calendar, Event
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.movie import Movie
from app.models.show import Show
from app.models.watchlist import Watchlist

router = APIRouter()


# ── Token helpers ─────────────────────────────────────────────────────────────

def _make_token(user_id: str) -> str:
    """Return a URL-safe token that encodes and authenticates the user_id."""
    uid_b64 = base64.urlsafe_b64encode(user_id.encode()).decode().rstrip("=")
    sig = hmac.new(
        settings.ICAL_SECRET.encode(), user_id.encode(), hashlib.sha256
    ).hexdigest()[:32]
    return f"{uid_b64}.{sig}"


def _verify_token(token: str) -> str | None:
    """Return the user_id if the token is valid, else None."""
    try:
        uid_b64, sig = token.split(".", 1)
        padding = (4 - len(uid_b64) % 4) % 4
        user_id = base64.urlsafe_b64decode(uid_b64 + "=" * padding).decode()
        expected = hmac.new(
            settings.ICAL_SECRET.encode(), user_id.encode(), hashlib.sha256
        ).hexdigest()[:32]
        if hmac.compare_digest(sig, expected):
            return user_id
    except Exception:
        pass
    return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/token")
def get_ical_token(uid: str = Depends(get_current_user)):
    """Return the user's personal iCal feed token (authenticated)."""
    return {"token": _make_token(uid)}


@router.get("/feed/{token}")
def get_ical_feed(token: str, db: Session = Depends(get_db)):
    """
    Public endpoint — returns a .ics calendar file for the user's watchlist
    and currently-watching shows and movies.  Calendar apps subscribe to this
    URL and refresh it periodically.
    """
    user_id = _verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired calendar token")

    # ── Collect tracked show IDs ──────────────────────────────────────────────
    watchlist_show_ids = {
        r.content_id
        for r in db.query(Watchlist.content_id)
        .filter(Watchlist.user_id == user_id, Watchlist.content_type == "tv")
        .all()
    }
    cw_show_ids = {
        r.content_id
        for r in db.query(CurrentlyWatching.content_id)
        .filter(CurrentlyWatching.user_id == user_id, CurrentlyWatching.content_type == "tv")
        .all()
    }
    show_ids = list(watchlist_show_ids | cw_show_ids)

    # ── Collect tracked movie IDs ─────────────────────────────────────────────
    watchlist_movie_ids = {
        r.content_id
        for r in db.query(Watchlist.content_id)
        .filter(Watchlist.user_id == user_id, Watchlist.content_type == "movie")
        .all()
    }
    cw_movie_ids = {
        r.content_id
        for r in db.query(CurrentlyWatching.content_id)
        .filter(CurrentlyWatching.user_id == user_id, CurrentlyWatching.content_type == "movie")
        .all()
    }
    movie_ids = list(watchlist_movie_ids | cw_movie_ids)

    # ── Build the iCalendar object ────────────────────────────────────────────
    cal = Calendar()
    cal.add("prodid", "-//Watch Calendar//watchcalendar//EN")
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("x-wr-calname", "Watch Calendar")
    cal.add("x-wr-caldesc", "TV episodes and movies from your Watch Calendar")
    cal.add("x-wr-timezone", "UTC")
    # Refresh every 12 hours
    cal.add("x-published-ttl", "PT12H")

    # ── TV episodes ───────────────────────────────────────────────────────────
    if show_ids:
        shows = db.query(Show).filter(Show.id.in_(show_ids)).all()
        show_map = {s.id: s for s in shows}

        episodes = (
            db.query(Episode)
            .filter(Episode.show_id.in_(show_ids), Episode.air_date.isnot(None))
            .all()
        )

        for ep in episodes:
            show = show_map.get(ep.show_id)
            if not show:
                continue

            ep_label = f"S{ep.season_number:02d}E{ep.episode_number:02d}"
            summary = f"{show.name} — {ep_label}"
            if ep.name:
                summary += f" {ep.name}"

            event = Event()
            event.add("uid", f"tv-{ep.show_id}-s{ep.season_number}e{ep.episode_number}@watchcalendar")
            event.add("summary", summary)
            event.add("dtstart", ep.air_date)
            event.add("dtend", ep.air_date + timedelta(days=1))
            if ep.overview:
                event.add("description", ep.overview)
            cal.add_component(event)

    # ── Movies ────────────────────────────────────────────────────────────────
    if movie_ids:
        movies = (
            db.query(Movie)
            .filter(Movie.id.in_(movie_ids), Movie.release_date.isnot(None))
            .all()
        )

        for movie in movies:
            event = Event()
            event.add("uid", f"movie-{movie.id}@watchcalendar")
            event.add("summary", movie.title)
            event.add("dtstart", movie.release_date)
            event.add("dtend", movie.release_date + timedelta(days=1))
            if movie.overview:
                event.add("description", movie.overview)
            cal.add_component(event)

    return Response(
        content=cal.to_ical(),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="watch-calendar.ics"'},
    )
