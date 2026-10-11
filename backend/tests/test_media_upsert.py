"""
Tests for app.services.media_upsert.

Covers the parts that run on SQLite:
- ensure_movie_in_db / ensure_show_in_db cache-hit + cache-miss (with empty
  genres/providers so the PG-only ON CONFLICT path is bypassed)
- populate_movie_full
- get_us_movie_certification, get_us_show_certification, get_theatrical_release_date
- ensure_movie_stub_in_db / ensure_show_stub_in_db
- populate_movie_bg / populate_show_bg (cache-hit early return + missing TMDb data paths)

The genre/provider upsert helpers use sqlalchemy.dialects.postgresql.insert
with .on_conflict_do_nothing(), which only works on PostgreSQL. Tests that
would touch those code paths with non-empty genre/provider data are skipped.
"""

from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest


# ── Pure helper functions ──────────────────────────────────────────────────


class TestGetUsMovieCertification:
    def test_returns_none_when_no_results(self):
        from app.services.media_upsert import get_us_movie_certification
        assert get_us_movie_certification({}) is None
        assert get_us_movie_certification({"release_dates": {"results": []}}) is None

    def test_returns_none_when_no_us_entry(self):
        from app.services.media_upsert import get_us_movie_certification
        data = {"release_dates": {"results": [{"iso_3166_1": "GB",
                                                "release_dates": [
                                                    {"type": 3, "certification": "15"}
                                                ]}]}}
        assert get_us_movie_certification(data) is None

    def test_picks_us_certification(self):
        from app.services.media_upsert import get_us_movie_certification
        data = {"release_dates": {"results": [
            {"iso_3166_1": "US", "release_dates": [
                {"type": 3, "certification": "PG-13"},
            ]},
        ]}}
        assert get_us_movie_certification(data) == "PG-13"

    def test_prefers_higher_priority_type(self):
        """Type 3 (theatrical) is preferred over type 1 (premiere)."""
        from app.services.media_upsert import get_us_movie_certification
        data = {"release_dates": {"results": [
            {"iso_3166_1": "US", "release_dates": [
                {"type": 1, "certification": "G"},
                {"type": 3, "certification": "R"},
            ]},
        ]}}
        assert get_us_movie_certification(data) == "R"

    def test_skips_empty_certification(self):
        from app.services.media_upsert import get_us_movie_certification
        data = {"release_dates": {"results": [
            {"iso_3166_1": "US", "release_dates": [
                {"type": 3, "certification": ""},
            ]},
        ]}}
        assert get_us_movie_certification(data) is None


class TestGetUsShowCertification:
    def test_returns_none_when_no_results(self):
        from app.services.media_upsert import get_us_show_certification
        assert get_us_show_certification({}) is None
        assert get_us_show_certification({"content_ratings": {"results": []}}) is None

    def test_returns_us_rating(self):
        from app.services.media_upsert import get_us_show_certification
        data = {"content_ratings": {"results": [
            {"iso_3166_1": "GB", "rating": "15"},
            {"iso_3166_1": "US", "rating": "TV-MA"},
        ]}}
        assert get_us_show_certification(data) == "TV-MA"

    def test_returns_none_when_us_rating_empty(self):
        from app.services.media_upsert import get_us_show_certification
        data = {"content_ratings": {"results": [
            {"iso_3166_1": "US", "rating": ""},
        ]}}
        assert get_us_show_certification(data) is None


class TestGetTheatricalReleaseDate:
    def test_falls_back_to_top_level_release_date(self):
        from app.services.media_upsert import get_theatrical_release_date
        # Function returns the value as-is; pass a string to preserve the round-trip.
        data = {"release_date": "2020-05-05",
                "release_dates": {"results": []}}
        assert get_theatrical_release_date(data) == "2020-05-05"

    def test_no_data_returns_none(self):
        from app.services.media_upsert import get_theatrical_release_date
        assert get_theatrical_release_date({}) is None

    def test_picks_us_theatrical_date(self):
        from app.services.media_upsert import get_theatrical_release_date
        data = {"release_dates": {"results": [
            {"iso_3166_1": "US", "release_dates": [
                {"type": 3, "release_date": "2024-06-21T00:00:00.000Z"},
            ]},
        ]}}
        assert get_theatrical_release_date(data) == "2024-06-21"

    def test_prefers_theatrical_over_premiere(self):
        from app.services.media_upsert import get_theatrical_release_date
        data = {"release_dates": {"results": [
            {"iso_3166_1": "US", "release_dates": [
                {"type": 1, "release_date": "2024-01-01T00:00:00.000Z"},
                {"type": 3, "release_date": "2024-06-21T00:00:00.000Z"},
            ]},
        ]}}
        assert get_theatrical_release_date(data) == "2024-06-21"


