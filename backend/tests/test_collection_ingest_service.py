"""
Tests for app.services.collection_ingest_service.

The TMDb HTTP layer (``get_collection``) and the requests-driven dump fetch
(``_iter_dump_records``) are patched so no real HTTP calls fire. The Postgres
``ON CONFLICT`` upsert used by ``daily_sync`` is PG-only syntax — those tests
are marked skipped on SQLite.
"""

from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

import pytest


# ── daily_sync (uses pg_insert / ON CONFLICT — PG only) ──────────────────────


class TestDailySync:
    @pytest.mark.skip(reason="PG-only syntax (pg_insert ON CONFLICT)")
    def test_dummy_skipped_on_sqlite(self):
        pass


# ── _prune_stale_collections ─────────────────────────────────────────────────


class TestPruneStaleCollections:
    """daily_sync stamps every id in the dump with index_refreshed_at=now.
    Anything older (or never stamped) is no longer on TMDb."""

    def _seed(self, db, now):
        from datetime import timedelta
        from app.models.collection import Collection, CollectionMovie
        from app.models.user import User
        from app.models.user_collection_ranking import UserCollectionRanking

        db.add(User(id="u1", username="u1", email="u1@test.com"))
        db.add_all([
            Collection(id=1, name="Live A", index_refreshed_at=now),
            Collection(id=2, name="Live B", index_refreshed_at=now),
            Collection(id=3, name="Live C", index_refreshed_at=now),
            Collection(id=4, name="Gone", index_refreshed_at=now - timedelta(days=3)),
            Collection(id=5, name="Never stamped", index_refreshed_at=None),
        ])
        db.flush()
        db.add_all([
            CollectionMovie(collection_id=1, movie_id=100, sort_order=0),
            CollectionMovie(collection_id=4, movie_id=100, sort_order=0),
            UserCollectionRanking(user_id="u1", collection_id=4, movie_id=100, rank=1),
        ])
        db.commit()

    def test_deletes_collections_missing_from_dump(self, db):
        from app.models.collection import Collection, CollectionMovie
        from app.models.user_collection_ranking import UserCollectionRanking
        from app.services.collection_ingest_service import _prune_stale_collections

        now = datetime.now(timezone.utc)
        self._seed(db, now)

        pruned = _prune_stale_collections(db, now_utc=now, seen=3)

        assert pruned == 2
        assert {c.id for c in db.query(Collection).all()} == {1, 2, 3}
        assert db.query(CollectionMovie).filter_by(collection_id=4).count() == 0
        assert db.query(CollectionMovie).filter_by(collection_id=1).count() == 1
        assert db.query(UserCollectionRanking).count() == 0

    def test_skips_when_dump_looks_truncated(self, db):
        """A short or corrupt dump must not wipe the catalog."""
        from app.models.collection import Collection
        from app.services.collection_ingest_service import _prune_stale_collections

        now = datetime.now(timezone.utc)
        self._seed(db, now)

        pruned = _prune_stale_collections(db, now_utc=now, seen=1)

        assert pruned == 0
        assert db.query(Collection).count() == 5


# ── _ingest_collection_details ───────────────────────────────────────────────


