"""
"What should we watch?" for a household: one ranked list of candidates for
the people watching tonight, each with the reasons it's there.

Candidates, strongest first:
- the next episode of a show the people watching have started together
  (or that's on the shared list), the episode the furthest-behind one is on;
- titles on the household's Watch together list;
- titles on two or more of tonight's people's Watchlist / Currently Watching;
- the household's recommendations, for tonight's people.
A title that qualifies more than once collects every reason and every score.

Filters: who's watching, how long you have (an episode up to ~35 or ~70
minutes, or a movie), on a service one of tonight's people pays for, and
kid-friendly (by US certification). A filter that needs data a title doesn't
have (no runtime, no providers stored, no rating) lets it through for time,
but keeps it out for services and kid-friendly: those are promises.

"Surprise me" is the frontend picking from the top of this list.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.household import HouseholdItem
from app.models.movie import Movie
from app.models.provider import MovieProvider, Provider, ShowProvider
from app.models.show import Show
from app.models.user_streaming_service import UserStreamingService
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.household_recs import household_recommendations
from app.services.household_service import HouseholdError, _member_ids, _membership, progress
from app.services.provider_utils import all_ids_for_service, canonical_provider_id, canonical_provider_name

Key = tuple[str, int]

TIME_LIMITS = {"short": 35, "hour": 70}  # minutes, for an episode
TIMES = ("any", "short", "hour", "movie")
KID_RATINGS = {"G", "PG", "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG"}
# Enough that filtering in the browser (time, services, kid-friendly) still
# leaves a full list.
RESULT_LIMIT = 80
REC_LIMIT = 20

SCORE_NEXT_EPISODE = 100.0
SCORE_SHARED_LIST = 60.0
SCORE_WANT = 40.0        # + 10 per extra person who wants it
SCORE_RECOMMENDED = 20.0  # scaled down the recommendation list


def household_picks(
    db: Session,
    uid: str,
    hid: int,
    present: list[str] | None = None,
    time: str = "any",
    services: bool = False,
    kids: bool = False,
    limit: int = RESULT_LIMIT,
) -> dict:
    _membership(db, hid, uid)
    if time not in TIMES:
        raise HouseholdError(422, f"time must be one of {', '.join(TIMES)}")
    members = _member_ids(db, hid)
    tonight = list(dict.fromkeys(m for m in (present or members) if m in members))
    if not tonight:
        raise HouseholdError(422, "Pick who's watching")

    cands: dict[Key, dict] = {}

    def offer(key: Key, reason: dict, score: float) -> dict:
        c = cands.setdefault(key, {"reasons": [], "score": 0.0, "episode": None, "display": None})
        c["reasons"].append(reason)
        c["score"] += score
        return c

    # 1. The next episode of shows tonight's people are watching together.
    for show in progress(db, uid, hid, only=tonight)["shows"]:
        nxt = show["together_next"]
        started = [m["user_id"] for m in show["members"] if m["last_watched"]]
        c = offer(("tv", show["id"]), {"type": "next_episode", "user_ids": started}, SCORE_NEXT_EPISODE)
        c["episode"] = {k: nxt[k] for k in ("season_number", "episode_number", "name")}

    # 2. The shared list.
    statuses = _statuses_for(db, tonight)
    for ct, cid, added_by in db.query(
        HouseholdItem.content_type, HouseholdItem.content_id, HouseholdItem.added_by
    ).filter(HouseholdItem.household_id == hid):
        if _everyone_watched(statuses.get((ct, cid), {}), tonight):
            continue
        offer((ct, cid), {"type": "shared_list", "user_id": added_by}, SCORE_SHARED_LIST)

    # 3. What two or more of tonight's people want.
    for key, by_user in statuses.items():
        wanting = [u for u, status in by_user.items() if status in ("Want To Watch", "Currently Watching")]
        if len(wanting) >= 2 and not _everyone_watched(by_user, tonight):
            offer(key, {"type": "want", "user_ids": wanting}, SCORE_WANT + 10.0 * (len(wanting) - 2))

    # 4. Recommendations for tonight's people.
    recs = household_recommendations(db, uid, hid, only=tonight)
    mixed = [x for pair in zip(recs["shows"], recs["movies"]) for x in pair]
    longer = recs["shows"] if len(recs["shows"]) > len(recs["movies"]) else recs["movies"]
    mixed += longer[min(len(recs["shows"]), len(recs["movies"])):]
    for i, item in enumerate(mixed[:REC_LIMIT]):
        seed = item["because"][0] if item["because"] else None
        c = offer(
            (item["media_type"], item["id"]),
            # basis: "watched" (you watched it together) or "lists" (it's on
            # your lists), so the reason can be worded truthfully.
            {"type": "recommended", "because": seed["title"] if seed else None,
             "basis": seed["reason"] if seed else None},
            SCORE_RECOMMENDED * (1 - i / (2 * REC_LIMIT)),
        )
        c["display"] = item

    if not cands:
        return {"picks": [], "present": tonight, "missing": recs["missing"]}

    info = _title_info(db, set(cands))
    _fill_starting_episodes(db, cands, tonight)
    providers = _flatrate(db, set(cands))
    ours = _services_for(db, tonight)
    runtimes = _episode_runtimes(db, cands)

    picks = []
    for key, c in cands.items():
        ct, cid = key
        meta = info.get(key) or _from_display(c["display"])
        if meta is None:
            continue
        runtime = runtimes.get(key) if ct == "tv" else meta.get("runtime")
        on_ours = sorted(providers.get(key, set()) & set(ours))
        if not _passes(ct, runtime, meta.get("certification"), on_ours, time, services, kids):
            continue
        picks.append({
            "content_type": ct,
            "id": cid,
            "title": meta["title"],
            "poster_path": meta["poster_path"],
            "year": meta.get("year"),
            "runtime": runtime,
            "certification": meta.get("certification"),
            "episode": c["episode"],
            "services": [{"id": p, "name": ours[p]} for p in on_ours],
            "reasons": c["reasons"],
            "score": round(c["score"], 3),
        })
    picks.sort(key=lambda p: (-p["score"], (p["title"] or "").lower()))
    return {"picks": picks[:limit], "present": tonight, "missing": recs["missing"]}


def _passes(ct, runtime, certification, on_ours, time, services, kids) -> bool:
    if time == "movie" and ct != "movie":
        return False
    if time in TIME_LIMITS:
        if ct == "movie":
            return False
        if runtime is not None and runtime > TIME_LIMITS[time]:
            return False
    if services and not on_ours:
        return False
    if kids and (certification or "") not in KID_RATINGS:
        return False
    return True


def _everyone_watched(by_user: dict[str, str], tonight: list[str]) -> bool:
    return all(by_user.get(u) == "Watched" for u in tonight)


def _statuses_for(db: Session, uids: list[str]) -> dict[Key, dict[str, str]]:
    out: dict[Key, dict[str, str]] = defaultdict(dict)
    for model, label in ((Watchlist, "Want To Watch"), (CurrentlyWatching, "Currently Watching"), (Watched, "Watched")):
        for user_id, ct, cid in db.query(model.user_id, model.content_type, model.content_id).filter(
            model.user_id.in_(uids)
        ):
            if ct in ("tv", "movie") and cid is not None:
                out[(ct, cid)][user_id] = label
    return out


def _title_info(db: Session, keys: set[Key]) -> dict[Key, dict]:
    info: dict[Key, dict] = {}
    tv = [cid for ct, cid in keys if ct == "tv"]
    mv = [cid for ct, cid in keys if ct == "movie"]
    if tv:
        for s in db.query(Show.id, Show.name, Show.poster_path, Show.first_air_date, Show.certification).filter(Show.id.in_(tv)):
            info[("tv", s.id)] = {"title": s.name, "poster_path": s.poster_path, "certification": s.certification,
                                  "year": s.first_air_date.year if s.first_air_date else None}
    if mv:
        for m in db.query(Movie.id, Movie.title, Movie.poster_path, Movie.release_date, Movie.certification,
                          Movie.runtime).filter(Movie.id.in_(mv)):
            info[("movie", m.id)] = {"title": m.title, "poster_path": m.poster_path, "certification": m.certification,
                                     "runtime": m.runtime, "year": m.release_date.year if m.release_date else None}
    # A stub with no title (never fetched) falls back to the recommendation's row.
    return {k: v for k, v in info.items() if v["title"]}


def _from_display(item: dict | None) -> dict | None:
    """Title info for a recommended title that isn't cached here."""
    if not item:
        return None
    title = item.get("name") or item.get("title")
    if not title:
        return None
    released = item.get("first_air_date") or item.get("release_date") or ""
    return {"title": title, "poster_path": item.get("poster_path"), "certification": None,
            "runtime": None, "year": int(released[:4]) if released[:4].isdigit() else None}