# ── ensure_movie_in_db ─────────────────────────────────────────────────────


class TestEnsureMovieInDb:
    def test_cache_hit_no_fetch(self, db, seed_movie):
        """When the Movie row exists, no TMDb call is made."""
        from app.services.media_upsert import ensure_movie_in_db
        with patch("app.services.media_upsert.fetch_movie_from_tmdb") as fetch:
            movie = ensure_movie_in_db(db, 550)
            assert movie.id == 550
            fetch.assert_not_called()

    def test_cache_miss_fetches_and_creates(self, db):
        """Cache miss with empty genres/providers — avoids PG-only upsert path."""
        from app.services.media_upsert import ensure_movie_in_db
        from app.models.movie import Movie

        movie_data = {
            "id": 999,
            "title": "New Movie",
            "imdb_id": "tt9999999",
            "backdrop_path": "/bd.jpg",
            "poster_path": "/p.jpg",
            "overview": "Plot",
            "tagline": "Tag",
            "homepage": "http://e.com",
            "budget": 1000,
            "revenue": 5000,
            "runtime": 99,
            "status": "Released",
            "vote_average": 8.0,
            "release_date": date(2024, 1, 1),
            "genres": [],
            "release_dates": {"results": []},
            "watch/providers": {"results": {}},
            "images": {"logos": []},
        }
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value=movie_data) as fetch:
            movie = ensure_movie_in_db(db, 999)
            fetch.assert_called_once()
        db.commit()
        assert movie.id == 999
        assert movie.title == "New Movie"
        assert movie.tracking_count == 0
        assert movie.updated_at is not None
        # Verify it actually landed in the DB
        assert db.query(Movie).filter_by(id=999).first() is not None

    def test_cache_miss_picks_english_logo(self, db):
        from app.services.media_upsert import ensure_movie_in_db
        movie_data = {
            "id": 998,
            "title": "Logo Movie",
            "genres": [],
            "release_dates": {"results": []},
            "watch/providers": {"results": {}},
            "images": {"logos": [
                {"iso_639_1": "fr", "file_path": "/fr.png"},
                {"iso_639_1": "en", "file_path": "/en.png"},
            ]},
        }
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value=movie_data):
            movie = ensure_movie_in_db(db, 998)
        assert movie.logo_path == "/en.png"

    def test_cache_miss_no_english_logo(self, db):
        from app.services.media_upsert import ensure_movie_in_db
        movie_data = {
            "id": 997,
            "title": "NoEnglish",
            "genres": [],
            "release_dates": {"results": []},
            "watch/providers": {"results": {}},
            "images": {"logos": [{"iso_639_1": "fr", "file_path": "/fr.png"}]},
        }
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value=movie_data):
            movie = ensure_movie_in_db(db, 997)
        assert movie.logo_path is None

    def test_cache_miss_no_title_raises(self, db):
        from app.services.media_upsert import ensure_movie_in_db
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value={"id": 996}):
            with pytest.raises(ValueError, match="title"):
                ensure_movie_in_db(db, 996)

    def test_cache_miss_empty_response_raises(self, db):
        from app.services.media_upsert import ensure_movie_in_db
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value=None):
            with pytest.raises(ValueError):
                ensure_movie_in_db(db, 995)


# ── ensure_show_in_db ──────────────────────────────────────────────────────


