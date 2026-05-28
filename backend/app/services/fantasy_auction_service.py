"""Async slow auction draft. One open nomination per season at a time.
Round-robin nominations; players whose rosters are full are skipped.

Lifecycle:
  start_draft → nominate → bids land → expires_at lapses → close → next nominator
  When no player has open slots, the draft auto-completes and season → 'active'.
"""
import json
import logging
import random
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.fantasy import (
    FantasyAsset,
    FantasyDraftBid,
    FantasyDraftNomination,
    FantasyDraftPass,
    FantasyLeague,
    FantasyLeagueMember,
    FantasySeason,
)
from app.models.movie import Movie
from app.models.season import Season
from app.models.show import Show
from app.services.fantasy_auction_ws import emit as ws_emit
from app.services.media_upsert import (
    ensure_show_in_db,
    populate_movie_full,
    refresh_show_metadata,
)

logger = logging.getLogger(__name__)

VALID_CONTENT_TYPES = {"movie", "tv"}
VALID_SLOT_TYPES = {"movie", "tv", "flex", "bench"}
MIN_STARTING_BID = 1


def _as_utc(dt: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes even for DateTime(timezone=True) columns,
    while datetime.now(timezone.utc) is aware. Normalize to UTC for comparison."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ─── Authorization + lookup helpers ─────────────────────────────────────────


def _require_owner(
    db: Session, league_id: int, user_id: str
) -> tuple[FantasyLeague, FantasyLeagueMember]:
    league = db.get(FantasyLeague, league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found.")
    member = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == league_id,
            FantasyLeagueMember.user_id == user_id,
        )
        .first()
    )
    if not member or member.role != "owner":
        raise HTTPException(status_code=403, detail="Owner only.")
    return league, member


def _require_member(
    db: Session, league_id: int, user_id: str
) -> FantasyLeagueMember:
    member = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == league_id,
            FantasyLeagueMember.user_id == user_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="League not found.")
    return member


def _get_season(db: Session, league_id: int, season_id: int) -> FantasySeason:
    season = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.id == season_id, FantasySeason.league_id == league_id
        )
        .first()
    )
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")
    return season


def _verify_content_exists(db: Session, content_type: str, content_id: int) -> None:
    """Ensures the asset is in our local cache. Auto-populates from TMDb if
    missing — so a user can nominate any TMDb-known movie/show even if no one
    else in the league has tracked it before."""
    if content_type == "movie":
        if not db.query(Movie.id).filter(Movie.id == content_id).first():
            try:
                populate_movie_full(db, content_id)
            except Exception:
                pass
            if not db.query(Movie.id).filter(Movie.id == content_id).first():
                raise HTTPException(status_code=404, detail="Movie not found.")
    elif content_type == "tv":
        if not db.query(Show.id).filter(Show.id == content_id).first():
            try:
                ensure_show_in_db(db, content_id, already_tracked=True)
            except Exception:
                pass
            if not db.query(Show.id).filter(Show.id == content_id).first():
                raise HTTPException(status_code=404, detail="Show not found.")


def _show_eligible_season_info(
    db: Session, show_id: int, start, end
) -> dict | None:
    """Find an eligible season for `show_id` and return enriched info about
    it: premiere date, season number, episode count, end date (last episode's
    air date), and episodes remaining (episodes airing after today).

    Eligibility matches the validation logic: premieres in window, ends in
    window, spans the window, or is in-progress (started within 12 months,
    no end yet). Hits our cache first; falls back to TMDb."""
    from datetime import date as _date, timedelta

    from app.services.tmdb_tv import fetch_season_data_from_tmdb, fetch_show_from_tmdb

    def _parse(s):
        if not s:
            return None
        try:
            return _date.fromisoformat(s[:10])
        except (ValueError, TypeError):
            return None

    def _best_match(
        candidates: list[tuple[int | None, _date | None, _date | None]],
    ) -> tuple[int | None, _date | None]:
        """Pick the best season from (season_number, air_date, end_date) tuples.
        Premiere-in-window beats other categories."""
        best: tuple[int | None, _date | None] = (None, None)
        for season_num, air, endd in candidates:
            if not air:
                continue
            if start <= air <= end:
                return (season_num, air)  # premieres in window
            if endd and start <= endd <= end:
                best = best or (season_num, air)
                if not best[1]:
                    best = (season_num, air)
            elif endd and air <= start and endd >= end:
                if not best[1]:
                    best = (season_num, air)
            elif (
                endd is None
                and air <= end
                and air >= start - timedelta(days=365)
            ):
                if not best[1]:
                    best = (season_num, air)
        return best

    # Try cache first
    rows = (
        db.query(Season)
        .filter(Season.show_id == show_id, Season.air_date.isnot(None))
        .all()
    )
    sn, air = _best_match(
        [(s.season_number, s.air_date, s.end_date) for s in rows]
    )

    if not air:
        # Fall back to TMDb
        try:
            data = fetch_show_from_tmdb(show_id, "")
        except Exception:
            return None
        if not data:
            return None
        tmdb_candidates = [
            (s.get("season_number"), _parse(s.get("air_date")), None)
            for s in data.get("seasons", []) or []
            if (s.get("season_number") or 0) >= 1
        ]
        sn, air = _best_match(tmdb_candidates)
        if not air or sn is None:
            return None

    info: dict = {
        "air_date": air.isoformat(),
        "season_number": sn,
    }

    # Try to enrich with episode-level data so we can show end_date + remaining.
    # `fetch_season_data_from_tmdb` is TTL-cached so this is cheap on warm paths.
    if sn is not None:
        try:
            episodes = fetch_season_data_from_tmdb(show_id, sn)
        except Exception:
            episodes = []
        if episodes:
            air_dates = [_parse(e.get("air_date")) for e in episodes]
            air_dates = [d for d in air_dates if d is not None]
            if air_dates:
                today = _date.today()
                info["episode_count"] = len(air_dates)
                info["end_date"] = max(air_dates).isoformat()
                info["episodes_remaining"] = sum(1 for d in air_dates if d > today)

    return info


