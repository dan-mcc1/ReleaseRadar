"""
Tests for app.services.collection_ingest_service.

The TMDb HTTP layer (``get_collection``) and the requests-driven dump fetch
(``_iter_dump_records``) are patched so no real HTTP calls fire. The Postgres
``ON CONFLICT`` upsert used by ``daily_sync`` is PG-only syntax — those tests
are marked skipped on SQLite.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest


# ── daily_sync (uses pg_insert / ON CONFLICT — PG only) ──────────────────────


class TestDailySync:
    @pytest.mark.skip(reason="PG-only syntax (pg_insert ON CONFLICT)")
    def test_dummy_skipped_on_sqlite(self):
        pass


# ── _ingest_collection_details ───────────────────────────────────────────────


class TestIngestCollectionDetails:
    def test_missing_collection_returns_missing_status(self, db):
        from app.services.collection_ingest_service import _ingest_collection_details

        with patch(
            "app.services.collection_ingest_service.get_collection",
            return_value=None,
        ):
            now = datetime.now(timezone.utc)
            stats = _ingest_collection_details(db, 12345, now)
        assert stats["status"] == "missing"
        assert stats["parts"] == 0

    def test_creates_collection_row_when_absent(self, db):
        from app.models.collection import Collection
        from app.services.collection_ingest_service import _ingest_collection_details

        payload = {
            "id": 999,
            "name": "Test Trilogy",
            "poster_path": "/p.jpg",
            "backdrop_path": "/b.jpg",
            "overview": "ov",
            "parts": [],
        }
        with patch(
            "app.services.collection_ingest_service.get_collection",
            return_value=payload,
        ):
            now = datetime.now(timezone.utc)
            stats = _ingest_collection_details(db, 999, now)
            db.flush()

        assert stats["status"] == "ok"
        col = db.get(Collection, 999)
        assert col is not None
        assert col.name == "Test Trilogy"
        assert col.poster_path == "/p.jpg"
        # SQLite strips tzinfo on round-trip; compare naive.
        assert col.details_refreshed_at.replace(tzinfo=None) == now.replace(tzinfo=None)
        # No parts → size=0
        assert col.size == 0

    def test_skips_adult_parts(self, db):
        from app.services.collection_ingest_service import _ingest_collection_details

        payload = {
            "id": 1,
            "name": "C",
            "parts": [
                {"id": 10, "adult": True, "release_date": "2020-01-01"},
                {"id": 11, "adult": True, "release_date": "2020-01-02"},
            ],
        }
        with patch(
            "app.services.collection_ingest_service.get_collection",
            return_value=payload,
        ):
            with patch(
                "app.services.collection_ingest_service.populate_movie_full",
                return_value=None,
            ) as mp:
                now = datetime.now(timezone.utc)
                stats = _ingest_collection_details(db, 1, now)

        # Both filtered before populate_movie_full is even called
        assert mp.call_count == 0
        assert stats["skipped_adult"] == 2
        assert stats["fetched_movies"] == 0

    def test_deduplicates_parts_by_id(self, db):
        from app.services.collection_ingest_service import _ingest_collection_details

        payload = {
            "id": 2,
            "name": "C",
            "parts": [
                {"id": 100, "adult": False, "release_date": "2020-01-01", "popularity": 5.0},
                {"id": 100, "adult": False, "release_date": "2020-01-02", "popularity": 5.0},
            ],
        }
        movie_mock = MagicMock(id=100)
        with patch(
            "app.services.collection_ingest_service.get_collection",
            return_value=payload,
        ):
            with patch(
                "app.services.collection_ingest_service.populate_movie_full",
                return_value=movie_mock,
            ) as mp:
                now = datetime.now(timezone.utc)
                stats = _ingest_collection_details(db, 2, now)

        # Only one populate call for id=100
        assert mp.call_count == 1
        assert stats["fetched_movies"] == 1

    def test_aggregates_size_avg_rating_popularity_year(self, db):
        from datetime import date

        from app.models.collection import Collection, CollectionMovie
        from app.models.movie import Movie
        from app.services.collection_ingest_service import _ingest_collection_details

        # Pre-seed Movie rows so the aggregate read can find ratings/years
        db.add_all(
            [
                Movie(
                    id=201,
                    title="A",
                    release_date=date(2010, 1, 1),
                    runtime=100,
                    tracking_count=0,
                    vote_average=7.0,
                ),
                Movie(
                    id=202,
                    title="B",
                    release_date=date(2020, 1, 1),
                    runtime=100,
                    tracking_count=0,
                    vote_average=9.0,
                ),
            ]
        )
        db.commit()

        payload = {
            "id": 50,
            "name": "Saga",
            "parts": [
                {"id": 201, "adult": False, "release_date": "2010-01-01", "popularity": 10.0},
                {"id": 202, "adult": False, "release_date": "2020-01-01", "popularity": 20.0},
            ],
        }

        def _populate(_db, mid):
            return _db.query(Movie).filter_by(id=mid).first()

        with patch(
            "app.services.collection_ingest_service.get_collection",
            return_value=payload,
        ), patch(
            "app.services.collection_ingest_service.populate_movie_full",
            side_effect=_populate,
        ):
            now = datetime.now(timezone.utc)
            stats = _ingest_collection_details(db, 50, now)
            db.flush()

        assert stats["status"] == "ok"
        col = db.get(Collection, 50)
        assert col.size == 2
        assert col.avg_rating == pytest.approx(8.0)
        assert col.popularity == pytest.approx(15.0)
        assert col.min_year == 2010
        assert col.max_year == 2020

        cm = db.query(CollectionMovie).filter_by(collection_id=50).all()
        # Sorted by release_date asc → id 201 first, then 202
        cm.sort(key=lambda r: r.sort_order)
        assert [r.movie_id for r in cm] == [201, 202]

    def test_replaces_existing_collection_movies(self, db):
        """Re-ingesting replaces the CollectionMovie set rather than appending."""
        from datetime import date

        from app.models.collection import Collection, CollectionMovie
        from app.models.movie import Movie
        from app.services.collection_ingest_service import _ingest_collection_details

        # Pre-seed an existing collection with old part 301
        db.add(Collection(id=70, name="Old Name"))
        db.add(
            Movie(id=301, title="Old", release_date=date(2000, 1, 1), runtime=90,
                  tracking_count=0, vote_average=6.0)
        )
        db.flush()
        db.add(CollectionMovie(collection_id=70, movie_id=301, sort_order=0))
        db.commit()

        # New ingest only includes movie 302
        db.add(
            Movie(id=302, title="New", release_date=date(2024, 1, 1), runtime=90,
                  tracking_count=0, vote_average=8.0)
        )
        db.commit()

        payload = {
            "id": 70,
            "name": "New Name",
            "parts": [
                {"id": 302, "adult": False, "release_date": "2024-01-01", "popularity": 5.0},
            ],
        }

        def _populate(_db, mid):
            return _db.query(Movie).filter_by(id=mid).first()

        with patch(
            "app.services.collection_ingest_service.get_collection",
            return_value=payload,
        ), patch(
            "app.services.collection_ingest_service.populate_movie_full",
            side_effect=_populate,
        ):
            _ingest_collection_details(db, 70, datetime.now(timezone.utc))
            db.flush()

        cm = db.query(CollectionMovie).filter_by(collection_id=70).all()
        assert [r.movie_id for r in cm] == [302]
        # Name overwritten
        col = db.get(Collection, 70)
        assert col.name == "New Name"


# ── _ingest_one ──────────────────────────────────────────────────────────────


class TestIngestOne:
    def test_returns_error_status_on_exception(self, db):
        from app.services.collection_ingest_service import _ingest_one

        with patch(
            "app.services.collection_ingest_service._ingest_collection_details",
            side_effect=RuntimeError("boom"),
        ):
            result = _ingest_one(db, 1, datetime.now(timezone.utc))

        assert result["status"] == "error"
        assert "boom" in result["error"]

    def test_returns_stats_on_success_and_commits(self, db):
        from app.models.collection import Collection
        from app.services.collection_ingest_service import _ingest_one

        def _fake(_db, cid, _now):
            _db.add(Collection(id=cid, name=f"C{cid}"))
            return {"status": "ok", "parts": 0}

        with patch(
            "app.services.collection_ingest_service._ingest_collection_details",
            side_effect=_fake,
        ):
            result = _ingest_one(db, 1234, datetime.now(timezone.utc))

        assert result["status"] == "ok"
        assert db.get(Collection, 1234) is not None


# ── _dump_url_for ────────────────────────────────────────────────────────────


class TestDumpUrlFor:
    def test_before_8am_uses_previous_day(self):
        from app.services.collection_ingest_service import _dump_url_for

        url = _dump_url_for(datetime(2024, 6, 15, 7, 0, tzinfo=timezone.utc))
        # Should use 06_14_2024 (previous day)
        assert "06_14_2024" in url

    def test_after_8am_uses_today(self):
        from app.services.collection_ingest_service import _dump_url_for

        url = _dump_url_for(datetime(2024, 6, 15, 10, 0, tzinfo=timezone.utc))
        assert "06_15_2024" in url


# ── daily_refresh — orchestration smoke test ─────────────────────────────────


class TestDailyRefresh:
    def test_orchestrates_index_then_ingest(self, db):
        """daily_refresh should call daily_sync then parallel-ingest every
        collection currently in the DB."""
        from app.models.collection import Collection
        from app.services.collection_ingest_service import daily_refresh

        # Pre-seed two collections — one fresh (no details), one with details set
        now = datetime.now(timezone.utc)
        db.add(Collection(id=1, name="New", details_refreshed_at=None))
        db.add(Collection(id=2, name="Existing", details_refreshed_at=now))
        db.commit()

        with patch(
            "app.services.collection_ingest_service.daily_sync",
            return_value={"upserted": 5, "seen": 5},
        ) as mock_sync, patch(
            "app.services.collection_ingest_service._parallel_ingest",
            return_value=(2, 0),
        ) as mock_ingest:
            result = daily_refresh(db, now_utc=now)

        mock_sync.assert_called_once()
        mock_ingest.assert_called_once()
        # The ID list passed should put new collections first
        ids_arg = mock_ingest.call_args[0][0]
        assert ids_arg == [1, 2]
        assert result["index_upserted"] == 5
        assert result["new_collections_seen"] == 1
        assert result["existing_collections_seen"] == 1
        assert result["collections_succeeded"] == 2
        assert result["collections_failed"] == 0


# ── backfill_collections — orchestration smoke test ──────────────────────────


class TestBackfillCollections:
    def test_skip_dump_does_not_call_daily_sync(self, db):
        from app.services.collection_ingest_service import backfill_collections

        with patch(
            "app.services.collection_ingest_service.daily_sync"
        ) as mock_sync, patch(
            "app.services.collection_ingest_service._parallel_ingest",
            return_value=(0, 0),
        ):
            backfill_collections(db, skip_dump=True)
        mock_sync.assert_not_called()

    def test_only_missing_details_filters(self, db):
        from app.models.collection import Collection
        from app.services.collection_ingest_service import backfill_collections

        now = datetime.now(timezone.utc)
        db.add(Collection(id=1, name="A", details_refreshed_at=None))
        db.add(Collection(id=2, name="B", details_refreshed_at=now))
        db.commit()

        with patch(
            "app.services.collection_ingest_service._parallel_ingest",
            return_value=(1, 0),
        ) as mp:
            backfill_collections(db, skip_dump=True, only_missing_details=True)

        # Only the un-detailed collection id=1 is enqueued
        assert mp.call_args[0][0] == [1]

    def test_limit_caps_ids(self, db):
        from app.models.collection import Collection
        from app.services.collection_ingest_service import backfill_collections

        for cid in range(1, 6):
            db.add(Collection(id=cid, name=f"C{cid}"))
        db.commit()

        with patch(
            "app.services.collection_ingest_service._parallel_ingest",
            return_value=(2, 0),
        ) as mp:
            backfill_collections(db, skip_dump=True, only_missing_details=True, limit=2)

        assert len(mp.call_args[0][0]) == 2