class TestEnsureShowInDb:
    def test_cache_hit_no_fetch(self, db, seed_show):
        from app.services.media_upsert import ensure_show_in_db
        with patch("app.services.media_upsert.fetch_show_from_tmdb") as fetch:
            show = ensure_show_in_db(db, 1396)
            assert show.id == 1396
            fetch.assert_not_called()

    def test_cache_miss_fetches_and_creates(self, db):
        from app.services.media_upsert import ensure_show_in_db
        from app.models.show import Show

        show_data = {
            "id": 8888,
            "name": "New Show",
            "backdrop_path": "/bd.jpg",
            "poster_path": "/p.jpg",
            "overview": "Plot",
            "tagline": "Tag",
            "homepage": "http://s.com",
            "in_production": True,
            "number_of_seasons": 3,
            "number_of_episodes": 30,
            "status": "Returning Series",
            "type": "Scripted",
            "first_air_date": date(2020, 1, 1),
            "last_air_date": date(2024, 1, 1),
            "vote_average": 9.0,
            "genres": [],
            "seasons": [],
            "watch/providers": {"results": {}},
            "images": {"logos": []},
            "content_ratings": {"results": []},
        }
        with patch("app.services.media_upsert.fetch_show_from_tmdb",
                   return_value=show_data) as fetch, \
             patch("app.services.media_upsert.fetch_show_air_time",
                   return_value=("20:00", "America/New_York")):
            show = ensure_show_in_db(db, 8888)
            fetch.assert_called_once()
        db.commit()
        assert show.id == 8888
        assert show.name == "New Show"
        assert show.tracking_count == 0
        assert show.air_time == "20:00"
        assert show.air_timezone == "America/New_York"
        assert show.updated_at is not None
        assert db.query(Show).filter_by(id=8888).first() is not None

    def test_cache_miss_creates_seasons(self, db):
        from app.services.media_upsert import ensure_show_in_db
        from app.models.season import Season

        show_data = {
            "id": 8887,
            "name": "Show With Seasons",
            "genres": [],
            "seasons": [
                {"id": 7001, "season_number": 1, "name": "S1", "episode_count": 10},
                {"id": 7002, "season_number": 2, "name": "S2", "episode_count": 8},
            ],
            "watch/providers": {"results": {}},
            "images": {"logos": []},
            "content_ratings": {"results": []},
        }
        with patch("app.services.media_upsert.fetch_show_from_tmdb",
                   return_value=show_data), \
             patch("app.services.media_upsert.fetch_show_air_time",
                   return_value=(None, None)):
            ensure_show_in_db(db, 8887)
        db.commit()
        seasons = db.query(Season).filter_by(show_id=8887).all()
        assert len(seasons) == 2
        assert {s.id for s in seasons} == {7001, 7002}

    def test_cache_miss_no_name_raises(self, db):
        from app.services.media_upsert import ensure_show_in_db
        with patch("app.services.media_upsert.fetch_show_from_tmdb",
                   return_value={"id": 1}), \
             patch("app.services.media_upsert.fetch_show_air_time",
                   return_value=(None, None)):
            with pytest.raises(ValueError, match="name"):
                ensure_show_in_db(db, 1)

    def test_cache_miss_empty_response_raises(self, db):
        from app.services.media_upsert import ensure_show_in_db
        with patch("app.services.media_upsert.fetch_show_from_tmdb",
                   return_value=None):
            with pytest.raises(ValueError):
                ensure_show_in_db(db, 2)


# ── populate_movie_full ────────────────────────────────────────────────────