def _fill_starting_episodes(db: Session, cands: dict[Key, dict], tonight: list[str]) -> None:
    """A show nobody watching tonight has started: point at S1 E1, if it's
    stored and has aired. If someone has started it (but it isn't one the
    group is watching together), there's no single right episode, so none:
    "We watched it" must never log S1 E1 for someone on season 3."""
    no_episode = [cid for (ct, cid), c in cands.items() if ct == "tv" and c["episode"] is None]
    if not no_episode:
        return
    started = {
        sid for (sid,) in db.query(EpisodeWatched.show_id)
        .filter(EpisodeWatched.user_id.in_(tonight), EpisodeWatched.show_id.in_(no_episode))
        .distinct()
    }
    unstarted = [sid for sid in no_episode if sid not in started]
    if not unstarted:
        return
    # A day's grace, like the logging routes.
    latest = datetime.now(timezone.utc).date() + timedelta(days=1)
    for sid, name in db.query(Episode.show_id, Episode.name).filter(
        Episode.show_id.in_(unstarted),
        Episode.season_number == 1,
        Episode.episode_number == 1,
        Episode.air_date.isnot(None),
        Episode.air_date <= latest,
    ):
        cands[("tv", sid)]["episode"] = {"season_number": 1, "episode_number": 1, "name": name}