def suggest_eligible_assets(
    db: Session, viewer_id: str, league_id: int, season_id: int
) -> dict:
    """Curated default suggestions for the search picker — popular movies
    releasing in the window plus popular shows with a new season in the
    window. Excludes anything already on a roster in this league/season.
    Returns up to 5 of each."""
    from datetime import date as _date

    from app.services.tmdb_search import (
        get_movie_upcoming,
        get_tv_discover_in_window,
        get_tv_popular,
    )
    from app.services.tmdb_tv import fetch_show_from_tmdb

    _require_member(db, league_id, viewer_id)
    season = _get_season(db, league_id, season_id)
    start = season.starts_at.date()
    end = season.ends_at.date()

    rostered_movies = {
        cid
        for (cid,) in db.query(FantasyAsset.content_id)
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.content_type == "movie",
            FantasyAsset.dropped_at.is_(None),
        )
        .all()
    }
    rostered_shows = {
        cid
        for (cid,) in db.query(FantasyAsset.content_id)
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.content_type == "tv",
            FantasyAsset.dropped_at.is_(None),
        )
        .all()
    }

    movie_data = get_movie_upcoming(start.isoformat(), end.isoformat(), 1)
    movies: list[dict] = []
    for m in movie_data.get("results", []):
        mid = m.get("id")
        if not mid or mid in rostered_movies:
            continue
        rd_str = m.get("release_date")
        if not rd_str:
            continue
        try:
            rd = _date.fromisoformat(rd_str[:10])
        except ValueError:
            continue
        if not (start <= rd <= end):
            continue
        movies.append(
            {
                "id": mid,
                "title": m.get("title"),
                "poster_path": m.get("poster_path"),
                "release_date": rd.isoformat(),
                "overview": m.get("overview"),
            }
        )
        if len(movies) >= 10:
            break

    def _parse_date(s: str | None) -> _date | None:
        if not s:
            return None
        try:
            return _date.fromisoformat(s[:10])
        except (ValueError, TypeError):
            return None

    # Build candidate pool from multiple sources so we have enough to filter
    # down from. Discover-by-air-date is the most targeted (returns shows with
    # episodes in the window) but tops out at 20; fall back to general popular
    # for breadth.
    candidate_shows: list[dict] = []
    seen_ids: set[int] = set()
    for source in (
        get_tv_discover_in_window(start.isoformat(), end.isoformat(), 1),
        get_tv_popular(1).get("results", []),
        get_tv_popular(2).get("results", []),
    ):
        for s in source:
            sid = s.get("id")
            if not sid or sid in seen_ids:
                continue
            seen_ids.add(sid)
            candidate_shows.append(s)

    shows: list[dict] = []
    for s in candidate_shows:
        sid = s.get("id")
        if not sid or sid in rostered_shows:
            continue
        info = _show_eligible_season_info(db, sid, start, end)
        if not info:
            continue
        shows.append(
            {
                "id": sid,
                "name": s.get("name"),
                "poster_path": s.get("poster_path"),
                "first_air_date": s.get("first_air_date"),
                "eligible_air_date": info["air_date"],
                "season_number": info.get("season_number"),
                "season_end_date": info.get("end_date"),
                "episode_count": info.get("episode_count"),
                "episodes_remaining": info.get("episodes_remaining"),
                "overview": s.get("overview"),
            }
        )
        if len(shows) >= 10:
            break

    return {"movies": movies, "shows": shows}


