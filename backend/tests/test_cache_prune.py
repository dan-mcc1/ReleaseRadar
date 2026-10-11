"""
Tests for app/services/cache_prune_service.py and scripts/prune_review.py.

The prune deletes cached Show/Movie rows. A row is only deleted when nothing
has touched it for 90 days AND no row anywhere references it; the FK cascades
on show.id would otherwise take users' episode history with it.
"""

import csv
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.config import settings
from app.db.base import Base
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
from app.models.shelf_item import ShelfItem
from app.models.show import Show
from app.models.show_video import ShowVideo
from app.models.user import User
from app.models.user_collection_ranking import UserCollectionRanking
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services import cache_prune_service
from app.services.cache_prune_service import (
    apply_review,
    build_review,
    prune_stale_cache,
)

OLD = datetime.now(timezone.utc) - timedelta(days=100)
RECENT = datetime.now(timezone.utc) - timedelta(days=10)


@pytest.fixture
def prune_enabled(monkeypatch):
    monkeypatch.setattr(settings, "CACHE_PRUNE_ENABLED", True)


def _typed(model, kind, **extra):
    return lambda cid: model(user_id="u1", content_type=kind, content_id=cid, **extra)


# One factory per table that must protect a show from the prune.
TV_REFERENCES = {
    "watchlist": _typed(Watchlist, "tv"),
    "currently_watching": _typed(CurrentlyWatching, "tv"),
    "watched": _typed(Watched, "tv"),
    "favorite": _typed(Favorite, "tv"),
    "review": _typed(Review, "tv"),
    "rewatch": _typed(Rewatch, "tv"),
    "shelf_items": _typed(ShelfItem, "tv", shelf_id=1),
    "activity": _typed(Activity, "tv", activity_type="watched"),
    "notification": _typed(Notification, "tv", type="trailer", title="t", body="b"),
    "recommendation": lambda cid: Recommendation(
        sender_id="u2", recipient_id="u1", content_type="tv", content_id=cid
    ),
    "community_media": lambda cid: CommunityMedia(
        community_id=1, content_type="tv", content_id=cid, added_by="u1"
    ),
    "episode_watched": lambda sid: EpisodeWatched(
        user_id="u1", show_id=sid, season_number=1, episode_number=1
    ),
    "season_rating": lambda sid: SeasonRating(
        user_id="u1", show_id=sid, season_number=1, rating=4.0
    ),
    "finish_by_goal": lambda sid: FinishByGoal(
        user_id="u1", show_id=sid, target_date=date(2027, 1, 1)
    ),
}

# One factory per table that must protect a movie from the prune.
MOVIE_REFERENCES = {
    "watchlist": _typed(Watchlist, "movie"),
    "currently_watching": _typed(CurrentlyWatching, "movie"),
    "watched": _typed(Watched, "movie"),
    "favorite": _typed(Favorite, "movie"),
    "review": _typed(Review, "movie"),
    "rewatch": _typed(Rewatch, "movie"),
    "shelf_items": _typed(ShelfItem, "movie", shelf_id=1),
    "activity": _typed(Activity, "movie", activity_type="watched"),
    "notification": _typed(Notification, "movie", type="trailer", title="t", body="b"),
    "recommendation": lambda cid: Recommendation(
        sender_id="u2", recipient_id="u1", content_type="movie", content_id=cid
    ),
    "community_media": lambda cid: CommunityMedia(
        community_id=1, content_type="movie", content_id=cid, added_by="u1"
    ),
    "collection_movie": lambda mid: CollectionMovie(
        collection_id=1, movie_id=mid, sort_order=0
    ),
    "user_collection_ranking": lambda mid: UserCollectionRanking(
        user_id="u1", collection_id=1, movie_id=mid, rank=1
    ),
}


def _ids(db, model):
    db.expire_all()
    return {row.id for row in db.query(model).all()}


# ── which tables count as references ─────────────────────────────────────


class TestReferenceClassification:
    def test_every_table_pointing_at_titles_is_classified(self):
        """A new table with a content_id/show_id/movie_id column must be added
        either as a reference (protects the title) or as cached data that is
        deleted with it. Otherwise its rows could silently stop protecting
        their title."""
        import app.models  # noqa: F401 — registers every model

        pointing = {
            t.name
            for t in Base.metadata.tables.values()
            if {"content_id", "show_id", "movie_id"} & set(t.columns.keys())
        }
        classified = (
            cache_prune_service.reference_tables()
            | cache_prune_service.CACHE_CHILD_TABLES
        )
        assert pointing - classified == set()

    def test_tests_cover_every_reference(self):
        """Every reference the service knows about has a factory above, so the
        parametrized protection tests exercise all of them."""
        assert set(TV_REFERENCES) == cache_prune_service.reference_tables("tv")
        assert set(MOVIE_REFERENCES) == cache_prune_service.reference_tables("movie")