class TestPopulateMovieFull:
    def test_existing_populated_returns_unchanged(self, db, seed_movie):
        """A row with updated_at set is returned without a TMDb call."""
        from app.services.media_upsert import populate_movie_full

        seed_movie.updated_at = datetime.now(timezone.utc)
        db.commit()
        with patch("app.services.media_upsert.fetch_movie_from_tmdb") as fetch:
            result = populate_movie_full(db, 550)
            fetch.assert_not_called()
        assert result is seed_movie

    @staticmethod
    def _movie_payload(title):
        return {
            "id": 550,
            "title": title,
            "genres": [],
            "release_dates": {"results": []},
            "watch/providers": {"results": {}},
            "images": {"logos": []},
        }

    def test_force_refetches_even_when_populated(self, db, seed_movie):
        from app.services.media_upsert import populate_movie_full
        seed_movie.updated_at = datetime.now(timezone.utc)
        db.commit()
        with patch("app.services.tmdb_movies.get",
                   return_value=self._movie_payload("Replaced")) as get:
            result = populate_movie_full(db, 550, force=True)
            get.assert_called_once()
        assert result.title == "Replaced"

    def test_force_ignores_the_route_cache(self, db, seed_movie):
        """A forced refresh that read through the user-facing movie cache would
        get the copy a page view cached earlier, so changes would not land."""
        from app.services.media_upsert import populate_movie_full
        from app.services.tmdb_movies import (
            _fetch_movie_from_tmdb_cached,
            fetch_movie_from_tmdb_cached,
        )

        seed_movie.updated_at = datetime.now(timezone.utc)
        db.commit()
        _fetch_movie_from_tmdb_cached.cache_clear()
        try:
            with patch("app.services.tmdb_movies.get", return_value=self._movie_payload("Old")):
                fetch_movie_from_tmdb_cached(550, "watch/providers,release_dates,images")
            with patch("app.services.tmdb_movies.get", return_value=self._movie_payload("New")):
                result = populate_movie_full(db, 550, force=True)
        finally:
            _fetch_movie_from_tmdb_cached.cache_clear()
        assert result.title == "New"

    def test_missing_row_creates_new(self, db):
        from app.services.media_upsert import populate_movie_full
        from app.models.movie import Movie

        movie_data = {
            "id": 4242,
            "title": "Brand New",
            "genres": [],
            "release_dates": {"results": []},
            "watch/providers": {"results": {}},
            "images": {"logos": []},
        }
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value=movie_data):
            result = populate_movie_full(db, 4242)
        db.commit()
        assert result is not None
        assert result.id == 4242
        assert result.tracking_count == 0  # backfill does not bump tracking
        assert db.query(Movie).filter_by(id=4242).first() is not None

    def test_returns_none_when_tmdb_empty(self, db):
        from app.services.media_upsert import populate_movie_full
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value=None):
            assert populate_movie_full(db, 5555) is None

    def test_returns_none_when_no_title(self, db):
        from app.services.media_upsert import populate_movie_full
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value={"id": 5555}):
            assert populate_movie_full(db, 5555) is None

    def test_returns_none_for_adult(self, db):
        from app.services.media_upsert import populate_movie_full
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value={"id": 5555, "title": "X", "adult": True}):
            assert populate_movie_full(db, 5555) is None

    def test_stub_row_gets_filled(self, db):
        from app.services.media_upsert import populate_movie_full
        from app.models.movie import Movie

        stub = Movie(id=4243, tracking_count=1, updated_at=None)
        db.add(stub)
        db.commit()
        movie_data = {
            "id": 4243,
            "title": "Filled",
            "genres": [],
            "release_dates": {"results": []},
            "watch/providers": {"results": {}},
            "images": {"logos": []},
        }
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value=movie_data):
            result = populate_movie_full(db, 4243)
        assert result.title == "Filled"
        assert result.updated_at is not None


# ── ensure_*_stub_in_db ────────────────────────────────────────────────────


class TestEnsureStubInDb:
    def test_movie_stub_inserts_minimal_row(self, db):
        from app.services.media_upsert import ensure_movie_stub_in_db
        from app.models.movie import Movie

        stub = ensure_movie_stub_in_db(db, 12345)
        assert stub.id == 12345
        assert stub.tracking_count == 0
        assert stub.updated_at is None
        db.commit()
        assert db.query(Movie).filter_by(id=12345).first() is not None

    def test_movie_stub_existing_returns_existing(self, db, seed_movie):
        from app.services.media_upsert import ensure_movie_stub_in_db
        result = ensure_movie_stub_in_db(db, 550)
        assert result.id == 550
        assert result.title == "Fight Club"

    def test_show_stub_inserts_minimal_row(self, db):
        from app.services.media_upsert import ensure_show_stub_in_db
        from app.models.show import Show

        stub = ensure_show_stub_in_db(db, 54321)
        assert stub.id == 54321
        assert stub.name == ""
        assert stub.tracking_count == 0
        assert stub.updated_at is None
        db.commit()
        assert db.query(Show).filter_by(id=54321).first() is not None

    def test_show_stub_existing_returns_existing(self, db, seed_show):
        from app.services.media_upsert import ensure_show_stub_in_db
        result = ensure_show_stub_in_db(db, 1396)
        assert result.id == 1396
        assert result.name == "Breaking Bad"