def search_eligible_assets(
    db: Session, viewer_id: str, league_id: int, season_id: int, *, query: str
) -> dict:
    """Search TMDb for movies/shows that have content releasing during the
    season window. Movies are filtered by release_date. Shows are filtered by
    whether any season's air_date overlaps the window — fetched per-result
    from our cache (with TMDb fallback for uncached shows). Returns enriched
    results with the eligible release/air date for display."""
    from datetime import date as _date

    from app.services.tmdb_search import (
        get_movie_search_results,
        get_tv_search_results,
    )
    from app.services.tmdb_tv import fetch_show_from_tmdb

    _require_member(db, league_id, viewer_id)
    season = _get_season(db, league_id, season_id)
    start = season.starts_at.date()
    end = season.ends_at.date()

    raw_movies = get_movie_search_results(query)
    raw_shows = get_tv_search_results(query)

    eligible_movies: list[dict] = []
    for m in raw_movies[:15]:
        rd_str = m.get("release_date")
        if not rd_str:
            continue
        try:
            rd = _date.fromisoformat(rd_str[:10])
        except ValueError:
            continue
        if start <= rd <= end:
            eligible_movies.append(
                {
                    "id": m["id"],
                    "title": m.get("title"),
                    "poster_path": m.get("poster_path"),
                    "release_date": rd.isoformat(),
                    "overview": m.get("overview"),
                }
            )

    def _parse_date(s: str | None) -> _date | None:
        if not s:
            return None
        try:
            return _date.fromisoformat(s[:10])
        except (ValueError, TypeError):
            return None

    eligible_shows: list[dict] = []
    for s in raw_shows[:15]:
        sid = s.get("id")
        if not sid:
            continue
        info = _show_eligible_season_info(db, sid, start, end)
        if not info:
            continue
        eligible_shows.append(
            {
                "id": sid,
                "name": s.get("name"),
                "poster_path": s.get("poster_path"),
                "first_air_date": s.get("first_air_date"),
                "eligible_air_date": info["air_date"],
                "season_number": info.get("season_number"),
                "season_end_date": info.get("end_date"),
                "episode_count": info.get("episode_count"),
                "episodes_remaining": info.get("episodes_remaining"),
                "overview": s.get("overview"),
            }
        )

    return {"movies": eligible_movies, "shows": eligible_shows}


def _verify_content_in_season_window(
    db: Session, content_type: str, content_id: int, season: FantasySeason
) -> None:
    """Reject nominations for content that isn't releasing/airing inside the
    season window.

    Movies: must have `release_date` inside the window.

    Shows: we check each cached `Season` row for the show — eligible if any
    season's air_date OR end_date OR full date range overlaps the window. This
    correctly catches both new series and ongoing shows with a new season
    landing in the draft period. Falls back to show-level dates if the show
    has no cached per-season data."""
    start = season.starts_at.date()
    end = season.ends_at.date()

    if content_type == "movie":
        movie = db.query(Movie).filter(Movie.id == content_id).first()
        if not movie:
            return
        if not movie.release_date or not (start <= movie.release_date <= end):
            raise HTTPException(
                status_code=409,
                detail=f"Only movies releasing between {start} and {end} can be drafted.",
            )
        return

    if content_type == "tv":
        show = db.query(Show).filter(Show.id == content_id).first()
        if not show:
            return

        if _show_has_season_in_window(db, content_id, start, end):
            return

        # Cache miss — the show may have a newly-announced season we haven't
        # picked up yet (TMDb updates lag our cache). Force a refresh and
        # re-check before rejecting.
        try:
            refresh_show_metadata(db, content_id)
        except Exception as e:
            logger.warning(
                "Could not refresh show %s during eligibility check: %s",
                content_id,
                e,
            )

        if _show_has_season_in_window(db, content_id, start, end):
            return

        # Final fallback: show-level dates (less precise but accepts shows
        # without per-season data in TMDb).
        first = show.first_air_date
        last = show.last_air_date
        if (first and start <= first <= end) or (last and start <= last <= end):
            return

        raise HTTPException(
            status_code=409,
            detail=f"Only shows with a season airing between {start} and {end} can be drafted.",
        )


def _show_has_season_in_window(
    db: Session, show_id: int, start, end
) -> bool:
    """Returns True if any Season row for the show overlaps the window:
    - season's air_date is inside the window, OR
    - season's end_date is inside the window, OR
    - season spans the entire window (started before, ended after)."""
    # Flush so seasons just added by ensure_show_in_db (or refresh) earlier in
    # this transaction are visible. The session uses autoflush=False so
    # plain queries don't see pending adds without this.
    db.flush()

    seasons = (
        db.query(Season)
        .filter(Season.show_id == show_id, Season.air_date.isnot(None))
        .all()
    )
    for s in seasons:
        air = s.air_date
        endd = s.end_date
        if air and start <= air <= end:
            return True
        if endd and start <= endd <= end:
            return True
        if air and endd and air <= start and endd >= end:
            return True
        # In-progress season: started before window opened, no end yet.
        if air and endd is None and air <= end:
            # Only treat as eligible if season started "recently enough" to be
            # plausibly still airing during the window. Use 12 months as a
            # generous cutoff for ongoing series.
            from datetime import timedelta
            if air >= start - timedelta(days=365):
                return True
    return False


# ─── Roster slot accounting ────────────────────────────────────────────────


def _active_slot_counts(
    db: Session, league_id: int, season_id: int, user_id: str
) -> dict[str, int]:
    rows = (
        db.query(FantasyAsset.slot_type, func.count(FantasyAsset.id))
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.owner_user_id == user_id,
            FantasyAsset.dropped_at.is_(None),
        )
        .group_by(FantasyAsset.slot_type)
        .all()
    )
    return {slot: count for slot, count in rows}


