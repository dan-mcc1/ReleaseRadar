"""Deletes cached Show/Movie rows that nobody uses any more.

A title is pruned only when nothing has touched it for 90 days AND no row
anywhere references it: a list entry, an episode log, a rating, a shelf item,
an inbox notification, a collection membership, and so on.

The previous rule trusted Show/Movie.tracking_count. That counter drifts low
(imports and shelves skip the increment, concurrent adds lose one), and the
FK cascades on show.id then deleted users' episode_watched, season_rating and
finish_by_goal rows. tracking_count is not consulted here.

Every table with a content_id / show_id / movie_id column must appear either
in REFERENCES or in CACHE_CHILD_TABLES; tests/test_cache_prune.py enforces it
so a new table can't silently stop protecting its title.
"""

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy import and_, exists, func, not_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.models.activity import Activity
from app.models.collection import CollectionMovie
from app.models.community import CommunityMedia
from app.models.currently_watching import CurrentlyWatching
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.favorite import Favorite
from app.models.finish_by_goal import FinishByGoal
from app.models.genre import MovieGenre, ShowGenre
from app.models.movie import Movie
from app.models.movie_video import MovieVideo
from app.models.notification import Notification
from app.models.provider import MovieProvider, ShowProvider
from app.models.recommendation import Recommendation
from app.models.review import Review
from app.models.rewatch import Rewatch
from app.models.season import Season
from app.models.season_rating import SeasonRating
from app.models.sent_episode_alert import SentEpisodeAlert
from app.models.sent_premiere_alert import SentPremiereAlert
from app.models.shelf_item import ShelfItem
from app.models.show import Show
from app.models.show_video import ShowVideo
from app.models.user import User
from app.models.user_collection_ranking import UserCollectionRanking
from app.models.watched import Watched
from app.models.watchlist import Watchlist

logger = logging.getLogger(__name__)

PRUNE_AFTER = timedelta(days=90)
_DELETE_BATCH = 500

# Cached TMDb data that hangs off a title and is deleted with it, in delete
# order, plus bookkeeping that only means something while the title exists
# (sent premiere alerts: they mustn't keep a show nobody tracks cached).
# Deleted explicitly: production's foreign keys predate Alembic and don't
# all have ON DELETE CASCADE (episode.show_id doesn't).
_CHILDREN: dict[str, tuple[tuple[type, str], ...]] = {
    "tv": (
        (SentPremiereAlert, "show_id"),
        (ShowGenre, "show_id"),
        (ShowProvider, "show_id"),
        (ShowVideo, "show_id"),
        (Episode, "show_id"),
        (Season, "show_id"),
    ),
    "movie": (
        (MovieGenre, "movie_id"),
        (MovieProvider, "movie_id"),
        (MovieVideo, "movie_id"),
    ),
}
CACHE_CHILD_TABLES = frozenset(
    model.__tablename__ for children in _CHILDREN.values() for model, _ in children
)


@dataclass(frozen=True)
class Reference:
    model: type
    label: str
    id_column: str = "content_id"
    # Who the row belongs to, for the review report. None = not user data.
    user_column: str | None = "user_id"
    # Rows carry a content_type column that must match the title's kind.
    typed: bool = True


_SHARED = (
    Reference(Watchlist, "watchlist"),
    Reference(CurrentlyWatching, "currently watching"),
    Reference(Watched, "watched"),
    Reference(Favorite, "favorite"),
    Reference(Review, "review"),
    Reference(Rewatch, "rewatches"),
    Reference(ShelfItem, "shelf items"),
    Reference(Recommendation, "recommendations received", user_column="recipient_id"),
    Reference(Activity, "activity feed"),
    Reference(Notification, "inbox notifications"),
    Reference(CommunityMedia, "group media", user_column="added_by"),
)

REFERENCES: dict[str, tuple[Reference, ...]] = {
    "tv": _SHARED + (
        Reference(EpisodeWatched, "episodes logged", id_column="show_id", typed=False),
        Reference(SeasonRating, "season ratings", id_column="show_id", typed=False),
        Reference(FinishByGoal, "finish-by goal", id_column="show_id", typed=False),
    ),
    "movie": _SHARED + (
        Reference(
            CollectionMovie, "collection part",
            id_column="movie_id", user_column=None, typed=False,
        ),
        Reference(
            UserCollectionRanking, "collection rankings",
            id_column="movie_id", typed=False,
        ),
    ),
}

