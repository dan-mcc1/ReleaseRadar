"""
"My services": for each streaming service a user pays for, what from their
lists lands on it soon, what's ready to watch on it now, when they last used
it, and whether it's worth pausing. Paused services get a reminder a week
before something from the user's list premieres on them.

Built from stored data only (provider rows, episode/season/movie dates, watch
timestamps); the popular-titles rail is the one TMDb call, cached a day.

Services are compared by canonical provider id (provider_utils), so "Netflix
Standard with Ads" counts as Netflix. Availability is US-only, like the
provider data it reads. TMDb has no future streaming dates for movies, so a
movie counts once it's on a service; TV is where "coming up" works.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.movie import Movie
from app.models.provider import MovieProvider, Provider, ShowProvider
from app.models.season import Season
from app.models.sent_resume_reminder import SentResumeReminder
from app.models.show import Show
from app.models.user_streaming_service import UserStreamingService
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.provider_utils import (
    all_ids_for_service,
    canonical_provider_id,
    canonical_provider_name,
)
from app.services.tmdb_client import get
from app.services.ttl_cache import LIST_MAXSIZE, TTL_LONG, ttl_cached

LOOKAHEAD_DAYS = 90       # "coming up" window
RECENT_USE_DAYS = 30      # used this recently -> worth keeping
REMINDER_LEAD_DAYS = 7    # resume reminders go out this far ahead
UPCOMING_LIMIT = 10
READY_LIMIT = 8
POPULAR_LIMIT = 12

Key = tuple[str, int]  # (content_type, content_id)


@dataclass
class Release:
    """The next time a title has something new: a premiere, an episode, or
    a movie's release."""
    content_type: str
    content_id: int
    date: date
    kind: str  # series_premiere | season_premiere | episode | movie
    season_number: int | None = None
    episode_number: int | None = None


# ── What the user tracks, and where it streams ──────────────────────────────


def tracked_titles(db: Session, user_id: str, notify_only: bool = False) -> set[Key]:
    """Watchlist and Currently Watching, plus Watched shows still in
    production (their next season is the reason to come back). With
    notify_only, Watchlist titles the user muted are left out."""
    keys: set[Key] = set()
    muted: set[Key] = set()
    for ct, cid, notify in db.query(
        Watchlist.content_type, Watchlist.content_id, Watchlist.notify
    ).filter(Watchlist.user_id == user_id):
        keys.add((ct, cid))
        if not notify:
            muted.add((ct, cid))
    keys |= {
        (ct, cid)
        for ct, cid in db.query(CurrentlyWatching.content_type, CurrentlyWatching.content_id)
        .filter(CurrentlyWatching.user_id == user_id)
    }
    keys |= {
        ("tv", sid)
        for (sid,) in db.query(Watched.content_id)
        .join(Show, Show.id == Watched.content_id)
        .filter(
            Watched.user_id == user_id,
            Watched.content_type == "tv",
            Show.in_production == True,  # noqa: E712
        )
    }
    if notify_only:
        # A muted Watchlist title stays muted even if it's also Watched or
        # Currently Watching.
        keys -= muted
    return {k for k in keys if k[0] in ("tv", "movie") and k[1] is not None}


def flatrate_services(db: Session, keys: set[Key]) -> dict[Key, set[int]]:
    """Each title's subscription services, as canonical provider ids."""
    out: dict[Key, set[int]] = {k: set() for k in keys}
    tv_ids = [cid for ct, cid in keys if ct == "tv"]
    movie_ids = [cid for ct, cid in keys if ct == "movie"]
    if tv_ids:
        for sid, pid in db.query(ShowProvider.show_id, ShowProvider.provider_id).filter(
            ShowProvider.show_id.in_(tv_ids), ShowProvider.flatrate.is_(True)
        ):
            out[("tv", sid)].add(canonical_provider_id(pid))
    if movie_ids:
        for mid, pid in db.query(MovieProvider.movie_id, MovieProvider.provider_id).filter(
            MovieProvider.movie_id.in_(movie_ids), MovieProvider.flatrate.is_(True)
        ):
            out[("movie", mid)].add(canonical_provider_id(pid))
    return out