def _open_slots(
    league: FantasyLeague,
    used: dict[str, int],
) -> dict[str, int]:
    return {
        "movie": max(0, league.roster_movie_slots - used.get("movie", 0)),
        "tv": max(0, league.roster_tv_slots - used.get("tv", 0)),
        "flex": max(0, league.roster_flex_slots - used.get("flex", 0)),
        "bench": max(0, league.bench_slots - used.get("bench", 0)),
    }


def _has_any_open_slot(
    db: Session, league: FantasyLeague, season_id: int, user_id: str
) -> bool:
    used = _active_slot_counts(db, league.id, season_id, user_id)
    return any(v > 0 for v in _open_slots(league, used).values())


def _eligible_slot_types(
    league: FantasyLeague, used: dict[str, int], content_type: str
) -> list[str]:
    """Which slot types can hold a new asset of the given content type, in
    preference order. Dedicated active slot first, then flex, then bench."""
    open_slots = _open_slots(league, used)
    out = []
    if content_type == "movie" and open_slots["movie"] > 0:
        out.append("movie")
    if content_type == "tv" and open_slots["tv"] > 0:
        out.append("tv")
    if open_slots["flex"] > 0:
        out.append("flex")
    if open_slots["bench"] > 0:
        out.append("bench")
    return out


# ─── Serializers ────────────────────────────────────────────────────────────


def _serialize_nomination(
    nomination: FantasyDraftNomination,
    bids: list[FantasyDraftBid] | None = None,
    passed_user_ids: list[str] | None = None,
) -> dict:
    out: dict = {
        "id": nomination.id,
        "league_id": nomination.league_id,
        "season_id": nomination.season_id,
        "nominator_user_id": nomination.nominator_user_id,
        "content_type": nomination.content_type,
        "content_id": nomination.content_id,
        "slot_type": nomination.slot_type,
        "current_high_bid": nomination.current_high_bid,
        "current_high_bidder_id": nomination.current_high_bidder_id,
        "starts_at": nomination.starts_at,
        "expires_at": nomination.expires_at,
        "closed_at": nomination.closed_at,
        "status": nomination.status,
        "resulting_asset_id": nomination.resulting_asset_id,
    }
    if bids is not None:
        out["bids"] = [
            {
                "id": b.id,
                "user_id": b.user_id,
                "amount": b.amount,
                "placed_at": b.placed_at,
            }
            for b in bids
        ]
    if passed_user_ids is not None:
        out["passed_user_ids"] = passed_user_ids
    return out


# ─── Turn order helpers ─────────────────────────────────────────────────────


def _load_order(season: FantasySeason) -> list[str]:
    if not season.nomination_order:
        return []
    try:
        order = json.loads(season.nomination_order)
        if not isinstance(order, list):
            return []
        return [str(x) for x in order]
    except (TypeError, ValueError):
        return []


def _current_nominator_id(season: FantasySeason) -> str | None:
    order = _load_order(season)
    if not order:
        return None
    return order[season.next_nominator_index % len(order)]


def _advance_turn(
    db: Session, league: FantasyLeague, season: FantasySeason
) -> str | None:
    """Move the cursor to the next nominator who has an open roster slot. If
    nobody has open slots, completes the draft and returns None."""
    order = _load_order(season)
    if not order:
        return None

    for _ in range(len(order)):
        season.next_nominator_index = (season.next_nominator_index + 1) % len(order)
        candidate = order[season.next_nominator_index]
        if _has_any_open_slot(db, league, season.id, candidate):
            season.nomination_deadline = datetime.now(timezone.utc) + timedelta(
                seconds=league.draft_nomination_window_seconds
            )
            return candidate

    # No one has open slots — draft is done. Season transitions to "active"
    # so the scoring runner picks it up; members keep their leftover draft
    # budget as their initial season budget (waiver allowances add to it).
    season.status = "active"
    season.nomination_deadline = None
    return None


# ─── Draft lifecycle ────────────────────────────────────────────────────────


def start_draft(
    db: Session,
    user_id: str,
    league_id: int,
    season_id: int,
    *,
    member_order: list[str] | None = None,
) -> dict:
    """Owner kicks off the draft. If member_order is provided, it must contain
    exactly the league's current members. Otherwise members are shuffled."""
    league, _ = _require_owner(db, league_id, user_id)
    season = _get_season(db, league_id, season_id)
    if season.status != "upcoming":
        raise HTTPException(
            status_code=409, detail=f"Cannot start draft from status '{season.status}'."
        )

    members = (
        db.query(FantasyLeagueMember.user_id)
        .filter(FantasyLeagueMember.league_id == league_id)
        .all()
    )
    member_ids = [m.user_id for m in members]
    if not member_ids:
        raise HTTPException(status_code=409, detail="League has no members.")

    if member_order is not None:
        if sorted(member_order) != sorted(member_ids):
            raise HTTPException(
                status_code=422,
                detail="member_order must list exactly the league's current members.",
            )
        order = list(member_order)
    else:
        order = list(member_ids)
        random.shuffle(order)

    season.nomination_order = json.dumps(order)
    season.next_nominator_index = 0
    season.status = "draft"
    season.nomination_deadline = datetime.now(timezone.utc) + timedelta(
        seconds=league.draft_nomination_window_seconds
    )
    db.commit()
    db.refresh(season)
    ws_emit(league_id, season_id, "draft_started")
    return get_draft_state(db, user_id, league_id, season_id)


