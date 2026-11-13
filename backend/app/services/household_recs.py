"""
Recommendations for a household, built from what its members share: titles
two or more of them have watched or are watching, titles on more than one
person's lists, and the household's Watch together list. Each member's solo
library counts too, but only lightly, so a household with little in common
still gets picks. Anything already on someone's lists (or the shared one) is
left out.

Reuses For You's machinery: each title's stored recommendation list
(title_recs), the same seed weights, and the same display rows.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.household import HouseholdItem
from app.models.title_recs import TitleRecs
from app.services.for_you_service import (
    _candidates,
    _library,
    _seed_titles,
    _serialize,
)
from app.services.household_service import _member_ids, _membership
from app.services.title_recs_service import ORIGIN_TMDB, Key, fetch_and_store

logger = logging.getLogger(__name__)

SHARED_BONUS = 2.0      # a title two of you have counts double, on top of both weights
SOLO_FACTOR = 0.25      # one person's title still counts, a little
SHARED_LIST_WEIGHT = 1.0
RETURN_LIMIT = 20       # per type
MISSING_LIMIT = 20      # titles without a stored list fetched after a response
BECAUSE_LIMIT = 2

REASON_WATCHED = "watched"   # two or more of you watched it / are watching it
REASON_LISTS = "lists"       # on the shared list, or on more than one person's lists


def household_recommendations(
    db: Session, uid: str, hid: int, only: list[str] | None = None
) -> dict:
    _membership(db, hid, uid)
    now = datetime.now(timezone.utc)
    # only: just the members watching tonight (household picks).
    uids = [m for m in _member_ids(db, hid) if only is None or m in only]

    holders: dict[Key, list[Seed]] = defaultdict(list)
    lists: dict[Key, list[Key]] = {}
    for member in uids:
        seeds, member_lists = _library(db, member, now)
        lists.update(member_lists)
        for key, seed in seeds.items():
            holders[key].append(seed)

    shared_list: set[Key] = {
        (ct, cid) for ct, cid in db.query(HouseholdItem.content_type, HouseholdItem.content_id)
        .filter(HouseholdItem.household_id == hid)
    }

    weights: dict[Key, float] = {}
    reasons: dict[Key, str] = {}
    for key, member_seeds in holders.items():
        total = sum(s.weight for s in member_seeds)
        if len(member_seeds) >= 2:
            weights[key] = total * SHARED_BONUS
            seen = sum(1 for s in member_seeds if s.seen)
            reasons[key] = REASON_WATCHED if seen >= 2 else REASON_LISTS
        else:
            weights[key] = total * SOLO_FACTOR
    for key in shared_list:
        weights[key] = weights.get(key, 0.0) + SHARED_LIST_WEIGHT
        reasons.setdefault(key, REASON_LISTS)

    if not weights:
        return {"movies": [], "shows": [], "shared_count": 0, "missing": []}

    # Shared-list titles nobody has on their own lists have no list loaded yet.
    extra = [k for k in shared_list if k not in lists]
    if extra:
        for ct, cid, recs in db.query(TitleRecs.content_type, TitleRecs.content_id, TitleRecs.recs).filter(
            TitleRecs.origin == ORIGIN_TMDB,
            or_(*[and_(TitleRecs.content_type == ct, TitleRecs.content_id == cid) for ct, cid in extra]),
        ):
            if recs is not None:
                lists[(ct, cid)] = [(rt, rid) for rt, rid in recs]
    # Titles with no stored list don't hold the page up: the caller fetches
    # the heaviest few after responding, so the next load has them.
    missing = sorted(
        (k for k, w in weights.items() if w > 0 and k not in lists),
        key=lambda k: weights[k],
        reverse=True,
    )[:MISSING_LIMIT]

    exclude = set(holders) | shared_list
    scores: dict[Key, float] = defaultdict(float)
    parts: dict[Key, list[tuple[float, Key]]] = defaultdict(list)
    for key, recs in lists.items():
        weight = weights.get(key, 0.0)
        if weight <= 0 or not recs:
            continue
        for position, rec in enumerate(recs):
            if rec in exclude:
                continue
            part = weight * (1 - 0.5 * position / len(recs))
            scores[rec] += part
            if key in reasons:  # only shared titles are named as the reason
                parts[rec].append((part, key))
    because = {
        rec: [key for _, key in sorted(p, reverse=True)[:BECAUSE_LIMIT]]
        for rec, p in parts.items()
    }

    shortlist: dict[str, list[Key]] = {}
    for content_type in ("movie", "tv"):
        keys = sorted((k for k in scores if k[0] == content_type), key=lambda k: scores[k], reverse=True)
        shortlist[content_type] = keys[:RETURN_LIMIT * 2]
    candidates = _candidates(db, shortlist["movie"] + shortlist["tv"])
    picks = {
        ct: sorted(
            (k for k in keys if k in candidates),
            key=lambda k: (round(scores[k], 3), candidates[k].popularity or 0.0),
            reverse=True,
        )[:RETURN_LIMIT]
        for ct, keys in shortlist.items()
    }
    titles = _seed_titles(db, {s for k in picks["movie"] + picks["tv"] for s in because.get(k, [])})

    def items(keys: list[Key]) -> list[dict]:
        return [
            _serialize(candidates[k], [
                {"id": s[1], "content_type": s[0], "title": titles[s], "reason": reasons[s]}
                for s in because.get(k, [])
                if titles.get(s)
            ])
            for k in keys
        ]

    return {
        "movies": items(picks["movie"]),
        "shows": items(picks["tv"]),
        # How many titles the household shares: 0 means picks come only
        # from each person's own library.
        "shared_count": len(reasons),
        # Popped by the routes and fetched in the background.
        "missing": missing,
    }


def fetch_missing_lists_bg(keys: list[Key]) -> None:
    """Fetch and store recommendation lists after a response has gone out.
    Opens its own session; failures only mean the next load waits for the
    hourly refresh instead."""
    if not keys:
        return
    db = SessionLocal()
    try:
        fetch_and_store(db, keys, datetime.now(timezone.utc), timeout=10.0)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("household recs: background fetch of %d lists failed", len(keys))
    finally:
        db.close()