# ── populate_*_bg background tasks ─────────────────────────────────────────


class TestPopulateBgEarlyReturns:
    """These background tasks open their own SessionLocal; the conftest patches
    SessionLocal to the test engine so they can read the seeded rows."""

    def test_populate_movie_bg_missing_row_noop(self):
        from app.services.media_upsert import populate_movie_bg
        with patch("app.services.media_upsert.fetch_movie_from_tmdb") as fetch:
            populate_movie_bg(99999)
            fetch.assert_not_called()

    def test_populate_movie_bg_already_populated_noop(self, db, seed_movie):
        from app.services.media_upsert import populate_movie_bg
        seed_movie.updated_at = datetime.now(timezone.utc)
        db.commit()
        with patch("app.services.media_upsert.fetch_movie_from_tmdb") as fetch:
            populate_movie_bg(550)
            fetch.assert_not_called()

    def test_populate_show_bg_missing_row_noop(self):
        from app.services.media_upsert import populate_show_bg
        with patch("app.services.media_upsert.fetch_show_from_tmdb") as fetch:
            populate_show_bg(99999)
            fetch.assert_not_called()

    def test_populate_show_bg_already_populated_noop(self, db, seed_show):
        from app.services.media_upsert import populate_show_bg
        seed_show.updated_at = datetime.now(timezone.utc)
        db.commit()
        with patch("app.services.media_upsert.fetch_show_from_tmdb") as fetch:
            populate_show_bg(1396)
            fetch.assert_not_called()

    def test_populate_movie_bg_empty_tmdb_response(self, db):
        """Stub row exists but TMDb returns nothing — should leave stub alone."""
        from app.services.media_upsert import populate_movie_bg
        from app.models.movie import Movie
        stub = Movie(id=70001, tracking_count=1, updated_at=None)
        db.add(stub)
        db.commit()
        with patch("app.services.media_upsert.fetch_movie_from_tmdb", return_value=None):
            populate_movie_bg(70001)
        db.expire_all()
        row = db.query(Movie).filter_by(id=70001).first()
        assert row is not None
        assert row.updated_at is None

    def test_populate_movie_bg_no_title_in_response(self, db):
        from app.services.media_upsert import populate_movie_bg
        from app.models.movie import Movie
        stub = Movie(id=70002, tracking_count=1, updated_at=None)
        db.add(stub)
        db.commit()
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value={"id": 70002}):
            populate_movie_bg(70002)
        db.expire_all()
        row = db.query(Movie).filter_by(id=70002).first()
        assert row.updated_at is None

    def test_populate_show_bg_empty_tmdb_response(self, db):
        from app.services.media_upsert import populate_show_bg
        from app.models.show import Show
        stub = Show(id=80001, name="", tracking_count=1, updated_at=None)
        db.add(stub)
        db.commit()
        with patch("app.services.media_upsert.fetch_show_from_tmdb", return_value=None):
            populate_show_bg(80001)
        db.expire_all()
        row = db.query(Show).filter_by(id=80001).first()
        assert row is not None
        assert row.updated_at is None

    def test_populate_movie_bg_fills_stub_row(self, db):
        """End-to-end: stub → fully populated, with empty genres/providers
        so we don't hit the PG-only upsert path."""
        from app.services.media_upsert import populate_movie_bg
        from app.models.movie import Movie

        stub = Movie(id=70003, tracking_count=1, updated_at=None)
        db.add(stub)
        db.commit()

        movie_data = {
            "id": 70003,
            "title": "Filled BG",
            "overview": "ov",
            "genres": [],
            "release_dates": {"results": []},
            "watch/providers": {"results": {}},
            "images": {"logos": []},
        }
        with patch("app.services.media_upsert.fetch_movie_from_tmdb",
                   return_value=movie_data):
            populate_movie_bg(70003)
        db.expire_all()
        row = db.query(Movie).filter_by(id=70003).first()
        assert row.title == "Filled BG"
        assert row.updated_at is not None


# ── Genre / provider upsert helpers ────────────────────────────────────────


