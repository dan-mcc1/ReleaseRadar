import base64
import hashlib
import hmac
from datetime import datetime, date, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from icalendar import Calendar, Event
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import get_db
from app.dependencies.auth import get_current_user
from app.dependencies.subscription import feature_gate
from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.movie import Movie
from app.models.show import Show
from app.models.user import User
from app.models.watchlist import Watchlist
from app.core.limiter import limiter

# Calendar apps choke on multi-thousand-event feeds. The volume problem is
# back-catalog: tracking a finished show like Friends (236 episodes) shouldn't
# put a decade of entries in your calendar. We drop anything older than this
# window. Future content is kept unbounded — long-announced releases (e.g. a
# sequel three years out) are legitimately in the user's calendar.
ICAL_PAST_DAYS = 30

router = APIRouter()


# ── Token helpers ─────────────────────────────────────────────────────────────


def _make_token(user_id: str, version: int) -> str:
    """Return a URL-safe token that encodes and authenticates the user_id + version."""
    uid_b64 = base64.urlsafe_b64encode(user_id.encode()).decode().rstrip("=")
    payload = f"{user_id}:{version}".encode()
    sig = hmac.new(settings.ICAL_SECRET.encode(), payload, hashlib.sha256).hexdigest()[:32]
    return f"{uid_b64}.{version}.{sig}"


def _verify_token(token: str, db: Session) -> str | None:
    """Return the user_id if the token is valid and the version matches, else None."""
    try:
        uid_b64, version_str, sig = token.split(".", 2)
        version = int(version_str)
        padding = (4 - len(uid_b64) % 4) % 4
        user_id = base64.urlsafe_b64decode(uid_b64 + "=" * padding).decode()
        payload = f"{user_id}:{version}".encode()
        expected = hmac.new(settings.ICAL_SECRET.encode(), payload, hashlib.sha256).hexdigest()[:32]
        if not hmac.compare_digest(sig, expected):
            return None
        user = db.get(User, user_id)
        if user is None or (user.ical_token_version or 1) != version:
            return None
        return user_id
    except Exception:
        pass
    return None


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/token")
def get_ical_token(
    uid: str = Depends(feature_gate("ical_sync")),
    db: Session = Depends(get_db),
):
    """Return the user's personal iCal feed token — requires a premium subscription."""
    user = db.get(User, uid)
    version = user.ical_token_version if user else 1
    return {"token": _make_token(uid, version)}