_TITLE_MODELS = {"tv": Show, "movie": Movie}


def reference_tables(kind: str | None = None) -> set[str]:
    kinds = [kind] if kind else list(REFERENCES)
    return {ref.model.__tablename__ for k in kinds for ref in REFERENCES[k]}


def _title_column(model):
    return model.name if model is Show else model.title


def _matches(ref: Reference, kind: str, title_id):
    cond = getattr(ref.model, ref.id_column) == title_id
    if ref.typed:
        cond = and_(cond, ref.model.content_type == kind)
    return cond


def _unreferenced(kind: str, title_id):
    # ANDed NOT EXISTS (rather than NOT (EXISTS OR ...)) so Postgres can plan
    # each one as an anti-join instead of a per-row subquery.
    return and_(*(~exists().where(_matches(ref, kind, title_id)) for ref in REFERENCES[kind]))


def _prunable(kind: str, cutoff: datetime):
    """Stale and unreferenced. NULL updated_at (an unpopulated stub) never matches."""
    model = _TITLE_MODELS[kind]
    return and_(model.updated_at < cutoff, _unreferenced(kind, model.id))


def _cutoff(now: datetime | None) -> datetime:
    return (now or datetime.now(timezone.utc)) - PRUNE_AFTER


def _delete_titles(db: Session, kind: str, ids: list[int]) -> None:
    """Delete titles and their cached child rows. Caller commits."""
    if kind == "tv":
        # Dedupe log of pushed episode alerts; not user data.
        episode_ids = select(Episode.id).where(Episode.show_id.in_(ids))
        db.query(SentEpisodeAlert).filter(
            SentEpisodeAlert.episode_id.in_(episode_ids)
        ).delete(synchronize_session=False)
    for child, column in _CHILDREN[kind]:
        db.query(child).filter(getattr(child, column).in_(ids)).delete(
            synchronize_session=False
        )
    model = _TITLE_MODELS[kind]
    db.query(model).filter(model.id.in_(ids)).delete(synchronize_session=False)


def _delete_prunable(db: Session, kind: str, ids: list[int], cutoff: datetime) -> list[int]:
    """Delete the ids that are still prunable right now; return the ones deleted.

    The rule is re-checked just before deleting, so a title that gained a
    reference since it was selected survives. If the database refuses a batch
    (a foreign key the models don't know about), each title is retried on its
    own and the refused ones are kept, so one title can't stop the run."""
    model = _TITLE_MODELS[kind]
    deleted: list[int] = []
    for start in range(0, len(ids), _DELETE_BATCH):
        batch = ids[start:start + _DELETE_BATCH]
        eligible = [
            row_id for (row_id,) in
            db.query(model.id).filter(model.id.in_(batch), _prunable(kind, cutoff))
        ]
        if not eligible:
            continue
        try:
            _delete_titles(db, kind, eligible)
            db.commit()
            deleted.extend(eligible)
            continue
        except IntegrityError:
            db.rollback()
        for title_id in eligible:
            try:
                _delete_titles(db, kind, [title_id])
                db.commit()
                deleted.append(title_id)
            except IntegrityError as e:
                db.rollback()
                logger.warning(
                    "cache prune: kept %s %s, the database refused the delete: %s",
                    kind, title_id, e.orig,
                )
    return deleted


def prune_stale_cache(db: Session, now: datetime | None = None) -> dict[str, int]:
    """Nightly: delete stale, unreferenced titles. Off until CACHE_PRUNE_ENABLED
    is set, so the first run can be reviewed with scripts/prune_review.py."""
    if not settings.CACHE_PRUNE_ENABLED:
        logger.info("cache prune: skipped (CACHE_PRUNE_ENABLED is off)")
        return {"tv": 0, "movie": 0}

    cutoff = _cutoff(now)
    result = {}
    for kind, model in _TITLE_MODELS.items():
        ids = [row_id for (row_id,) in db.query(model.id).filter(_prunable(kind, cutoff))]
        result[kind] = len(_delete_prunable(db, kind, ids, cutoff))

    if result["tv"] or result["movie"]:
        logger.info(
            "cache prune: removed %d show(s) and %d movie(s) nobody references",
            result["tv"], result["movie"],
        )
    return result