class TestIngestCollectionDetails:
    def test_missing_collection_returns_missing_status(self, db):
        from app.services.collection_ingest_service import _ingest_collection_details

        with patch(
            "app.services.collection_ingest_service.fetch_collection",
            return_value=None,
        ):
            now = datetime.now(timezone.utc)
            stats = _ingest_collection_details(db, 12345, now)
        assert stats["status"] == "missing"
        assert stats["parts"] == 0

    def test_existing_collection_deleted_when_tmdb_no_longer_has_it(self, db):
        """TMDb merged/deleted the collection (its id 404s). Our stale copy —
        poster, parts, rankings — must go, or it lingers on browse as a
        duplicate that errors when clicked."""
        from app.models.collection import Collection, CollectionMovie
        from app.models.user import User
        from app.models.user_collection_ranking import UserCollectionRanking
        from app.services.collection_ingest_service import _ingest_collection_details

        db.add(User(id="u1", username="u1", email="u1@test.com"))
        db.add(Collection(id=995, name="Merged Away", poster_path="/p.jpg", size=1))
        db.flush()
        db.add(CollectionMovie(collection_id=995, movie_id=5, sort_order=0))
        db.add(UserCollectionRanking(user_id="u1", collection_id=995, movie_id=5, rank=1))
        db.commit()

        with patch(
            "app.services.collection_ingest_service.fetch_collection",
            return_value=None,
        ):
            stats = _ingest_collection_details(db, 995, datetime.now(timezone.utc))
            db.flush()

        assert stats["status"] == "missing"
        assert db.get(Collection, 995) is None
        assert db.query(CollectionMovie).filter_by(collection_id=995).count() == 0
        assert db.query(UserCollectionRanking).filter_by(collection_id=995).count() == 0

    def test_part_that_404s_is_skipped_not_fatal(self, db):
        """One dead movie id in TMDb's parts list used to abort the whole
        ingest, leaving the collection's stale data in place forever."""
        import httpx
        from app.models.collection import Collection, CollectionMovie
        from app.services.collection_ingest_service import _ingest_collection_details

        req = httpx.Request("GET", "https://api.themoviedb.org/3/movie/9102")
        not_found = httpx.HTTPStatusError(
            "not found", request=req, response=httpx.Response(404, request=req)
        )

        def _populate(_db, mid, **_):
            if mid == 9102:
                raise not_found
            return MagicMock(id=mid)

        payload = {
            "id": 994,
            "name": "Has A Dead Part",
            "parts": [
                {"id": 9101, "release_date": "2001-01-01"},
                {"id": 9102, "release_date": "2002-01-01"},
            ],
        }
        with patch(
            "app.services.collection_ingest_service.fetch_collection",
            return_value=payload,
        ), patch(
            "app.services.collection_ingest_service.populate_movie_full",
            side_effect=_populate,
        ):
            stats = _ingest_collection_details(db, 994, datetime.now(timezone.utc))
            db.flush()

        assert stats["status"] == "ok"
        assert db.get(Collection, 994).size == 1
        parts = db.query(CollectionMovie).filter_by(collection_id=994).all()
        assert [p.movie_id for p in parts] == [9101]

    def test_creates_collection_row_when_absent(self, db):
        from app.models.collection import Collection
        from app.services.collection_ingest_service import _ingest_collection_details

        payload = {
            "id": 999,
            "name": "Test Trilogy",
            "poster_path": "/p.jpg",
            "backdrop_path": "/b.jpg",
            "overview": "ov",
            "parts": [
                {"id": 9001, "adult": False, "release_date": "2010-01-01", "popularity": 5.0},
            ],
        }
        movie_mock = MagicMock(id=9001)
        with patch(
            "app.services.collection_ingest_service.fetch_collection",
            return_value=payload,
        ), patch(
            "app.services.collection_ingest_service.populate_movie_full",
            return_value=movie_mock,
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
        assert col.size == 1

    def test_empty_collection_is_not_persisted(self, db):
        """A collection whose parts are all adult/unfetchable (size 0) must not
        be added to the catalog."""
        from app.models.collection import Collection
        from app.services.collection_ingest_service import _ingest_collection_details

        payload = {
            "id": 998,
            "name": "Adult Collection",
            "parts": [
                {"id": 8001, "adult": True, "release_date": "2020-01-01"},
            ],
        }
        with patch(
            "app.services.collection_ingest_service.fetch_collection",
            return_value=payload,
        ), patch(
            "app.services.collection_ingest_service.populate_movie_full",
            return_value=None,
        ):
            now = datetime.now(timezone.utc)
            stats = _ingest_collection_details(db, 998, now)
            db.flush()

        assert stats["status"] == "empty"
        assert db.get(Collection, 998) is None

    def test_existing_collection_removed_when_it_becomes_empty(self, db):
        """If a previously-ingested collection loses all non-adult parts, the
        stale Collection row is deleted."""
        from app.models.collection import Collection, CollectionMovie
        from app.services.collection_ingest_service import _ingest_collection_details

        db.add(Collection(id=997, name="Was Populated", size=1))
        db.flush()
        db.add(CollectionMovie(collection_id=997, movie_id=5, sort_order=0))
        db.commit()

        payload = {
            "id": 997,
            "name": "Was Populated",
            "parts": [
                {"id": 5, "adult": True, "release_date": "2020-01-01"},
            ],
        }
        with patch(
            "app.services.collection_ingest_service.fetch_collection",
            return_value=payload,
        ), patch(
            "app.services.collection_ingest_service.populate_movie_full",
            return_value=None,
        ):
            stats = _ingest_collection_details(db, 997, datetime.now(timezone.utc))
            db.flush()

        assert stats["status"] == "empty"
        assert db.get(Collection, 997) is None
        assert db.query(CollectionMovie).filter_by(collection_id=997).count() == 0

    def test_adult_collection_flag_is_not_persisted(self, db):
        """A collection flagged adult at the top level is dropped outright."""
        from app.models.collection import Collection
        from app.services.collection_ingest_service import _ingest_collection_details

        # Pre-seed a stale row that the index sync might have created.
        db.add(Collection(id=996, name="Adult"))
        db.commit()

        payload = {"id": 996, "name": "Adult", "adult": True, "parts": []}
        with patch(
            "app.services.collection_ingest_service.fetch_collection",
            return_value=payload,
        ):
            stats = _ingest_collection_details(db, 996, datetime.now(timezone.utc))
            db.flush()

        assert stats["status"] == "empty"
        assert db.get(Collection, 996) is None

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
            "app.services.collection_ingest_service.fetch_collection",
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
            "app.services.collection_ingest_service.fetch_collection",
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
                {"id": 201, "adult": False, "release_date": "2010-01-01",
                 "popularity": 10.0, "vote_count": 1000},
                {"id": 202, "adult": False, "release_date": "2020-01-01",
                 "popularity": 20.0, "vote_count": 3000},
            ],
        }

        def _populate(_db, mid, **_):
            return _db.query(Movie).filter_by(id=mid).first()

        with patch(
            "app.services.collection_ingest_service.fetch_collection",
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
        # sqrt(total votes × total popularity) = sqrt(4000 × 30)
        assert col.popularity == pytest.approx((4000 * 30) ** 0.5)
        assert col.rating_score is not None
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

        def _populate(_db, mid, **_):
            return _db.query(Movie).filter_by(id=mid).first()

        with patch(
            "app.services.collection_ingest_service.fetch_collection",
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

    def test_ingest_reads_fresh_tmdb_data_not_the_page_cache(self, db):
        """The collection page caches TMDb responses in-process with no expiry.
        The nightly ingest must not pick up a stale copy from that cache."""
        from app.models.collection import Collection
        from app.services.collection_ingest_service import _ingest_collection_details
        from app.services.tmdb_collections import get_collection

        get_collection.cache_clear()
        old = {"id": 71, "name": "Old Name", "parts": [{"id": 7101, "release_date": "2001-01-01"}]}
        new = {"id": 71, "name": "New Name", "parts": [{"id": 7101, "release_date": "2001-01-01"}]}
        try:
            with patch("app.services.tmdb_collections.get", return_value=old):
                get_collection(71)  # a page view caches the old payload
            with patch("app.services.tmdb_collections.get", return_value=new), patch(
                "app.services.collection_ingest_service.populate_movie_full",
                return_value=MagicMock(id=7101),
            ):
                _ingest_collection_details(db, 71, datetime.now(timezone.utc))
                db.flush()
        finally:
            get_collection.cache_clear()

        assert db.get(Collection, 71).name == "New Name"


# ── Part movie refresh (Movie rows are otherwise never refreshed) ────────────


class TestPartMovieRefresh:
    """Runs the real populate_movie_full; only the TMDb /movie fetch is faked."""

    NOW = datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc)

    def _seed_movie(self, db, mid, release, vote_average=6.0):
        from app.models.movie import Movie
        db.add(Movie(id=mid, title=f"M{mid}", release_date=release, tracking_count=0,
                     vote_average=vote_average, updated_at=self.NOW))
        db.commit()

    def _tmdb_movie(self, mid, release, vote_average=7.0):
        return {
            "id": mid, "title": f"M{mid}", "release_date": release,
            "vote_average": vote_average, "release_dates": {"results": []},
            "genres": [], "watch/providers": {"results": {}}, "images": {"logos": []},
        }

    def _ingest(self, db, parts, movie_responses):
        from app.services.collection_ingest_service import _ingest_collection_details
        payload = {"id": 80, "name": "Saga", "parts": parts}
        with patch(
            "app.services.collection_ingest_service.fetch_collection", return_value=payload
        ), patch(
            # The HTTP boundary, so the real fetch path is exercised.
            "app.services.tmdb_movies.get",
            side_effect=lambda path, params=None: movie_responses[int(path.rsplit("/", 1)[1])],
        ) as fetch, patch(
            # populate_movie_full stores the ISO string, which Postgres accepts
            # but SQLite's Date type rejects.
            "app.services.media_upsert.get_theatrical_release_date",
            side_effect=lambda data: date.fromisoformat(data["release_date"]),
        ):
            stats = _ingest_collection_details(db, 80, self.NOW)
            db.flush()
        return stats, fetch

    def test_upcoming_movie_picks_up_its_new_release_date(self, db):
        from app.models.movie import Movie
        self._seed_movie(db, 8001, date(2026, 12, 1))
        self._ingest(
            db,
            [{"id": 8001, "release_date": "2027-03-05"}],
            {8001: self._tmdb_movie(8001, "2027-03-05")},
        )
        assert db.get(Movie, 8001).release_date == date(2027, 3, 5)

    def test_row_saved_as_upcoming_is_refreshed_once_released(self, db):
        """Saved back when it was upcoming; TMDb has since listed it as out a
        while ago, but our row still holds the old future date."""
        from app.models.movie import Movie
        self._seed_movie(db, 8002, date(2026, 12, 1))
        self._ingest(
            db,
            [{"id": 8002, "release_date": "2025-06-01"}],
            {8002: self._tmdb_movie(8002, "2025-06-01")},
        )
        assert db.get(Movie, 8002).release_date == date(2025, 6, 1)

    def test_recently_released_movie_is_refreshed(self, db):
        from app.models.movie import Movie
        self._seed_movie(db, 8003, date(2026, 9, 1), vote_average=6.0)
        self._ingest(
            db,
            [{"id": 8003, "release_date": "2026-09-01"}],
            {8003: self._tmdb_movie(8003, "2026-09-01", vote_average=7.4)},
        )
        assert db.get(Movie, 8003).vote_average == pytest.approx(7.4)

    def test_settled_movie_is_not_refetched_but_gets_fresh_rating(self, db):
        """Long-released movies don't cost a /movie call; their rating comes
        straight from the /collection payload."""
        from app.models.collection import Collection
        from app.models.movie import Movie
        self._seed_movie(db, 8004, date(2010, 5, 1), vote_average=6.0)
        stats, fetch = self._ingest(
            db,
            [{"id": 8004, "release_date": "2010-05-01", "vote_average": 7.7}],
            {},
        )
        assert fetch.call_count == 0
        assert stats["status"] == "ok"
        assert db.get(Movie, 8004).vote_average == pytest.approx(7.7)
        assert db.get(Collection, 80).avg_rating == pytest.approx(7.7)


# ── _rating_score ────────────────────────────────────────────────────────────


class TestRatingScore:
    TODAY = date(2026, 10, 9)

    def _part(self, avg, votes, release="2015-01-01"):
        return {"vote_average": avg, "vote_count": votes, "release_date": release}

    def test_few_votes_are_pulled_toward_the_typical_rating(self):
        """A 1-vote 9.0 used to top the rating sort above Lord of the Rings."""
        from app.services.collection_ingest_service import _rating_score
        one_vote = [self._part(9.0, 1)]
        lotr = [self._part(8.4, 28000), self._part(8.4, 24000), self._part(8.5, 27000)]
        assert _rating_score(lotr, self.TODAY) > _rating_score(one_vote, self.TODAY)
        # Big samples barely move: raw vote-weighted mean is ~8.43.
        assert _rating_score(lotr, self.TODAY) == pytest.approx(8.41, abs=0.01)

    def test_bayesian_average_of_released_parts(self):
        from app.services.collection_ingest_service import (
            _RATING_PRIOR_MEAN, _RATING_PRIOR_VOTES, _rating_score,
        )
        parts = [self._part(8.0, 1000), self._part(7.0, 3000)]
        expected = (_RATING_PRIOR_VOTES * _RATING_PRIOR_MEAN + 8.0 * 1000 + 7.0 * 3000) / (
            _RATING_PRIOR_VOTES + 4000
        )
        assert _rating_score(parts, self.TODAY) == pytest.approx(expected)

    def test_unreleased_and_unvoted_parts_are_ignored(self):
        from app.services.collection_ingest_service import _rating_score
        base = [self._part(8.0, 5000)]
        noisy = base + [self._part(10.0, 3, release="2027-01-01"), self._part(0.0, 0)]
        assert _rating_score(noisy, self.TODAY) == pytest.approx(_rating_score(base, self.TODAY))

    def test_none_without_any_votes(self):
        from app.services.collection_ingest_service import _rating_score
        assert _rating_score([self._part(0.0, 0)], self.TODAY) is None
        assert _rating_score([], self.TODAY) is None


# ── _popularity_score ────────────────────────────────────────────────────────


class TestPopularityScore:
    TODAY = date(2026, 10, 9)

    def _part(self, pop, votes, release="2015-01-01"):
        return {"popularity": pop, "vote_count": votes, "release_date": release}

    def test_geometric_mean_of_total_votes_and_total_popularity(self):
        from app.services.collection_ingest_service import _popularity_score
        parts = [self._part(10.0, 1000), self._part(20.0, 3000)]
        assert _popularity_score(parts, self.TODAY) == pytest.approx((4000 * 30) ** 0.5)

    def test_unreleased_parts_are_ignored(self):
        """Announced sequels have hype-driven popularity and no votes — they
        shouldn't move the franchise either way."""
        from app.services.collection_ingest_service import _popularity_score
        parts = [
            self._part(10.0, 100),
            self._part(500.0, 0, release="2027-05-01"),
            self._part(80.0, 0, release=""),  # no date yet
        ]
        assert _popularity_score(parts, self.TODAY) == pytest.approx((100 * 10) ** 0.5)

    def test_none_when_nothing_released(self):
        from app.services.collection_ingest_service import _popularity_score
        assert _popularity_score([self._part(50.0, 0, release="2027-01-01")], self.TODAY) is None
        assert _popularity_score([], self.TODAY) is None

    def test_big_franchise_beats_small_collection_riding_one_trending_film(self):
        """The old mean-of-popularity score ranked a 2-film collection with one
        trending entry above Harry Potter-sized franchises."""
        from app.services.collection_ingest_service import _popularity_score
        franchise = [self._part(25.0, 20000) for _ in range(8)]
        one_hit = [self._part(225.0, 3000), self._part(10.0, 500)]
        assert _popularity_score(franchise, self.TODAY) > _popularity_score(one_hit, self.TODAY)

    def test_long_obscure_series_does_not_beat_a_major_franchise(self):
        """Summing alone would let a 30-film niche series outrank a major one."""
        from app.services.collection_ingest_service import _popularity_score
        niche = [self._part(8.0, 300) for _ in range(30)]
        major = [self._part(30.0, 15000) for _ in range(3)]
        assert _popularity_score(major, self.TODAY) > _popularity_score(niche, self.TODAY)


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

    def test_url_is_https(self):
        from app.services.collection_ingest_service import _dump_url_for

        url = _dump_url_for(datetime(2024, 6, 15, 10, 0, tzinfo=timezone.utc))
        assert url.startswith("https://")

    def test_after_8am_uses_today(self):
        from app.services.collection_ingest_service import _dump_url_for

        url = _dump_url_for(datetime(2024, 6, 15, 10, 0, tzinfo=timezone.utc))
        assert "06_15_2024" in url


# ── _iter_latest_dump ────────────────────────────────────────────────────────


class TestIterLatestDump:
    """TMDb only promises the day's files "by 8:00 AM UTC"; older dumps stay up
    for 3 months, so yesterday's is a safe fallback."""

    NOW = datetime(2024, 6, 15, 8, 30, tzinfo=timezone.utc)

    def _records(self, url, recs, fail_on=None):
        import requests
        if fail_on and fail_on in url:
            raise requests.HTTPError("403 Forbidden")
        yield from recs

    def test_uses_todays_dump_when_available(self):
        from app.services.collection_ingest_service import _iter_latest_dump
        urls = []

        def fake(url):
            urls.append(url)
            return self._records(url, [{"id": 1}])

        with patch("app.services.collection_ingest_service._iter_dump_records", side_effect=fake):
            assert list(_iter_latest_dump(self.NOW)) == [{"id": 1}]
        assert len(urls) == 1 and "06_15_2024" in urls[0]

    def test_falls_back_to_yesterday_when_today_is_not_up_yet(self):
        from app.services.collection_ingest_service import _iter_latest_dump
        with patch(
            "app.services.collection_ingest_service._iter_dump_records",
            side_effect=lambda url: self._records(url, [{"id": 2, "url": url}], fail_on="06_15_2024"),
        ):
            recs = list(_iter_latest_dump(self.NOW))
        assert [r["id"] for r in recs] == [2]
        assert "06_14_2024" in recs[0]["url"]

    def test_failure_midway_through_the_dump_is_not_masked(self):
        """A partial read must raise — falling back (or pruning) on a half-read
        dump would be wrong."""
        import requests
        from app.services.collection_ingest_service import _iter_latest_dump

        def partial(url):
            yield {"id": 1}
            raise requests.ConnectionError("reset")

        with patch("app.services.collection_ingest_service._iter_dump_records", side_effect=partial):
            with pytest.raises(requests.ConnectionError):
                list(_iter_latest_dump(self.NOW))


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

    def test_index_sync_failure_still_refreshes_existing_collections(self, db):
        """A failed dump download used to abort the whole run, and the loop then
        waited until the next day."""
        from app.models.collection import Collection
        from app.services.collection_ingest_service import daily_refresh

        now = datetime.now(timezone.utc)
        db.add(Collection(id=1, name="A", details_refreshed_at=now))
        db.add(Collection(id=2, name="B", details_refreshed_at=now))
        db.commit()

        with patch(
            "app.services.collection_ingest_service.daily_sync",
            side_effect=RuntimeError("dump unavailable"),
        ), patch(
            "app.services.collection_ingest_service._parallel_ingest",
            return_value=(2, 0),
        ) as mock_ingest:
            result = daily_refresh(db, now_utc=now)

        assert mock_ingest.call_args[0][0] == [1, 2]
        assert result["collections_succeeded"] == 2


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