def nominate(
    db: Session,
    user_id: str,
    league_id: int,
    season_id: int,
    *,
    content_type: str,
    content_id: int,
    starting_bid: int,
    slot_type: str | None = None,
) -> dict:
    member = _require_member(db, league_id, user_id)
    league = db.get(FantasyLeague, league_id)
    season = _get_season(db, league_id, season_id)

    if season.status != "draft":
        raise HTTPException(status_code=409, detail="Draft is not active.")

    if _current_nominator_id(season) != user_id:
        raise HTTPException(status_code=403, detail="Not your turn to nominate.")

    open_nomination = (
        db.query(FantasyDraftNomination)
        .filter(
            FantasyDraftNomination.season_id == season_id,
            FantasyDraftNomination.status == "open",
        )
        .first()
    )
    if open_nomination:
        raise HTTPException(
            status_code=409, detail="A nomination is already open."
        )

    if content_type not in VALID_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail="Invalid content_type.")
    if starting_bid < MIN_STARTING_BID:
        raise HTTPException(
            status_code=422, detail=f"starting_bid must be >= {MIN_STARTING_BID}."
        )
    if starting_bid > member.budget_remaining:
        raise HTTPException(
            status_code=409, detail="You don't have budget for that starting bid."
        )

    _verify_content_exists(db, content_type, content_id)
    _verify_content_in_season_window(db, content_type, content_id, season)

    already_rostered = (
        db.query(FantasyAsset)
        .filter(
            FantasyAsset.league_id == league_id,
            FantasyAsset.season_id == season_id,
            FantasyAsset.content_type == content_type,
            FantasyAsset.content_id == content_id,
            FantasyAsset.dropped_at.is_(None),
        )
        .first()
    )
    if already_rostered:
        raise HTTPException(
            status_code=409,
            detail="That asset is already on a roster in this season.",
        )

    used = _active_slot_counts(db, league_id, season_id, user_id)
    eligible = _eligible_slot_types(league, used, content_type)
    if not eligible:
        raise HTTPException(
            status_code=409, detail="You have no open slot for that content type."
        )
    if slot_type is not None:
        if slot_type not in eligible:
            raise HTTPException(
                status_code=409,
                detail=f"slot_type must be one of {eligible} given your open slots.",
            )
        chosen_slot = slot_type
    else:
        # Prefer the dedicated slot before burning a flex.
        chosen_slot = eligible[0]

    now = datetime.now(timezone.utc)
    nomination = FantasyDraftNomination(
        league_id=league_id,
        season_id=season_id,
        nominator_user_id=user_id,
        content_type=content_type,
        content_id=content_id,
        slot_type=chosen_slot,
        current_high_bid=starting_bid,
        current_high_bidder_id=user_id,
        expires_at=now + timedelta(seconds=league.draft_bid_window_seconds),
        status="open",
    )
    db.add(nomination)
    db.flush()
    db.add(
        FantasyDraftBid(
            nomination_id=nomination.id, user_id=user_id, amount=starting_bid
        )
    )
    db.commit()
    db.refresh(nomination)
    ws_emit(
        league_id,
        season_id,
        "nomination_opened",
        {"nomination_id": nomination.id},
    )

    # If the nominator is already the only viable bidder (everyone else lacks
    # slots/budget), close immediately at the starting bid.
    if _everyone_else_passed(db, nomination):
        try:
            _close_one(db, nomination)
        except Exception as e:
            logger.error("auto-close after nominate failed: %s", e)
            db.rollback()

    return _serialize_nomination(nomination)