def next_releases(
    db: Session, keys: set[Key], today: date, premieres_only: bool = False
) -> dict[Key, Release]:
    """Each title's next release on or after today, if one is known. With
    premieres_only, mid-season episodes are skipped: a show's next release is
    then its next season or series premiere."""
    out: dict[Key, Release] = {}

    def offer(release: Release) -> None:
        key = (release.content_type, release.content_id)
        current = out.get(key)
        if current is None or release.date < current.date:
            out[key] = release

    tv_ids = [cid for ct, cid in keys if ct == "tv"]
    if tv_ids:
        episodes = db.query(
            Episode.show_id, Episode.season_number, Episode.episode_number, Episode.air_date
        ).filter(
            Episode.show_id.in_(tv_ids),
            Episode.season_number > 0,
            Episode.air_date.isnot(None),
            Episode.air_date >= today,
        )
        if premieres_only:
            episodes = episodes.filter(Episode.episode_number == 1)
        rows = episodes.order_by(
            Episode.air_date, Episode.season_number, Episode.episode_number
        ).all()
        for sid, sn, en, aired in rows:
            if ("tv", sid) in out:
                continue  # ordered by date: the first row per show is its next
            offer(Release("tv", sid, aired, _episode_kind(sn, en), sn, en))
        # A season announced with a date but no episodes stored yet.
        for sid, sn, aired in db.query(Season.show_id, Season.season_number, Season.air_date).filter(
            Season.show_id.in_(tv_ids),
            Season.season_number > 0,
            Season.air_date.isnot(None),
            Season.air_date >= today,
        ):
            offer(Release("tv", sid, aired, _episode_kind(sn, 1), sn, 1))

    movie_ids = [cid for ct, cid in keys if ct == "movie"]
    if movie_ids:
        for mid, released in db.query(Movie.id, Movie.release_date).filter(
            Movie.id.in_(movie_ids), Movie.release_date.isnot(None), Movie.release_date >= today
        ):
            offer(Release("movie", mid, released, "movie"))
    return out


def _episode_kind(season_number: int, episode_number: int) -> str:
    if episode_number == 1:
        return "series_premiere" if season_number == 1 else "season_premiere"
    return "episode"


def _title_info(db: Session, keys: set[Key]) -> dict[Key, dict]:
    info: dict[Key, dict] = {}
    tv_ids = [cid for ct, cid in keys if ct == "tv"]
    movie_ids = [cid for ct, cid in keys if ct == "movie"]
    if tv_ids:
        for s in db.query(Show.id, Show.name, Show.poster_path, Show.first_air_date).filter(Show.id.in_(tv_ids)):
            info[("tv", s.id)] = {"title": s.name, "poster_path": s.poster_path, "released": s.first_air_date}
    if movie_ids:
        for m in db.query(Movie.id, Movie.title, Movie.poster_path, Movie.release_date).filter(Movie.id.in_(movie_ids)):
            info[("movie", m.id)] = {"title": m.title, "poster_path": m.poster_path, "released": m.release_date}
    return info


def _user_services(db: Session, user_id: str) -> dict[int, datetime | None]:
    """The user's services by canonical id, with when each was paused."""
    services: dict[int, datetime | None] = {}
    for pid, paused_at in db.query(UserStreamingService.provider_id, UserStreamingService.paused_at).filter(
        UserStreamingService.user_id == user_id
    ):
        cpid = canonical_provider_id(pid)
        # A legacy duplicate row for the same service: paused if either is.
        services[cpid] = services.get(cpid) or paused_at
    return services


def _provider_display(db: Session, cpids: set[int]) -> dict[int, dict]:
    """Name and logo per canonical id, preferring the canonical row's own."""
    wanted: dict[int, int] = {}
    for cpid in cpids:
        for pid in all_ids_for_service(cpid):
            wanted[pid] = cpid
    out: dict[int, dict] = {}
    for p in db.query(Provider).filter(Provider.id.in_(list(wanted))).all():
        cpid = wanted[p.id]
        if cpid not in out or p.id == cpid:
            out[cpid] = {"name": canonical_provider_name(p.id, p.name), "logo_path": p.logo_path}
    return out


def _last_used_by_service(db: Session, user_id: str, cpids: set[int]) -> dict[int, dict]:
    """For each service, the latest episode or movie the user logged on a
    title that streams there today. Four queries whatever the number of
    services: the latest watch per title, then those titles' providers."""
    latest: dict[Key, datetime] = {}
    for sid, at in (
        db.query(EpisodeWatched.show_id, func.max(EpisodeWatched.watched_at))
        .filter(EpisodeWatched.user_id == user_id, EpisodeWatched.watched_at.isnot(None))
        .group_by(EpisodeWatched.show_id)
    ):
        latest[("tv", sid)] = _aware(at)
    for mid, at in (
        db.query(Watched.content_id, func.max(Watched.watched_at))
        .filter(
            Watched.user_id == user_id,
            Watched.content_type == "movie",
            Watched.watched_at.isnot(None),
        )
        .group_by(Watched.content_id)
    ):
        latest[("movie", mid)] = _aware(at)
    if not latest:
        return {}

    best: dict[int, tuple[datetime, Key]] = {}
    for key, pids in flatrate_services(db, set(latest)).items():
        for cpid in pids & cpids:
            if cpid not in best or latest[key] > best[cpid][0]:
                best[cpid] = (latest[key], key)
    info = _title_info(db, {key for _, key in best.values()})
    return {
        cpid: {
            "at": at.isoformat(),
            "content_type": key[0],
            "id": key[1],
            "title": info.get(key, {}).get("title"),
        }
        for cpid, (at, key) in best.items()
    }