# ── one-off review of the first run (scripts/prune_review.py) ───────────


@dataclass
class PruneReview:
    to_delete: list[dict] = field(default_factory=list)
    now_protected: list[dict] = field(default_factory=list)
    already_missing: list[dict] = field(default_factory=list)


def _user_data_rows(db: Session, kind: str, id_filter) -> list[dict]:
    """Per (user, title): what each user has on titles matching id_filter.
    id_filter(ref) returns a WHERE clause on the reference's id column."""
    data: dict[tuple[str, int], list[str]] = defaultdict(list)
    for ref in REFERENCES[kind]:
        if ref.user_column is None:
            continue
        user_col = getattr(ref.model, ref.user_column)
        id_col = getattr(ref.model, ref.id_column)
        query = db.query(user_col, id_col, func.count()).filter(id_filter(ref, id_col))
        if ref.typed:
            query = query.filter(ref.model.content_type == kind)
        for user_id, title_id, n in query.group_by(user_col, id_col):
            data[(user_id or "", title_id)].append(f"{ref.label} ({n})")

    user_ids = {uid for uid, _ in data if uid}
    usernames = (
        dict(db.query(User.id, User.username).filter(User.id.in_(user_ids)))
        if user_ids else {}
    )
    return [
        {
            "username": usernames.get(uid) or "",
            "user_id": uid,
            "content_type": kind,
            "content_id": title_id,
            "data": "; ".join(parts),
        }
        for (uid, title_id), parts in sorted(data.items())
    ]


def build_review(db: Session, now: datetime | None = None) -> PruneReview:
    """Read-only. What the first prune run would delete, which user data the
    old tracking_count rule would have deleted that the new rule keeps, and
    list entries whose title row is already gone."""
    cutoff = _cutoff(now)
    review = PruneReview()

    for kind, model in _TITLE_MODELS.items():
        for row_id, title, updated_at in (
            db.query(model.id, _title_column(model), model.updated_at)
            .filter(_prunable(kind, cutoff))
            .order_by(model.id)
        ):
            review.to_delete.append({
                "decision": "delete",
                "content_type": kind,
                "id": row_id,
                "title": title or "",
                "last_updated": updated_at.isoformat() if updated_at else "",
            })

        old_rule = select(model.id).where(
            model.tracking_count == 0,
            model.updated_at < cutoff,
            not_(_unreferenced(kind, model.id)),
        )
        titles = dict(
            db.query(model.id, _title_column(model)).filter(model.id.in_(old_rule))
        )
        for row in _user_data_rows(db, kind, lambda ref, id_col: id_col.in_(old_rule)):
            row["title"] = titles.get(row["content_id"]) or ""
            review.now_protected.append(row)

        review.already_missing.extend(
            _user_data_rows(
                db, kind,
                lambda ref, id_col: not_(exists().where(model.id == id_col)),
            )
        )

    return review


def apply_review(
    db: Session, rows: Iterable[dict], now: datetime | None = None
) -> dict:
    """Apply decisions from the reviewed to_delete.csv. "delete" rows are
    deleted only if still prunable; "keep" rows get their 90-day clock reset."""
    now = now or datetime.now(timezone.utc)
    to_delete: dict[str, list[int]] = defaultdict(list)
    to_keep: dict[str, list[int]] = defaultdict(list)
    for row in rows:
        decision = (row.get("decision") or "").strip().lower()
        kind = (row.get("content_type") or "").strip()
        if kind not in _TITLE_MODELS or decision not in ("delete", "keep"):
            raise ValueError(f"Bad review row: {row!r}")
        (to_delete if decision == "delete" else to_keep)[kind].append(int(row["id"]))

    kept = 0
    for kind, ids in to_keep.items():
        model = _TITLE_MODELS[kind]
        kept += db.query(model).filter(model.id.in_(ids)).update(
            {model.updated_at: now}, synchronize_session=False
        )
    db.commit()

    cutoff = _cutoff(now)
    deleted = 0
    skipped: list[tuple[str, int]] = []
    for kind, ids in to_delete.items():
        done = set(_delete_prunable(db, kind, ids, cutoff))
        deleted += len(done)
        skipped.extend((kind, i) for i in ids if i not in done)

    return {"deleted": deleted, "kept": kept, "skipped": skipped}