def place_bid(
    db: Session, user_id: str, league_id: int, nomination_id: int, amount: int
) -> dict:
    member = _require_member(db, league_id, user_id)
    nomination = db.get(FantasyDraftNomination, nomination_id)
    if not nomination or nomination.league_id != league_id:
        raise HTTPException(status_code=404, detail="Nomination not found.")
    if nomination.status != "open":
        raise HTTPException(status_code=409, detail="Nomination is closed.")

    now = datetime.now(timezone.utc)
    expires_at = _as_utc(nomination.expires_at)
    if expires_at <= now:
        raise HTTPException(status_code=409, detail="Bid window has expired.")

    if amount <= nomination.current_high_bid:
        raise HTTPException(
            status_code=409,
            detail=f"Bid must exceed current high bid of {nomination.current_high_bid}.",
        )
    if amount > member.budget_remaining:
        raise HTTPException(status_code=409, detail="Insufficient budget.")

    league = db.get(FantasyLeague, league_id)

    # Bidder must have an open slot that can hold this content type. A TV
    # nomination needs an open `tv` or `flex` slot; a movie needs `movie` or
    # `flex`. Otherwise winning is impossible.
    used = _active_slot_counts(db, league_id, nomination.season_id, user_id)
    if not _eligible_slot_types(league, used, nomination.content_type):
        raise HTTPException(
            status_code=409,
            detail=(
                f"You have no open {nomination.content_type} or flex slot "
                "for this asset."
            ),
        )

    nomination.current_high_bid = amount
    nomination.current_high_bidder_id = user_id

    # Snipe protection: if bid lands inside the extension window, push expiry out.
    extension = timedelta(seconds=league.draft_extension_seconds)
    if expires_at - now < extension:
        nomination.expires_at = now + extension

    db.add(
        FantasyDraftBid(
            nomination_id=nomination.id, user_id=user_id, amount=amount
        )
    )
    db.commit()
    db.refresh(nomination)
    ws_emit(
        nomination.league_id,
        nomination.season_id,
        "bid_placed",
        {
            "nomination_id": nomination.id,
            "amount": amount,
            "bidder_id": user_id,
            "expires_at": nomination.expires_at.isoformat(),
        },
    )

    # If this bid put every other member out of contention (no budget for the
    # next bid, no eligible slot, or already passed), close immediately. This
    # is ESPN-style behavior: when there's only one viable bidder left, the
    # auction ends.
    if _everyone_else_passed(db, nomination):
        try:
            _close_one(db, nomination)
        except Exception as e:
            logger.error("auto-close after bid failed: %s", e)
            db.rollback()

    return _serialize_nomination(nomination)


def pass_on_nomination(
    db: Session, user_id: str, league_id: int, nomination_id: int
) -> dict:
    """Record that this user is out of bidding on the current nomination.
    If every non-high-bidder has now passed, close the nomination immediately."""
    member = _require_member(db, league_id, user_id)  # noqa: F841 — auth check

    nomination = db.get(FantasyDraftNomination, nomination_id)
    if not nomination or nomination.league_id != league_id:
        raise HTTPException(status_code=404, detail="Nomination not found.")
    if nomination.status != "open":
        raise HTTPException(status_code=409, detail="Nomination is closed.")
    if nomination.current_high_bidder_id == user_id:
        raise HTTPException(
            status_code=409, detail="You're the high bidder — you can't pass."
        )

    existing = (
        db.query(FantasyDraftPass)
        .filter(
            FantasyDraftPass.nomination_id == nomination_id,
            FantasyDraftPass.user_id == user_id,
        )
        .first()
    )
    if existing:
        # Already passed — idempotent, just check auto-close.
        pass_row = existing
    else:
        pass_row = FantasyDraftPass(nomination_id=nomination_id, user_id=user_id)
        db.add(pass_row)
        db.commit()
        db.refresh(pass_row)

    ws_emit(
        nomination.league_id,
        nomination.season_id,
        "bid_passed",
        {"nomination_id": nomination.id, "user_id": user_id},
    )

    # Check if everyone except the high bidder has passed → auto-close.
    if _everyone_else_passed(db, nomination):
        try:
            _close_one(db, nomination)
        except Exception as e:
            logger.error("auto-close after pass failed: %s", e)
            db.rollback()

    return {
        "id": pass_row.id,
        "nomination_id": pass_row.nomination_id,
        "user_id": pass_row.user_id,
        "passed_at": pass_row.passed_at,
    }


def _everyone_else_passed(
    db: Session, nomination: FantasyDraftNomination
) -> bool:
    """True iff every league member other than the high bidder has either
    passed on this nomination OR has no roster slot that could accept it."""
    league = db.get(FantasyLeague, nomination.league_id)
    if not league:
        return False
    members = (
        db.query(FantasyLeagueMember)
        .filter(FantasyLeagueMember.league_id == nomination.league_id)
        .all()
    )
    passed_ids = {
        p.user_id
        for p in db.query(FantasyDraftPass)
        .filter(FantasyDraftPass.nomination_id == nomination.id)
        .all()
    }
    for m in members:
        if m.user_id == nomination.current_high_bidder_id:
            continue
        if m.user_id in passed_ids:
            continue
        # Hasn't passed — check if they could even bid (slot + budget).
        used = _active_slot_counts(db, nomination.league_id, nomination.season_id, m.user_id)
        eligible = _eligible_slot_types(league, used, nomination.content_type)
        next_bid_amount = nomination.current_high_bid + 1
        if eligible and m.budget_remaining >= next_bid_amount:
            return False  # at least one viable bidder remains
    return True


def close_uncontested_nominations(db: Session) -> int:
    """Sweep open nominations and close any where every member except the
    high bidder is already out of contention (passed, no eligible slot, or
    not enough budget to outbid). Catches the gap where the in-line bid/pass
    triggers missed — e.g. members were depleted by earlier auctions and the
    high bidder didn't realize they were uncontested."""
    nominations = (
        db.query(FantasyDraftNomination)
        .filter(FantasyDraftNomination.status == "open")
        .all()
    )
    closed = 0
    for nomination in nominations:
        try:
            if _everyone_else_passed(db, nomination):
                _close_one(db, nomination)
                closed += 1
        except Exception as e:
            logger.error(
                "uncontested close failed for nomination %s: %s",
                nomination.id,
                e,
            )
            db.rollback()
    return closed