# ── nightly prune ────────────────────────────────────────────────────────


class TestPruneStaleCache:
    def test_disabled_by_default_deletes_nothing(self, db):
        db.add(Show(id=900, name="Old", tracking_count=0, updated_at=OLD))
        db.commit()

        prune_stale_cache(db)

        assert 900 in _ids(db, Show)

    def test_deletes_stale_unreferenced_show_and_its_cache(self, db, prune_enabled):
        db.add(Show(id=900, name="Old", tracking_count=0, updated_at=OLD))
        db.add(Season(id=9001, show_id=900, season_number=1))
        db.add(Episode(id=90011, show_id=900, season_number=1, episode_number=1))
        db.commit()

        result = prune_stale_cache(db)

        assert 900 not in _ids(db, Show)
        assert result == {"tv": 1, "movie": 0}

    def test_pruning_a_show_drops_its_premiere_alert_records(self, db, prune_enabled):
        """Sent-alert records mean nothing once the show is gone, and mustn't
        keep a show nobody tracks cached."""
        from app.models.sent_premiere_alert import SentPremiereAlert

        db.add(Show(id=901, name="Old", tracking_count=0, updated_at=OLD))
        db.add(SentPremiereAlert(user_id="someone", show_id=901, season_number=2, lead_days=30))
        db.commit()

        prune_stale_cache(db)

        assert 901 not in _ids(db, Show)
        assert db.query(SentPremiereAlert).filter_by(show_id=901).count() == 0

    def test_deletes_stale_unreferenced_movie(self, db, prune_enabled):
        db.add(Movie(id=800, title="Old", tracking_count=0, updated_at=OLD))
        db.commit()

        prune_stale_cache(db)

        assert 800 not in _ids(db, Movie)

    def test_keeps_recently_updated_title(self, db, prune_enabled):
        db.add(Show(id=901, name="Recent", tracking_count=0, updated_at=RECENT))
        db.add(Movie(id=801, title="Recent", tracking_count=0, updated_at=RECENT))
        db.commit()

        prune_stale_cache(db)

        assert 901 in _ids(db, Show)
        assert 801 in _ids(db, Movie)

    def test_keeps_stub_never_populated(self, db, prune_enabled):
        """updated_at IS NULL marks a stub still waiting for its TMDb fill."""
        db.add(Show(id=902, name="", tracking_count=0, updated_at=None))
        db.commit()

        prune_stale_cache(db)

        assert 902 in _ids(db, Show)

    def test_ignores_tracking_count(self, db, prune_enabled):
        """The counter drifts, so it neither protects nor condemns a title."""
        db.add(Show(id=903, name="Count lies high", tracking_count=5, updated_at=OLD))
        db.add(Show(id=904, name="Count lies low", tracking_count=0, updated_at=OLD))
        db.add(Watched(user_id="u1", content_type="tv", content_id=904))
        db.commit()

        prune_stale_cache(db)

        ids = _ids(db, Show)
        assert 903 not in ids
        assert 904 in ids

    @pytest.mark.parametrize("table", sorted(TV_REFERENCES))
    def test_reference_protects_show(self, db, prune_enabled, table):
        db.add(Show(id=910, name="Referenced", tracking_count=0, updated_at=OLD))
        db.add(TV_REFERENCES[table](910))
        db.commit()

        prune_stale_cache(db)

        assert 910 in _ids(db, Show)

    @pytest.mark.parametrize("table", sorted(MOVIE_REFERENCES))
    def test_reference_protects_movie(self, db, prune_enabled, table):
        db.add(Movie(id=810, title="Referenced", tracking_count=0, updated_at=OLD))
        db.add(MOVIE_REFERENCES[table](810))
        db.commit()

        prune_stale_cache(db)

        assert 810 in _ids(db, Movie)

    def test_reference_of_other_type_does_not_protect(self, db, prune_enabled):
        """A movie with id 911 on someone's list says nothing about show 911."""
        db.add(Show(id=911, name="Same id", tracking_count=0, updated_at=OLD))
        db.add(Watchlist(user_id="u1", content_type="movie", content_id=911))
        db.commit()

        prune_stale_cache(db)

        assert 911 not in _ids(db, Show)