def _episode_runtimes(db: Session, cands: dict[Key, dict]) -> dict[Key, int]:
    wanted = [
        (cid, c["episode"]["season_number"], c["episode"]["episode_number"])
        for (ct, cid), c in cands.items() if ct == "tv" and c["episode"]
    ]
    if not wanted:
        return {}
    out: dict[Key, int] = {}
    for sid, sn, en, runtime in db.query(
        Episode.show_id, Episode.season_number, Episode.episode_number, Episode.runtime
    ).filter(or_(*[
        and_(Episode.show_id == sid, Episode.season_number == sn, Episode.episode_number == en)
        for sid, sn, en in wanted
    ])):
        if runtime:
            out[("tv", sid)] = runtime
    return out


def _flatrate(db: Session, keys: set[Key]) -> dict[Key, set[int]]:
    out: dict[Key, set[int]] = defaultdict(set)
    tv = [cid for ct, cid in keys if ct == "tv"]
    mv = [cid for ct, cid in keys if ct == "movie"]
    if tv:
        for sid, pid in db.query(ShowProvider.show_id, ShowProvider.provider_id).filter(
            ShowProvider.show_id.in_(tv), ShowProvider.flatrate.is_(True)
        ):
            out[("tv", sid)].add(canonical_provider_id(pid))
    if mv:
        for mid, pid in db.query(MovieProvider.movie_id, MovieProvider.provider_id).filter(
            MovieProvider.movie_id.in_(mv), MovieProvider.flatrate.is_(True)
        ):
            out[("movie", mid)].add(canonical_provider_id(pid))
    return out


def _services_for(db: Session, uids: list[str]) -> dict[int, str]:
    """The services tonight's people pay for: canonical id -> name."""
    cpids = {
        canonical_provider_id(pid) for (pid,) in db.query(UserStreamingService.provider_id)
        .filter(UserStreamingService.user_id.in_(uids))
    }
    if not cpids:
        return {}
    wanted = {pid: cpid for cpid in cpids for pid in all_ids_for_service(cpid)}
    names: dict[int, str] = {}
    for p in db.query(Provider).filter(Provider.id.in_(list(wanted))):
        cpid = wanted[p.id]
        if cpid not in names or p.id == cpid:
            names[cpid] = canonical_provider_name(p.id, p.name)
    return {cpid: names.get(cpid, f"Service {cpid}") for cpid in cpids}