def close_expired_nominations(db: Session) -> int:
    """Background-task entry point. For every expired open nomination across
    all leagues: assign the asset to the high bidder, deduct their bid,
    advance the season's nomination cursor."""
    now = datetime.now(timezone.utc)
    expired = (
        db.query(FantasyDraftNomination)
        .filter(
            FantasyDraftNomination.status == "open",
            FantasyDraftNomination.expires_at <= now,
        )
        .all()
    )

    closed = 0
    for nomination in expired:
        try:
            _close_one(db, nomination)
            closed += 1
        except Exception as e:
            logger.error(
                "auction close failed for nomination %s: %s", nomination.id, e
            )
            db.rollback()
    return closed


def _close_one(db: Session, nomination: FantasyDraftNomination) -> None:
    league = db.get(FantasyLeague, nomination.league_id)
    season = db.get(FantasySeason, nomination.season_id)
    if not league or not season:
        nomination.status = "cancelled"
        nomination.closed_at = datetime.now(timezone.utc)
        db.commit()
        return

    winner = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == nomination.league_id,
            FantasyLeagueMember.user_id == nomination.current_high_bidder_id,
        )
        .first()
    )
    now = datetime.now(timezone.utc)

    if not winner or winner.budget_remaining < nomination.current_high_bid:
        # Edge case: winner lost membership or budget. Cancel the nomination.
        nomination.status = "cancelled"
        nomination.closed_at = now
        db.commit()
        return

    # Pick the slot for the winner: prefer their dedicated slot (movie/tv) if
    # open, else fall back to flex. The nomination's slot_type was set by the
    # nominator from their roster shape and may not match the winner's.
    winner_used = _active_slot_counts(
        db, nomination.league_id, nomination.season_id, winner.user_id
    )
    winner_eligible = _eligible_slot_types(
        league, winner_used, nomination.content_type
    )
    if not winner_eligible:
        nomination.status = "cancelled"
        nomination.closed_at = now
        db.commit()
        return
    chosen_slot = winner_eligible[0]

    winner.budget_remaining -= nomination.current_high_bid
    asset = FantasyAsset(
        league_id=nomination.league_id,
        season_id=nomination.season_id,
        owner_user_id=winner.user_id,
        content_type=nomination.content_type,
        content_id=nomination.content_id,
        auction_price=nomination.current_high_bid,
        slot_type=chosen_slot,
    )
    db.add(asset)
    db.flush()

    nomination.status = "closed"
    nomination.closed_at = now
    nomination.resulting_asset_id = asset.id

    _advance_turn(db, league, season)
    db.commit()
    ws_emit(
        nomination.league_id,
        nomination.season_id,
        "nomination_closed",
        {
            "nomination_id": nomination.id,
            "winner_id": winner.user_id,
            "winning_bid": nomination.current_high_bid,
            "asset_id": asset.id,
            "draft_complete": season.status == "complete",
        },
    )


def skip_current_nominator(
    db: Session, user_id: str, league_id: int, season_id: int
) -> dict:
    """Skip the current nominator's turn. Allowed for the nominator themselves
    (pass) or the league owner (force-skip a stuck player)."""
    league, _ = _require_owner_or_self_skip(db, league_id, user_id, season_id)
    season = _get_season(db, league_id, season_id)
    if season.status != "draft":
        raise HTTPException(status_code=409, detail="Draft is not active.")

    open_nomination = (
        db.query(FantasyDraftNomination)
        .filter(
            FantasyDraftNomination.season_id == season_id,
            FantasyDraftNomination.status == "open",
        )
        .first()
    )
    if open_nomination:
        raise HTTPException(
            status_code=409, detail="Close the open nomination before skipping."
        )

    _advance_turn(db, league, season)
    db.commit()
    db.refresh(season)
    return get_draft_state(db, user_id, league_id, season_id)


def _require_owner_or_self_skip(
    db: Session, league_id: int, user_id: str, season_id: int
) -> tuple[FantasyLeague, FantasyLeagueMember]:
    league = db.get(FantasyLeague, league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found.")
    member = (
        db.query(FantasyLeagueMember)
        .filter(
            FantasyLeagueMember.league_id == league_id,
            FantasyLeagueMember.user_id == user_id,
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="League not found.")
    season = db.get(FantasySeason, season_id)
    if not season:
        raise HTTPException(status_code=404, detail="Season not found.")
    if member.role == "owner":
        return league, member
    if _current_nominator_id(season) == user_id:
        return league, member
    raise HTTPException(
        status_code=403, detail="Only the current nominator or owner can skip."
    )


def mark_finished_seasons(db: Session) -> int:
    """Transition any 'active' seasons whose ends_at has passed to 'complete'.
    Called from the auction loop on the same cadence as other sweeps."""
    now = datetime.now(timezone.utc)
    rows = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.status == "active",
            FantasySeason.ends_at <= now,
        )
        .all()
    )
    for s in rows:
        s.status = "complete"
    if rows:
        db.commit()
    return len(rows)