class TestPruneWithoutDatabaseCascades:
    """Production's foreign keys predate Alembic and don't all cascade:
    deleting a show that still had episodes raised ForeignKeyViolation on
    episode_show_id_fkey. The prune deletes cached child rows itself, and a
    title the database still refuses is kept instead of failing the run."""

    def test_deletes_cached_rows_hanging_off_pruned_titles(self, db, prune_enabled):
        # SQLite doesn't enforce FKs here, so anything the prune doesn't
        # delete itself is left behind as an orphan row.
        db.add_all([
            Show(id=900, name="Old", tracking_count=0, updated_at=OLD),
            Season(id=9001, show_id=900, season_number=1),
            Episode(id=90011, show_id=900, season_number=1, episode_number=1),
            SentEpisodeAlert(user_id="u1", episode_id=90011),
            ShowGenre(show_id=900, genre_id=18),
            ShowProvider(show_id=900, provider_id=8, flatrate=True),
            ShowVideo(show_id=900, video_key="k1"),
            Movie(id=800, title="Old", tracking_count=0, updated_at=OLD),
            MovieGenre(movie_id=800, genre_id=28),
            MovieProvider(movie_id=800, provider_id=8, flatrate=True),
            MovieVideo(movie_id=800, video_key="k2"),
        ])
        db.commit()

        prune_stale_cache(db)

        db.expire_all()
        leftovers = {
            model.__tablename__: db.query(model).count()
            for model in (Season, Episode, SentEpisodeAlert, ShowGenre, ShowProvider,
                          ShowVideo, MovieGenre, MovieProvider, MovieVideo)
        }
        assert leftovers == dict.fromkeys(leftovers, 0)

    @pytest.fixture
    def legacy_fk_to_show(self, db):
        """A foreign key the models don't know about, with no ON DELETE
        CASCADE, like the ones in production's pre-Alembic schema."""
        db.execute(text("PRAGMA foreign_keys=ON"))
        assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1
        db.execute(text("CREATE TABLE legacy_ref (show_id INTEGER REFERENCES show(id))"))
        db.commit()
        yield
        db.rollback()
        db.execute(text("DROP TABLE IF EXISTS legacy_ref"))
        db.commit()
        db.execute(text("PRAGMA foreign_keys=OFF"))

    def _seed_one_free_one_held(self, db):
        db.add(Show(id=900, name="Free", tracking_count=0, updated_at=OLD))
        db.add(Show(id=901, name="Held by legacy FK", tracking_count=0, updated_at=OLD))
        db.commit()
        db.execute(text("INSERT INTO legacy_ref (show_id) VALUES (901)"))
        db.commit()

    def test_nightly_keeps_a_title_the_database_refuses(self, db, prune_enabled, legacy_fk_to_show):
        self._seed_one_free_one_held(db)

        result = prune_stale_cache(db)

        assert _ids(db, Show) == {901}
        assert result == {"tv": 1, "movie": 0}

    def test_apply_reports_a_refused_title_as_skipped(self, db, legacy_fk_to_show):
        self._seed_one_free_one_held(db)

        result = apply_review(db, [
            {"decision": "delete", "content_type": "tv", "id": "900"},
            {"decision": "delete", "content_type": "tv", "id": "901"},
        ])

        assert result == {"deleted": 1, "kept": 0, "skipped": [("tv", 901)]}
        assert _ids(db, Show) == {901}


# ── one-off review ───────────────────────────────────────────────────────