@router.post("/revoke")
def revoke_ical_token(
    uid: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Invalidate the current iCal feed URL and return a new token."""
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.ical_token_version = (user.ical_token_version or 1) + 1
    db.commit()
    return {"token": _make_token(uid, user.ical_token_version)}


def _ical_key(request: Request) -> str:
    return request.path_params.get("token", request.client.host)


@router.get("/feed/{token}")
@limiter.limit("6/minute", key_func=_ical_key)
def get_ical_feed(request: Request, token: str, db: Session = Depends(get_db)):
    """
    Public endpoint — returns a .ics calendar file for the user's watchlist
    and currently-watching shows and movies.  Calendar apps subscribe to this
    URL and refresh it periodically.
    """
    user_id = _verify_token(token, db)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired calendar token")

    today = datetime.now(timezone.utc).date()
    window_start: date = today - timedelta(days=ICAL_PAST_DAYS)

    client_etag = request.headers.get("If-None-Match", "")

    # ── Collect tracked content IDs (one UNION roundtrip for TV + movies) ────
    tracked_q = (
        select(Watchlist.content_type, Watchlist.content_id)
        .where(Watchlist.user_id == user_id)
        .union(
            select(CurrentlyWatching.content_type, CurrentlyWatching.content_id)
            .where(CurrentlyWatching.user_id == user_id)
        )
    )
    show_ids: list[int] = []
    movie_ids: list[int] = []
    for content_type, content_id in db.execute(tracked_q).all():
        if content_type == "tv":
            show_ids.append(content_id)
        elif content_type == "movie":
            movie_ids.append(content_id)

    # ── Build the iCalendar object ────────────────────────────────────────────
    cal = Calendar()
    cal.add("prodid", "-//ReleaseRadar//releaseradar//EN")
    cal.add("version", "2.0")
    cal.add("method", "PUBLISH")
    cal.add("calscale", "GREGORIAN")
    cal.add("x-wr-calname", "Release Radar")
    cal.add("x-wr-caldesc", "TV episodes and movies from Release Radar")
    cal.add("x-wr-timezone", "UTC")
    cal.add("x-published-ttl", "PT12H")

    def _timed_event(
        dtstart_utc: datetime, runtime_minutes: int | None
    ) -> tuple[datetime, datetime]:
        """Return (dtstart, dtend) as UTC datetimes for a timed event."""
        dtend = dtstart_utc + timedelta(minutes=runtime_minutes or 60)
        return dtstart_utc, dtend

    def _allday_event(air_date) -> tuple[datetime, datetime]:
        """
        Return (dtstart, dtend) as UTC datetimes spanning the full local day.
        Using midnight→midnight UTC keeps the event on the right date for the
        majority of timezones and avoids mixing VALUE=DATE with DATETIME events
        (which breaks Outlook's parser).
        """
        d = (
            air_date
            if not isinstance(air_date, str)
            else datetime.fromisoformat(air_date).date()
        )
        dtstart = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)
        dtend = dtstart + timedelta(days=1)
        return dtstart, dtend

    # ── TV episodes ───────────────────────────────────────────────────────────
    if show_ids:
        shows = db.query(Show).filter(Show.id.in_(show_ids)).all()
        show_map = {s.id: s for s in shows}

        episodes = (
            db.query(Episode)
            .filter(
                Episode.show_id.in_(show_ids),
                Episode.air_date.isnot(None),
                Episode.air_date >= window_start,
            )
            .all()
        )

        for ep in episodes:
            try:
                show = show_map.get(ep.show_id)
                if not show:
                    continue

                ep_label = f"S{ep.season_number:02d}E{ep.episode_number:02d}"
                summary = f"{show.name} \u2014 {ep_label}"
                if ep.name:
                    summary += f" {ep.name}"

                if show.air_time:
                    hour, minute = map(int, show.air_time.split(":"))
                    if show.air_timezone:
                        tz = ZoneInfo(show.air_timezone)
                        local_dt = datetime(
                            ep.air_date.year,
                            ep.air_date.month,
                            ep.air_date.day,
                            hour,
                            minute,
                            tzinfo=tz,
                        )
                        dtstart = local_dt.astimezone(timezone.utc)
                    else:
                        dtstart = datetime(
                            ep.air_date.year,
                            ep.air_date.month,
                            ep.air_date.day,
                            hour,
                            minute,
                            tzinfo=timezone.utc,
                        )
                    dtstart, dtend = _timed_event(dtstart, ep.runtime)
                else:
                    dtstart, dtend = _allday_event(ep.air_date)

                event = Event()
                event.add(
                    "uid",
                    f"tv-{ep.show_id}-s{ep.season_number}e{ep.episode_number}@releaseradar",
                )
                event.add("dtstamp", dtstart)
                event.add("summary", summary)
                event.add("dtstart", dtstart)
                event.add("dtend", dtend)
                if not show.air_time:
                    # Tell Outlook to render this as an all-day event
                    event.add("x-microsoft-cdo-alldayevent", "TRUE")
                if ep.overview:
                    # Cap description length to avoid parse issues in some clients
                    event.add("description", ep.overview[:500])
                cal.add_component(event)
            except Exception as e:
                print(f"[ical] Skipped episode {ep.id}: {e}")

    # ── Movies ────────────────────────────────────────────────────────────────
    if movie_ids:
        movies = (
            db.query(Movie)
            .filter(
                Movie.id.in_(movie_ids),
                Movie.release_date.isnot(None),
                Movie.release_date >= window_start,
            )
            .all()
        )

        for movie in movies:
            try:
                dtstart, dtend = _allday_event(movie.release_date)
                event = Event()
                event.add("uid", f"movie-{movie.id}@releaseradar")
                event.add("dtstamp", dtstart)
                event.add("summary", movie.title)
                event.add("dtstart", dtstart)
                event.add("dtend", dtend)
                event.add("x-microsoft-cdo-alldayevent", "TRUE")
                if movie.overview:
                    event.add("description", movie.overview[:500])
                cal.add_component(event)
            except Exception as e:
                print(f"[ical] Skipped movie {movie.id}: {e}")

    body = cal.to_ical()
    etag = '"' + hashlib.sha256(body).hexdigest() + '"'
    if client_etag == etag:
        return Response(status_code=304, headers={"ETag": etag})

    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'inline; filename="releaseradar.ics"',
            "ETag": etag,
            "Cache-Control": "private, max-age=3600",
        },
    )
