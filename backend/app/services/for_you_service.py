"""
For You: titles recommended alongside what the user tracks, ranked by how
strongly their own library points at each one.

Every tracked title has a stored list of recommended titles (title_recs,
kept fresh by title_recs_service). A request reads the lists for the user's
whole library from the database and scores them, in three queries; TMDb is
only asked for titles that have no stored list yet, a few at a time.
"""
import logging
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import Float, and_, literal, null, or_, select, union_all
from sqlalchemy.orm import Session

from app.models.currently_watching import CurrentlyWatching
from app.models.movie import Movie
from app.models.show import Show
from app.models.title_recs import RecCandidate, TitleRecs
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.title_recs_service import ORIGIN_TMDB, Key, fetch_and_store

logger = logging.getLogger(__name__)

_RETURN_LIMIT = 40  # per type
# Titles with no stored list yet that one request will fetch from TMDb. A new
# account gets picks on its first visit; the hourly refresh covers the rest.
_INLINE_FETCH_LIMIT = 20
# How long one request waits for those fetches. If TMDb doesn't deliver them
# all, requests stop asking it for a while and serve what is stored, so an
# outage costs one slow page rather than every one.
_INLINE_FETCH_SECONDS = 4.0
_INLINE_PAUSE_SECONDS = 120.0
_inline_paused_until = 0.0  # time.monotonic(); shared by every request in this process
_BECAUSE_LIMIT = 2  # seed titles named as the reason for a pick

_WATCHED, _WATCHING, _WATCHLIST = "watched", "watching", "watchlist"
# When a title is on more than one list, the one that says most about it
# wins outright: watched and rated 2 stars counts for nothing even if it is
# also on the watchlist.
_LIST_PRIORITY = {_WATCHED: 3, _WATCHING: 2, _WATCHLIST: 1}
_RECENCY_HALF_LIFE_DAYS = 365
_RECENCY_FLOOR = 0.25


@dataclass(frozen=True)
class Seed:
    """A title in the user's library and how much its recommendations count."""

    key: Key
    weight: float
    list_name: str

    @property
    def seen(self) -> bool:
        """Watched or being watched, so it can be named as the reason for a pick."""
        return self.list_name != _WATCHLIST


def seed_weight(list_name: str, rating: float | None, at: datetime | None, now: datetime) -> float:
    """How much a library title's recommendations count.

    A watched title counts by its rating: 5 stars double, unrated 1, and 2
    stars or fewer nothing, so disliked titles recommend nothing. A title
    being watched counts a little more than an unrated one, a watchlist title
    less. Everything fades with age, down to a quarter, so recent taste leads
    without old favourites disappearing.
    """
    if list_name == _WATCHED:
        base = 1.0 if rating is None else max(0.0, (rating - 2.0) / 1.5)
    elif list_name == _WATCHING:
        base = 1.2
    else:
        base = 0.6
    if at is None:
        return base * _RECENCY_FLOOR
    if at.tzinfo is None:  # SQLite hands back naive datetimes
        at = at.replace(tzinfo=timezone.utc)
    age_days = max(0.0, (now - at).total_seconds() / 86400)
    return base * max(_RECENCY_FLOOR, 0.5 ** (age_days / _RECENCY_HALF_LIFE_DAYS))


def _library(db: Session, uid: str, now: datetime) -> tuple[dict[Key, Seed], dict[Key, list[Key]]]:
    """Everything the user has on a list, as seeds, and the stored
    recommendation list of each title that has one. One query."""
    entries = union_all(
        select(
            literal(_WATCHED).label("list_name"), Watched.content_type, Watched.content_id,
            Watched.rating.label("rating"), Watched.watched_at.label("at"),
        ).where(Watched.user_id == uid),
        select(
            literal(_WATCHING), CurrentlyWatching.content_type, CurrentlyWatching.content_id,
            null().cast(Float), CurrentlyWatching.added_at,
        ).where(CurrentlyWatching.user_id == uid),
        select(
            literal(_WATCHLIST), Watchlist.content_type, Watchlist.content_id,
            null().cast(Float), Watchlist.added_at,
        ).where(Watchlist.user_id == uid),
    ).subquery("library")
    rows = db.execute(
        select(
            entries.c.list_name, entries.c.content_type, entries.c.content_id,
            entries.c.rating, entries.c.at, TitleRecs.recs,
        )
        .select_from(entries)
        .outerjoin(TitleRecs, and_(
            TitleRecs.content_type == entries.c.content_type,
            TitleRecs.content_id == entries.c.content_id,
            TitleRecs.origin == ORIGIN_TMDB,
        ))
    ).all()

    seeds: dict[Key, Seed] = {}
    lists: dict[Key, list[Key]] = {}
    for list_name, content_type, content_id, rating, at, recs in rows:
        if content_type not in ("movie", "tv") or content_id is None:
            continue
        key = (content_type, content_id)
        if recs is not None:  # None: no stored list. An empty one is still a list.
            lists[key] = [(rec_type, rec_id) for rec_type, rec_id in recs]
        current = seeds.get(key)
        if current and _LIST_PRIORITY[current.list_name] >= _LIST_PRIORITY[list_name]:
            continue
        seeds[key] = Seed(key, seed_weight(list_name, rating, at, now), list_name)
    return seeds, lists