@pytest.mark.skip(reason="PG-only syntax: uses sqlalchemy.dialects.postgresql.insert with on_conflict_do_nothing")
class TestUpsertGenresAndProvidersPgOnly:
    """_upsert_genres and _upsert_providers issue PG-specific INSERT ... ON
    CONFLICT statements which fail on SQLite. They are exercised in production
    via ensure_*_in_db with non-empty TMDb payloads; covering them properly
    would require a real PostgreSQL test database."""

    def test_upsert_genres_creates_links(self):
        pass

    def test_upsert_providers_canonicalizes_ids(self):
        pass

    def test_ensure_movie_in_db_full_payload(self):
        pass

    def test_ensure_show_in_db_full_payload(self):
        pass


# ── TMDb quirks / write ordering ───────────────────────────────────────────


class TestPopulateShowBgEmptyDates:
    def test_empty_air_dates_still_populate_the_show(self, db):
        # TMDb sends "" (not null) for unknown dates on unaired shows; writing
        # "" to a DATE column failed the whole populate and left a nameless stub.
        from app.services.media_upsert import populate_show_bg
        from app.models.show import Show

        db.add(Show(id=80002, name="", tracking_count=1, updated_at=None))
        db.commit()
        show_data = {
            "id": 80002, "name": "Untitled Pilot", "first_air_date": "",
            "last_air_date": "", "genres": [], "seasons": [],
            "watch/providers": {"results": {}}, "images": {"logos": []},
            "content_ratings": {"results": []},
        }
        with patch("app.services.media_upsert.fetch_show_from_tmdb", return_value=show_data), \
             patch("app.services.media_upsert.fetch_show_air_time", return_value=(None, None)), \
             patch("app.services.episode_service.sync_show_episodes"):
            populate_show_bg(80002)

        db.expire_all()
        row = db.query(Show).filter_by(id=80002).one()
        assert row.name == "Untitled Pilot"
        assert row.first_air_date is None


class TestUpsertWriteOrder:
    """Concurrent ingests that lock the same Provider/Genre rows in different
    orders deadlock in Postgres. Writing rows in ascending id order means two
    transactions always take the locks in the same order."""

    def _inserted_ids(self, statements, table):
        ids = []
        for sql, params in statements:
            if sql.lstrip().upper().startswith(f"INSERT INTO {table.upper()} "):
                ids.extend(p for p in params if isinstance(p, int))
        return ids

    def _capture(self):
        from sqlalchemy import event
        from tests.conftest import engine

        statements = []

        def hook(conn, cursor, statement, parameters, context, executemany):
            rows = parameters if executemany else [parameters]
            for row in rows:
                statements.append((statement, list(row)))

        event.listen(engine, "before_cursor_execute", hook)
        return statements, lambda: event.remove(engine, "before_cursor_execute", hook)

    def test_providers_written_in_id_order(self, db, seed_movie):
        from app.services.media_upsert import _upsert_providers
        from app.models.provider import MovieProvider

        us = {
            "flatrate": [
                {"provider_id": 337, "provider_name": "Disney Plus", "logo_path": "/d.png"},
                {"provider_id": 8, "provider_name": "Netflix", "logo_path": "/n.png"},
                {"provider_id": 15, "provider_name": "Hulu", "logo_path": "/h.png"},
            ],
        }
        statements, stop = self._capture()
        try:
            _upsert_providers(db, us, MovieProvider, movie_id=550)
            db.flush()
        finally:
            stop()

        provider_ids = [i for i in self._inserted_ids(statements, "provider") if i in (8, 15, 337)]
        link_ids = [i for i in self._inserted_ids(statements, "movie_provider") if i in (8, 15, 337)]
        assert provider_ids == [8, 15, 337]
        assert link_ids == [8, 15, 337]

    def test_genres_written_in_id_order(self, db, seed_movie):
        from app.services.media_upsert import _upsert_genres
        from app.models.genre import MovieGenre

        statements, stop = self._capture()
        try:
            _upsert_genres(
                db,
                [{"id": 878, "name": "Science Fiction"}, {"id": 18, "name": "Drama"},
                 {"id": 53, "name": "Thriller"}],
                MovieGenre, movie_id=550,
            )
        finally:
            stop()

        genre_ids = [i for i in self._inserted_ids(statements, "genre") if i in (18, 53, 878)]
        assert genre_ids == [18, 53, 878]