class TestBuildReview:
    def test_to_delete_lists_exactly_the_prunable_titles(self, db):
        db.add(Show(id=900, name="Stale Show", tracking_count=0, updated_at=OLD))
        db.add(Show(id=901, name="Recent Show", tracking_count=0, updated_at=RECENT))
        db.add(Show(id=902, name="Watched Show", tracking_count=0, updated_at=OLD))
        db.add(Watched(user_id="u1", content_type="tv", content_id=902))
        db.add(Movie(id=800, title="Stale Movie", tracking_count=3, updated_at=OLD))
        db.commit()

        review = build_review(db)

        listed = {(r["content_type"], r["id"], r["title"]) for r in review.to_delete}
        assert listed == {("tv", 900, "Stale Show"), ("movie", 800, "Stale Movie")}
        assert {r["decision"] for r in review.to_delete} == {"delete"}

    def test_now_protected_shows_user_data_the_old_rule_would_delete(self, db):
        db.add(User(id="u1", username="alice", email="a@example.com"))
        # Old rule: tracking_count == 0 and stale → deleted. New rule keeps it.
        db.add(Show(id=920, name="Finished Show", tracking_count=0, updated_at=OLD))
        db.add(Watched(user_id="u1", content_type="tv", content_id=920))
        for ep in (1, 2, 3):
            db.add(EpisodeWatched(user_id="u1", show_id=920, season_number=1, episode_number=ep))
        db.add(SeasonRating(user_id="u1", show_id=920, season_number=1, rating=4.5))
        # Counted correctly → the old rule never touched it either; not listed.
        db.add(Show(id=921, name="Counted Show", tracking_count=1, updated_at=OLD))
        db.add(Watched(user_id="u1", content_type="tv", content_id=921))
        db.commit()

        review = build_review(db)

        assert len(review.now_protected) == 1
        row = review.now_protected[0]
        assert (row["user_id"], row["username"]) == ("u1", "alice")
        assert (row["content_type"], row["content_id"], row["title"]) == ("tv", 920, "Finished Show")
        assert set(row["data"].split("; ")) == {
            "watched (1)",
            "episodes logged (3)",
            "season ratings (1)",
        }

    def test_already_missing_lists_entries_whose_title_row_is_gone(self, db):
        db.add(User(id="u1", username="alice", email="a@example.com"))
        db.add(Watchlist(user_id="u1", content_type="movie", content_id=999))
        db.add(EpisodeWatched(user_id="u1", show_id=998, season_number=1, episode_number=1))
        db.add(EpisodeWatched(user_id="u1", show_id=998, season_number=1, episode_number=2))
        db.add(Movie(id=997, title="Still here", tracking_count=1, updated_at=RECENT))
        db.add(Watchlist(user_id="u1", content_type="movie", content_id=997))
        db.commit()

        review = build_review(db)

        missing = {
            (r["username"], r["content_type"], r["content_id"], r["data"])
            for r in review.already_missing
        }
        assert missing == {
            ("alice", "movie", 999, "watchlist (1)"),
            ("alice", "tv", 998, "episodes logged (2)"),
        }


class TestApplyReview:
    def test_deletes_approved_and_resets_clock_on_kept(self, db):
        db.add(Show(id=900, name="Approve me", tracking_count=0, updated_at=OLD))
        db.add(Show(id=901, name="Keep me", tracking_count=0, updated_at=OLD))
        db.commit()

        result = apply_review(db, [
            {"decision": "delete", "content_type": "tv", "id": "900"},
            {"decision": "keep", "content_type": "tv", "id": "901"},
        ])

        assert result == {"deleted": 1, "kept": 1, "skipped": []}
        assert _ids(db, Show) == {901}
        kept = db.get(Show, 901)
        assert kept.updated_at.replace(tzinfo=timezone.utc) > RECENT

    def test_skips_title_that_gained_a_reference_after_the_report(self, db):
        db.add(Movie(id=800, title="Added since", tracking_count=0, updated_at=OLD))
        db.add(Favorite(user_id="u1", content_type="movie", content_id=800))
        db.commit()

        result = apply_review(db, [{"decision": "delete", "content_type": "movie", "id": "800"}])

        assert result == {"deleted": 0, "kept": 0, "skipped": [("movie", 800)]}
        assert 800 in _ids(db, Movie)

    def test_rejects_unknown_decision(self, db):
        with pytest.raises(ValueError):
            apply_review(db, [{"decision": "maybe", "content_type": "tv", "id": "900"}])


class TestPruneReviewScript:
    def test_report_then_apply_round_trip(self, db, tmp_path):
        from scripts import prune_review

        db.add(Show(id=900, name="Delete me", tracking_count=0, updated_at=OLD))
        db.add(Show(id=901, name="Keep me", tracking_count=0, updated_at=OLD))
        db.add(Show(id=902, name="In use", tracking_count=0, updated_at=OLD))
        db.add(Watched(user_id="u1", content_type="tv", content_id=902))
        db.commit()

        assert prune_review.main(["report", "--out", str(tmp_path)]) == 0

        to_delete = tmp_path / "to_delete.csv"
        with to_delete.open(newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        assert {(r["content_type"], r["id"]) for r in rows} == {("tv", "900"), ("tv", "901")}
        assert (tmp_path / "now_protected.csv").exists()
        assert (tmp_path / "already_missing.csv").exists()

        for r in rows:
            if r["id"] == "901":
                r["decision"] = "keep"
        with to_delete.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

        assert prune_review.main(["apply", str(to_delete)]) == 0

        assert _ids(db, Show) == {901, 902}