def _fill_missing(db: Session, seeds: dict[Key, Seed], lists: dict[Key, list[Key]], now: datetime) -> None:
    """Fetch lists for the heaviest seeds that have none stored and add them to `lists`."""
    missing = sorted(
        (seed for seed in seeds.values() if seed.weight > 0 and seed.key not in lists),
        key=lambda seed: seed.weight,
        reverse=True,
    )[:_INLINE_FETCH_LIMIT]
    global _inline_paused_until
    if not missing or time.monotonic() < _inline_paused_until:
        return
    try:
        fetched = fetch_and_store(
            db, [seed.key for seed in missing], now, timeout=_INLINE_FETCH_SECONDS
        )
        db.commit()
    except Exception:
        # The page still works from what is already stored.
        db.rollback()
        logger.exception("for you: storing fetched recommendations failed")
        return
    lists.update(fetched)
    if len(fetched) < len(missing):
        _inline_paused_until = time.monotonic() + _INLINE_PAUSE_SECONDS


def rank(
    seeds: dict[Key, Seed], lists: dict[Key, list[Key]]
) -> tuple[dict[Key, float], dict[Key, list[Key]]]:
    """Score every title the library's lists recommend.

    Each seed gives a pick its weight, scaled from full at the top of the
    seed's list down to half at the bottom; a pick's score is the sum over
    every seed that lists it. Titles already in the library are left out.
    Returns the scores and, per pick, the seen seeds behind it, strongest first.
    """
    scores: dict[Key, float] = defaultdict(float)
    parts: dict[Key, list[tuple[float, Key]]] = defaultdict(list)
    for key, recs in lists.items():
        seed = seeds.get(key)
        if seed is None or seed.weight <= 0:
            continue
        for position, rec in enumerate(recs):
            if rec in seeds:
                continue
            part = seed.weight * (1 - 0.5 * position / len(recs))
            scores[rec] += part
            if seed.seen:
                parts[rec].append((part, key))
    because = {
        rec: [key for _, key in sorted(contributions, reverse=True)[:_BECAUSE_LIMIT]]
        for rec, contributions in parts.items()
    }
    return dict(scores), because


def _candidates(db: Session, keys: list[Key]) -> dict[Key, RecCandidate]:
    by_type: dict[str, list[int]] = defaultdict(list)
    for content_type, content_id in keys:
        by_type[content_type].append(content_id)
    if not by_type:
        return {}
    rows = db.query(RecCandidate).filter(or_(*[
        and_(RecCandidate.content_type == content_type, RecCandidate.content_id.in_(ids))
        for content_type, ids in by_type.items()
    ])).all()
    return {(row.content_type, row.content_id): row for row in rows}


def _seed_titles(db: Session, keys: set[Key]) -> dict[Key, str]:
    if not keys:
        return {}
    movie_ids = [cid for ct, cid in keys if ct == "movie"]
    show_ids = [cid for ct, cid in keys if ct == "tv"]
    rows = db.execute(union_all(
        select(literal("movie"), Movie.id, Movie.title).where(Movie.id.in_(movie_ids)),
        select(literal("tv"), Show.id, Show.name).where(Show.id.in_(show_ids)),
    )).all()
    return {(content_type, content_id): title for content_type, content_id, title in rows}


def _serialize(candidate: RecCandidate, because: list[dict]) -> dict:
    """Shaped like a TMDb list item, which is what the frontend already reads."""
    item = {
        "id": candidate.content_id,
        "media_type": candidate.content_type,
        "poster_path": candidate.poster_path,
        "backdrop_path": candidate.backdrop_path,
        "vote_average": candidate.vote_average,
        "popularity": candidate.popularity,
        "genre_ids": candidate.genre_ids or [],
        "because": because,
    }
    if candidate.content_type == "movie":
        item["title"] = candidate.title
        item["release_date"] = candidate.release_date
    else:
        item["name"] = candidate.title
        item["first_air_date"] = candidate.release_date
    return item


def get_for_you_recommendations(db: Session, uid: str) -> dict:
    """The user's picks: up to _RETURN_LIMIT movies and as many shows, best
    first, each with the watched titles that led to it."""
    now = datetime.now(timezone.utc)
    seeds, lists = _library(db, uid, now)
    if not seeds:
        return {"movies": [], "shows": [], "seed_count": 0}

    _fill_missing(db, seeds, lists, now)
    scores, because = rank(seeds, lists)

    # A generous shortlist per type, since a few may have no display row.
    shortlist: dict[str, list[Key]] = {}
    for content_type in ("movie", "tv"):
        keys = [key for key in scores if key[0] == content_type]
        keys.sort(key=lambda key: scores[key], reverse=True)
        shortlist[content_type] = keys[:_RETURN_LIMIT * 2]
    candidates = _candidates(db, shortlist["movie"] + shortlist["tv"])

    picks: dict[str, list[Key]] = {}
    for content_type, keys in shortlist.items():
        shown = [key for key in keys if key in candidates]
        # Popularity only separates picks the library scores the same.
        shown.sort(
            key=lambda key: (round(scores[key], 3), candidates[key].popularity or 0.0),
            reverse=True,
        )
        picks[content_type] = shown[:_RETURN_LIMIT]

    all_picks = picks["movie"] + picks["tv"]
    titles = _seed_titles(db, {seed for key in all_picks for seed in because.get(key, [])})

    def items(keys: list[Key]) -> list[dict]:
        return [
            _serialize(candidates[key], [
                {"id": seed[1], "content_type": seed[0], "title": titles[seed]}
                for seed in because.get(key, [])
                if titles.get(seed)
            ])
            for key in keys
        ]

    return {
        "movies": items(picks["movie"]),
        "shows": items(picks["tv"]),
        "seed_count": len(seeds),
    }