def _aware(value: datetime) -> datetime:
    # SQLite (the tests) hands back naive datetimes; Postgres doesn't.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _release_dict(release: Release, info: dict) -> dict:
    return {
        "content_type": release.content_type,
        "id": release.content_id,
        "title": info.get("title"),
        "poster_path": info.get("poster_path"),
        "date": release.date.isoformat(),
        "kind": release.kind,
        "season_number": release.season_number,
        "episode_number": release.episode_number,
    }


# ── The overview ─────────────────────────────────────────────────────────────


def build_service_overview(
    db: Session, user_id: str, today: date, now: datetime | None = None
) -> dict:
    now = now or datetime.now(timezone.utc)
    services = _user_services(db, user_id)
    result = {
        "lookahead_days": LOOKAHEAD_DAYS,
        "recent_use_days": RECENT_USE_DAYS,
        "services": [],
    }
    if not services:
        return result

    keys = tracked_titles(db, user_id)
    title_services = flatrate_services(db, keys)
    releases = next_releases(db, keys, today)
    premieres = next_releases(db, keys, today, premieres_only=True)
    last_used_by_service = _last_used_by_service(db, user_id, set(services))
    info = _title_info(db, keys)
    display = _provider_display(db, set(services))
    # "Ready now" is the user's own queue: Watchlist and Currently Watching
    # titles that are already out.
    queue = {
        (ct, cid)
        for ct, cid in db.query(Watchlist.content_type, Watchlist.content_id).filter(Watchlist.user_id == user_id)
    } | {
        (ct, cid)
        for ct, cid in db.query(CurrentlyWatching.content_type, CurrentlyWatching.content_id)
        .filter(CurrentlyWatching.user_id == user_id)
    }
    horizon = today + timedelta(days=LOOKAHEAD_DAYS)
    recent_cutoff = now - timedelta(days=RECENT_USE_DAYS)

    for cpid, paused_at in services.items():
        on_service = [k for k, pids in title_services.items() if cpid in pids]
        future = sorted(
            (releases[k] for k in on_service if k in releases),
            key=lambda r: (r.date, info.get((r.content_type, r.content_id), {}).get("title") or ""),
        )
        upcoming = [r for r in future if r.date <= horizon]
        ready = [
            k for k in on_service
            if k in queue
            and (info.get(k, {}).get("released") is not None and info[k]["released"] <= today)
        ]
        ready.sort(key=lambda k: info.get(k, {}).get("title") or "")
        last_used = last_used_by_service.get(cpid)
        next_premiere = min(
            (premieres[k] for k in on_service if k in premieres),
            key=lambda r: r.date,
            default=None,
        )
        used_recently = last_used is not None and datetime.fromisoformat(last_used["at"]) >= recent_cutoff

        if paused_at is not None:
            verdict = "paused"
        elif upcoming or used_recently:
            verdict = "keep"
        else:
            verdict = "pause"

        shown = display.get(cpid, {"name": f"Service {cpid}", "logo_path": None})
        result["services"].append({
            "id": cpid,
            "name": shown["name"],
            "logo_path": shown["logo_path"],
            "paused_at": _aware(paused_at).isoformat() if paused_at else None,
            "verdict": verdict,
            "upcoming": [
                _release_dict(r, info.get((r.content_type, r.content_id), {}))
                for r in upcoming[:UPCOMING_LIMIT]
            ],
            "upcoming_count": len(upcoming),
            # The first known release at any distance: "Next: X on Jul 4".
            "next_release": _release_dict(future[0], info.get((future[0].content_type, future[0].content_id), {}))
            if future else None,
            # What a paused service's reminder will be about: the next
            # premiere or movie, never a mid-season episode.
            "next_premiere": _release_dict(
                next_premiere, info.get((next_premiere.content_type, next_premiere.content_id), {})
            ) if next_premiere else None,
            "ready_now": {
                "count": len(ready),
                "items": [
                    {"content_type": ct, "id": cid, "title": info[(ct, cid)]["title"],
                     "poster_path": info[(ct, cid)]["poster_path"]}
                    for ct, cid in ready[:READY_LIMIT]
                ],
            },
            "last_used": last_used,
        })

    result["services"].sort(key=lambda s: s["name"].lower())
    return result


# ── Pausing ──────────────────────────────────────────────────────────────────