def advance_stale_turns(db: Session) -> int:
    """Background task: if the current nominator hasn't opened a nomination
    by season.nomination_deadline, skip them automatically."""
    now = datetime.now(timezone.utc)
    seasons = (
        db.query(FantasySeason)
        .filter(
            FantasySeason.status == "draft",
            FantasySeason.nomination_deadline.isnot(None),
            FantasySeason.nomination_deadline <= now,
        )
        .all()
    )
    advanced = 0
    for season in seasons:
        league = db.get(FantasyLeague, season.league_id)
        if not league:
            continue
        # Don't auto-advance while a nomination is still open.
        open_n = (
            db.query(FantasyDraftNomination)
            .filter(
                FantasyDraftNomination.season_id == season.id,
                FantasyDraftNomination.status == "open",
            )
            .first()
        )
        if open_n:
            continue
        _advance_turn(db, league, season)
        db.commit()
        advanced += 1
    return advanced


def complete_draft(
    db: Session, user_id: str, league_id: int, season_id: int
) -> dict:
    """Owner force-completes a draft (e.g. everyone agreed to stop early).
    Members keep their leftover budget — the scoring runner takes over and
    weekly allowances add to whatever's remaining."""
    _require_owner(db, league_id, user_id)
    season = _get_season(db, league_id, season_id)
    if season.status != "draft":
        raise HTTPException(status_code=409, detail="Draft is not active.")
    open_n = (
        db.query(FantasyDraftNomination)
        .filter(
            FantasyDraftNomination.season_id == season_id,
            FantasyDraftNomination.status == "open",
        )
        .first()
    )
    if open_n:
        raise HTTPException(
            status_code=409, detail="Close the open nomination first."
        )
    season.status = "active"
    season.nomination_deadline = None
    db.commit()
    db.refresh(season)
    return get_draft_state(db, user_id, league_id, season_id)


# ─── Read endpoints ─────────────────────────────────────────────────────────


def get_draft_state(
    db: Session, viewer_id: str, league_id: int, season_id: int
) -> dict:
    _require_member(db, league_id, viewer_id)
    league = db.get(FantasyLeague, league_id)
    season = _get_season(db, league_id, season_id)

    open_nomination = (
        db.query(FantasyDraftNomination)
        .filter(
            FantasyDraftNomination.season_id == season_id,
            FantasyDraftNomination.status == "open",
        )
        .first()
    )
    bids = []
    passed_user_ids: list[str] = []
    if open_nomination:
        bids = (
            db.query(FantasyDraftBid)
            .filter(FantasyDraftBid.nomination_id == open_nomination.id)
            .order_by(FantasyDraftBid.placed_at.desc())
            .all()
        )
        passed_user_ids = [
            p.user_id
            for p in db.query(FantasyDraftPass)
            .filter(FantasyDraftPass.nomination_id == open_nomination.id)
            .all()
        ]

    members = (
        db.query(FantasyLeagueMember)
        .filter(FantasyLeagueMember.league_id == league_id)
        .all()
    )
    member_state = []
    for m in members:
        used = _active_slot_counts(db, league_id, season_id, m.user_id)
        member_state.append(
            {
                "user_id": m.user_id,
                "budget_remaining": m.budget_remaining,
                "open_slots": _open_slots(league, used),
                "filled_slots": used,
            }
        )

    return {
        "season_id": season.id,
        "status": season.status,
        "nomination_order": _load_order(season),
        "next_nominator_index": season.next_nominator_index,
        "current_nominator_user_id": _current_nominator_id(season)
        if season.status == "draft"
        else None,
        "nomination_deadline": season.nomination_deadline,
        "current_nomination": _serialize_nomination(
            open_nomination, bids, passed_user_ids
        )
        if open_nomination
        else None,
        "members": member_state,
    }


def list_nominations(
    db: Session,
    viewer_id: str,
    league_id: int,
    season_id: int,
    *,
    status: str | None = None,
) -> list[dict]:
    _require_member(db, league_id, viewer_id)
    q = db.query(FantasyDraftNomination).filter(
        FantasyDraftNomination.league_id == league_id,
        FantasyDraftNomination.season_id == season_id,
    )
    if status:
        q = q.filter(FantasyDraftNomination.status == status)
    rows = q.order_by(FantasyDraftNomination.starts_at.desc()).all()
    return [_serialize_nomination(n) for n in rows]


def get_nomination(
    db: Session, viewer_id: str, league_id: int, nomination_id: int
) -> dict:
    _require_member(db, league_id, viewer_id)
    nomination = db.get(FantasyDraftNomination, nomination_id)
    if not nomination or nomination.league_id != league_id:
        raise HTTPException(status_code=404, detail="Nomination not found.")
    bids = (
        db.query(FantasyDraftBid)
        .filter(FantasyDraftBid.nomination_id == nomination_id)
        .order_by(FantasyDraftBid.placed_at.desc())
        .all()
    )
    return _serialize_nomination(nomination, bids)