def set_service_paused(db: Session, user_id: str, provider_id: int, paused: bool) -> bool:
    """Pause or resume one of the user's services. False if they don't have it."""
    rows = (
        db.query(UserStreamingService)
        .filter(
            UserStreamingService.user_id == user_id,
            UserStreamingService.provider_id.in_(list(all_ids_for_service(provider_id))),
        )
        .all()
    )
    if not rows:
        return False
    stamp = datetime.now(timezone.utc) if paused else None
    for row in rows:
        if paused and row.paused_at is not None:
            continue  # keep the original pause date
        row.paused_at = stamp
    db.commit()
    return True


# ── Popular on a service ─────────────────────────────────────────────────────


@ttl_cached(LIST_MAXSIZE, TTL_LONG)
def _discover_popular(media: str, provider_ids: tuple[int, ...]) -> tuple:
    """TMDb's most popular titles streaming on a service in the US."""
    data = get(
        f"/discover/{media}",
        params={
            "with_watch_providers": "|".join(str(p) for p in provider_ids),
            "watch_region": "US",
            "with_watch_monetization_types": "flatrate",
            "sort_by": "popularity.desc",
            "include_adult": "false",
            "page": 1,
        },
    )
    return tuple(data.get("results", []))


def popular_on_service(db: Session, user_id: str, provider_id: int) -> list[dict]:
    """Popular titles on a service that aren't on any of the user's lists,
    shows and movies interleaved. Raises LookupError for a service the user
    hasn't added, which also keeps the cache to services people have."""
    if canonical_provider_id(provider_id) not in _user_services(db, user_id):
        raise LookupError(provider_id)
    ids = tuple(sorted(all_ids_for_service(provider_id)))
    on_lists: set[Key] = set()
    for model in (Watchlist, CurrentlyWatching, Watched):
        on_lists |= {
            (ct, cid)
            for ct, cid in db.query(model.content_type, model.content_id).filter(model.user_id == user_id)
        }

    def pick(media: str, ct: str, title_field: str, date_field: str) -> list[dict]:
        return [
            {
                "content_type": ct,
                "id": r["id"],
                "title": r.get(title_field),
                "poster_path": r.get("poster_path"),
                "year": (r.get(date_field) or "")[:4] or None,
                "vote_average": r.get("vote_average"),
            }
            for r in _discover_popular(media, ids)
            if (ct, r.get("id")) not in on_lists and r.get("poster_path")
        ]

    shows = pick("tv", "tv", "name", "first_air_date")
    movies = pick("movie", "movie", "title", "release_date")
    mixed: list[dict] = []
    for i in range(max(len(shows), len(movies))):
        mixed.extend(x[i] for x in (shows, movies) if i < len(x))
    return mixed[:POPULAR_LIMIT]


# ── Resume reminders ─────────────────────────────────────────────────────────


def users_with_paused_services(db: Session) -> list[str]:
    return [
        uid for (uid,) in db.query(UserStreamingService.user_id)
        .filter(UserStreamingService.paused_at.isnot(None))
        .distinct()
    ]


def pending_resume_reminders(db: Session, user_id: str, alert_date: date) -> list[dict]:
    """
    Reminders due for a user: on each paused service, titles from their lists
    that premiere (or, for movies, release) within REMINDER_LEAD_DAYS of
    alert_date and haven't been reminded about. Mid-season episodes don't
    count, so a weekly show doesn't send a reminder every week.
    """
    services = {cpid: at for cpid, at in _user_services(db, user_id).items() if at is not None}
    if not services:
        return []
    keys = tracked_titles(db, user_id, notify_only=True)
    title_services = flatrate_services(db, keys)
    releases = next_releases(db, keys, alert_date, premieres_only=True)
    last = alert_date + timedelta(days=REMINDER_LEAD_DAYS)
    due = [
        (cpid, r)
        for k, r in releases.items()
        if r.kind != "episode" and r.date <= last
        for cpid in title_services.get(k, set()) & set(services)
    ]
    if not due:
        return []
    sent = {
        (row.provider_id, row.content_type, row.content_id, row.release_date)
        for row in db.query(SentResumeReminder).filter(SentResumeReminder.user_id == user_id)
    }
    info = _title_info(db, {(r.content_type, r.content_id) for _, r in due})
    display = _provider_display(db, {cpid for cpid, _ in due})
    out = []
    for cpid, r in sorted(due, key=lambda x: (x[1].date, x[0])):
        if (cpid, r.content_type, r.content_id, r.date) in sent:
            continue
        item = _release_dict(r, info.get((r.content_type, r.content_id), {}))
        item.update(
            provider_id=cpid,
            provider_name=display.get(cpid, {}).get("name", "your service"),
            days_away=(r.date - alert_date).days,
        )
        out.append(item)
    return out
