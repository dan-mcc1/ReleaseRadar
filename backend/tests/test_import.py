"""
Tests for the Letterboxd CSV/ZIP import endpoint.

Splits into:
  - Pure helpers (parsing, zip extraction, row collection, TMDB result picking)
    which we test directly.
  - End-to-end endpoint tests with the two TMDB seams mocked
    (`_find_tmdb_result` + the media upsert helpers).
"""

import io
import zipfile
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from app.routers import import_router as ir


# ── Pure helpers ──────────────────────────────────────────────────────────


class TestParseLetterboxdRating:
    @pytest.mark.parametrize("raw,expected", [
        ("", None),
        ("   ", None),
        ("not-a-number", None),
        ("0", None),       # below 0.5
        ("5.5", None),     # above 5.0
        ("0.5", 0.5),
        ("5", 5.0),
        ("3.3", 3.5),      # rounds to nearest 0.5
        ("3.7", 3.5),
        ("3.8", 4.0),
        ("  4  ", 4.0),
    ])
    def test_various(self, raw, expected):
        assert ir._parse_letterboxd_rating(raw) == expected


class TestParseDate:
    def test_iso_format(self):
        d = ir._parse_date("2026-05-25")
        assert d == datetime(2026, 5, 25, tzinfo=timezone.utc)

    def test_letterboxd_diary_format(self):
        d = ir._parse_date("25 May 2026")
        assert d == datetime(2026, 5, 25, tzinfo=timezone.utc)

    def test_long_format(self):
        d = ir._parse_date("May 25, 2026")
        assert d == datetime(2026, 5, 25, tzinfo=timezone.utc)

    def test_unparseable_returns_none(self):
        assert ir._parse_date("garbage") is None

    def test_empty_returns_none(self):
        assert ir._parse_date("") is None


class TestFindTmdbResult:
    def test_returns_none_when_nothing_found(self):
        with patch.object(ir, "search_movies", return_value=[]), \
             patch.object(ir, "get_tv_search_results", return_value=[]):
            assert ir._find_tmdb_result("Nothing", 2020) is None

    def test_year_exact_match_movie_wins(self):
        movies = [
            {"id": 1, "release_date": "2010-01-01", "popularity": 5},
            {"id": 2, "release_date": "2020-01-01", "popularity": 1},
        ]
        with patch.object(ir, "search_movies", return_value=movies), \
             patch.object(ir, "get_tv_search_results", return_value=[]):
            assert ir._find_tmdb_result("X", 2020) == (2, "movie")

    def test_year_exact_match_tv_wins(self):
        tvs = [{"id": 99, "first_air_date": "2020-06-01", "popularity": 1}]
        with patch.object(ir, "search_movies", return_value=[]), \
             patch.object(ir, "get_tv_search_results", return_value=tvs):
            assert ir._find_tmdb_result("X", 2020) == (99, "tv")

    def test_no_year_picks_most_popular_across_types(self):
        movies = [{"id": 1, "release_date": "2010-01-01", "popularity": 5}]
        tvs = [{"id": 99, "first_air_date": "2020-06-01", "popularity": 50}]
        with patch.object(ir, "search_movies", return_value=movies), \
             patch.object(ir, "get_tv_search_results", return_value=tvs):
            assert ir._find_tmdb_result("X", None) == (99, "tv")

    def test_movie_only_fallback(self):
        movies = [{"id": 7, "release_date": "2010-01-01", "popularity": 1}]
        with patch.object(ir, "search_movies", return_value=movies), \
             patch.object(ir, "get_tv_search_results", return_value=[]):
            assert ir._find_tmdb_result("X", None) == (7, "movie")


class TestExtractCsvsFromZip:
    def _make_zip(self, files: dict[str, str]) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for name, content in files.items():
                zf.writestr(name, content)
        return buf.getvalue()

    def test_extracts_csv_files(self):
        zb = self._make_zip({
            "watched.csv": "Name,Year\nFight Club,1999",
            "diary.csv": "Name,Year\nDune,2021",
            "README.txt": "ignore me",
        })
        out = ir._extract_csvs_from_zip(zb)
        assert set(out.keys()) == {"watched.csv", "diary.csv"}
        assert "Fight Club" in out["watched.csv"]

    def test_strips_directory_prefix(self):
        zb = self._make_zip({"letterboxd/watched.csv": "Name\nThe Matrix"})
        out = ir._extract_csvs_from_zip(zb)
        assert "watched.csv" in out

    def test_invalid_zip_raises_422(self):
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc:
            ir._extract_csvs_from_zip(b"not a zip")
        assert exc.value.status_code == 422


class TestCollectRows:
    def test_collects_basic_rows(self):
        csv_text = "Name,Year,Rating,Watched Date\nFight Club,1999,4.5,2025-01-15\n"
        rows = ir._collect_rows([csv_text], "watched", max_rows=100)
        assert len(rows) == 1
        r = rows[0]
        assert r["name"] == "Fight Club"
        assert r["year"] == 1999
        assert r["rating"] == 4.5
        assert r["watched_at"] == datetime(2025, 1, 15, tzinfo=timezone.utc)
        assert r["kind"] == "watched"
        assert r["row_num"] == 2  # row 1 is the header

    def test_falls_back_to_title_and_date_columns(self):
        csv_text = "Title,Year,Date\nDune,2021,2021-10-22\n"
        rows = ir._collect_rows([csv_text], "watchlist", max_rows=100)
        assert rows[0]["name"] == "Dune"
        assert rows[0]["watched_at"].year == 2021

    def test_respects_max_rows(self):
        body = "Name,Year\n" + "\n".join(f"m{i},2020" for i in range(50))
        rows = ir._collect_rows([body], "watched", max_rows=10)
        assert len(rows) == 10

    def test_non_numeric_year_becomes_none(self):
        csv_text = "Name,Year\nFoo,not-a-year\n"
        rows = ir._collect_rows([csv_text], "watched", max_rows=10)
        assert rows[0]["year"] is None

    def test_blank_date_defaults_to_now(self):
        csv_text = "Name,Year\nFoo,2020\n"
        rows = ir._collect_rows([csv_text], "watched", max_rows=10)
        # No Watched Date / Date column → defaults to now()
        assert rows[0]["watched_at"] is not None


# ── Endpoint integration ──────────────────────────────────────────────────


def _csv_upload(client, body: str, filename: str = "watched.csv"):
    return client.post(
        "/import/letterboxd",
        files={"file": (filename, body.encode("utf-8"), "text/csv")},
    )


def _zip_upload(client, files: dict[str, str], filename: str = "letterboxd.zip"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return client.post(
        "/import/letterboxd",
        files={"file": (filename, buf.getvalue(), "application/zip")},
    )


@pytest.fixture
def mock_tmdb_and_upsert():
    """Mocks the TMDB seams and the media-upsert helpers so import tests
    don't hit the network or require a real movie/show row.

    Yields a dict the test can mutate to control which calls return what.
    """
    config = {
        # name -> (tmdb_id, media_type) or None
        "search": {},
        # tmdb_ids that ensure_*_in_db should succeed for
        "movies": {},
        "shows": {},
    }

    def fake_find(name, year):
        return config["search"].get(name)

    def fake_ensure_movie(db, tmdb_id, already_tracked):
        from app.models.movie import Movie
        existing = db.query(Movie).filter_by(id=tmdb_id).first()
        if existing:
            return existing
        title = config["movies"].get(tmdb_id, f"Movie {tmdb_id}")
        m = Movie(id=tmdb_id, title=title, status="Released", tracking_count=0,
                  vote_average=7.0)
        db.add(m)
        db.flush()
        return m

    def fake_ensure_show(db, tmdb_id, already_tracked):
        from app.models.show import Show
        existing = db.query(Show).filter_by(id=tmdb_id).first()
        if existing:
            return existing
        name = config["shows"].get(tmdb_id, f"Show {tmdb_id}")
        s = Show(id=tmdb_id, name=name, status="Returning Series",
                 tracking_count=0, vote_average=7.0)
        db.add(s)
        db.flush()
        return s

    with patch.object(ir, "_find_tmdb_result", side_effect=fake_find), \
         patch.object(ir, "ensure_movie_in_db", side_effect=fake_ensure_movie), \
         patch.object(ir, "ensure_show_in_db", side_effect=fake_ensure_show), \
         patch.object(ir, "fetch_movie_from_tmdb", return_value=None), \
         patch.object(ir, "fetch_show_from_tmdb", return_value=None), \
         patch.object(ir, "maybe_sync_show_episodes", return_value=None):
        yield config


class TestImportEndpointValidation:
    def test_rejects_non_csv_non_zip(self, client, seed_users):
        r = client.post(
            "/import/letterboxd",
            files={"file": ("photo.png", b"PNG", "image/png")},
        )
        assert r.status_code == 422

    def test_rejects_oversize_file(self, client, seed_users):
        big = b"x" * (ir._MAX_FILE_BYTES + 1)
        r = client.post(
            "/import/letterboxd",
            files={"file": ("watched.csv", big, "text/csv")},
        )
        assert r.status_code == 413

    def test_rejects_zip_with_no_csv(self, client, seed_users):
        r = _zip_upload(client, {"README.txt": "nothing here"})
        assert r.status_code == 422


class TestImportEndpoint:
    def test_imports_watched_movie(self, client, seed_users, mock_tmdb_and_upsert):
        mock_tmdb_and_upsert["search"]["Fight Club"] = (550, "movie")
        mock_tmdb_and_upsert["movies"][550] = "Fight Club"

        csv_text = "Name,Year,Rating,Watched Date\nFight Club,1999,4.5,2025-01-15\n"
        r = _csv_upload(client, csv_text, "watched.csv")
        assert r.status_code == 200

        data = r.json()
        assert data["summary"]["imported"] == 1
        assert data["summary"]["failed"] == 0
        assert data["results"][0]["status"] == "imported"
        assert data["results"][0]["rating"] == 4.5

    def test_imports_tv_show(self, client, seed_users, mock_tmdb_and_upsert):
        mock_tmdb_and_upsert["search"]["Breaking Bad"] = (1396, "tv")
        mock_tmdb_and_upsert["shows"][1396] = "Breaking Bad"

        csv_text = "Name,Year\nBreaking Bad,2008\n"
        r = _csv_upload(client, csv_text, "watched.csv")
        assert r.json()["summary"]["imported"] == 1

    def test_imports_to_watchlist(self, client, seed_users, mock_tmdb_and_upsert):
        mock_tmdb_and_upsert["search"]["Dune"] = (438631, "movie")

        csv_text = "Name,Year\nDune,2021\n"
        r = _csv_upload(client, csv_text, "watchlist.csv")
        assert r.status_code == 200
        data = r.json()
        assert data["summary"]["watchlisted"] == 1
        assert data["summary"]["imported"] == 0

    def test_unfound_title_marked_failed(
        self, client, seed_users, mock_tmdb_and_upsert
    ):
        # search returns nothing → row is failed
        csv_text = "Name,Year\nNonexistent Title,2020\n"
        r = _csv_upload(client, csv_text, "watched.csv")
        data = r.json()
        assert data["summary"]["failed"] == 1
        assert data["results"][0]["reason"] == "not found on TMDB"

    def test_blank_title_skipped(self, client, seed_users, mock_tmdb_and_upsert):
        csv_text = "Name,Year\n,2020\n"
        r = _csv_upload(client, csv_text, "watched.csv")
        data = r.json()
        assert data["summary"]["skipped"] == 1
        assert data["results"][0]["reason"] == "no title"

    def test_duplicate_in_import_skipped(
        self, client, seed_users, mock_tmdb_and_upsert
    ):
        mock_tmdb_and_upsert["search"]["Fight Club"] = (550, "movie")

        csv_text = (
            "Name,Year\n"
            "Fight Club,1999\n"
            "Fight Club,1999\n"
        )
        r = _csv_upload(client, csv_text, "watched.csv")
        data = r.json()
        assert data["summary"]["imported"] == 1
        assert data["summary"]["skipped"] == 1

    def test_already_in_watched_skipped(
        self, client, seed_users, mock_tmdb_and_upsert, db, seed_movie
    ):
        from app.models.watched import Watched
        mock_tmdb_and_upsert["search"]["Fight Club"] = (550, "movie")
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        csv_text = "Name,Year\nFight Club,1999\n"
        r = _csv_upload(client, csv_text, "watched.csv")
        data = r.json()
        assert data["summary"]["skipped"] == 1
        assert data["results"][0]["reason"] == "already in watched"

    def test_watchlist_skips_if_already_watched(
        self, client, seed_users, mock_tmdb_and_upsert, db, seed_movie
    ):
        from app.models.watched import Watched
        mock_tmdb_and_upsert["search"]["Fight Club"] = (550, "movie")
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()

        csv_text = "Name,Year\nFight Club,1999\n"
        r = _csv_upload(client, csv_text, "watchlist.csv")
        data = r.json()
        assert data["summary"]["skipped"] == 1

    def test_zip_with_watched_and_watchlist(
        self, client, seed_users, mock_tmdb_and_upsert
    ):
        mock_tmdb_and_upsert["search"]["Fight Club"] = (550, "movie")
        mock_tmdb_and_upsert["search"]["Dune"] = (438631, "movie")

        r = _zip_upload(client, {
            "watched.csv": "Name,Year\nFight Club,1999\n",
            "watchlist.csv": "Name,Year\nDune,2021\n",
        })
        assert r.status_code == 200
        data = r.json()
        assert data["summary"]["imported"] == 1
        assert data["summary"]["watchlisted"] == 1

    def test_results_sorted_by_row(self, client, seed_users, mock_tmdb_and_upsert):
        mock_tmdb_and_upsert["search"]["A"] = (1, "movie")
        mock_tmdb_and_upsert["search"]["B"] = (2, "movie")
        mock_tmdb_and_upsert["search"]["C"] = (3, "movie")

        csv_text = "Name,Year\nA,2000\nB,2001\nC,2002\n"
        r = _csv_upload(client, csv_text, "watched.csv")
        rows = r.json()["results"]
        assert [row["row"] for row in rows] == [2, 3, 4]


# ── TV Time import ─────────────────────────────────────────────────────────


class TestTvTimeHelpers:
    @pytest.mark.parametrize("raw,expected", [
        ("", None),
        ("garbage", None),
        ("4", 4.0),
        ("8", 4.0),       # 0-10 scale → /2
        ("9", 4.5),
        ("10", 5.0),
        ("3.7", 3.5),     # rounds to nearest half (3.7 -> 3.5)
        ("3.8", 4.0),     # 3.8 -> 4.0
        ("0", None),      # below 0.5 floor
        ("11", None),     # above range
    ])
    def test_parse_tvtime_rating(self, raw, expected):
        assert ir._parse_tvtime_rating(raw) == expected

    def test_parse_tvtime_date_iso(self):
        d = ir._parse_tvtime_date("2025-08-12T18:30:00Z")
        assert d.year == 2025 and d.month == 8 and d.day == 12

    def test_parse_tvtime_date_blank_defaults_to_now(self):
        d = ir._parse_tvtime_date("")
        assert d is not None

    def test_first_picks_first_non_empty(self):
        row = {"show_name": "Foo", "title": "", "name": "Bar"}
        assert ir._first(row, ("title", "show_name", "name")) == "Foo"

    def test_first_case_insensitive(self):
        row = {"Show_Name": "Foo"}
        assert ir._first(row, ("show_name",)) == "Foo"

    def test_classify_episodes(self):
        kind = ir._classify_tvtime_csv(
            "seen_episode.csv",
            ["show_name", "season_number", "episode_number", "updated_at"],
        )
        assert kind == "episodes"

    def test_classify_follows(self):
        kind = ir._classify_tvtime_csv(
            "followed_tv_show.csv", ["show_name", "status"]
        )
        assert kind == "follows"

    def test_classify_ratings(self):
        kind = ir._classify_tvtime_csv("tv_show_rating.csv", ["show_name", "rating"])
        assert kind == "ratings"


def _tvtime_zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _tvtime_upload(client, files: dict[str, str], filename: str = "tvtime.zip"):
    return client.post(
        "/import/tvtime",
        files={"file": (filename, _tvtime_zip(files), "application/zip")},
    )


@pytest.fixture
def mock_tvtime():
    """Mock the TMDB/episode-sync seams used by the TV Time importer."""
    config = {
        # show_name -> tmdb show id
        "search": {},
    }

    def fake_find(name, year=None):
        return config["search"].get(name)

    # sync_season_episodes / fetch_show_from_tmdb hit TMDb — neutralize.
    with patch.object(ir, "_find_tv_show_id", side_effect=fake_find), \
         patch.object(ir, "fetch_show_from_tmdb", return_value=None), \
         patch.object(ir, "sync_season_episodes", return_value=None), \
         patch.object(ir, "maybe_auto_complete_show", return_value=False):
        yield config


class TestTvTimeEndpoint:
    def test_rejects_zip_without_recognizable_csvs(self, client, seed_users, mock_tvtime):
        r = _tvtime_upload(client, {"random.csv": "a,b\n1,2\n"})
        assert r.status_code == 422

    def test_imports_seen_episodes(self, client, seed_users, mock_tvtime, seed_show, db):
        from app.models.episode_watched import EpisodeWatched

        mock_tvtime["search"]["Breaking Bad"] = 1396

        seen = (
            "show_name,season_number,episode_number,updated_at\n"
            "Breaking Bad,1,1,2025-01-15T18:00:00Z\n"
            "Breaking Bad,1,2,2025-01-16T19:00:00Z\n"
        )
        r = _tvtime_upload(client, {"seen_episode.csv": seen})
        assert r.status_code == 200, r.json()
        data = r.json()
        assert data["summary"]["imported"] == 2
        assert data["summary"]["shows_with_episodes"] == 1

        rows = db.query(EpisodeWatched).filter_by(user_id="test-uid-1", show_id=1396).all()
        assert len(rows) == 2
        # FK was filled in from existing Episode rows
        assert {(r.season_number, r.episode_number) for r in rows} == {(1, 1), (1, 2)}

    def test_dedupes_against_existing_episode_watched(
        self, client, seed_users, mock_tvtime, seed_show, db
    ):
        from app.models.episode_watched import EpisodeWatched

        mock_tvtime["search"]["Breaking Bad"] = 1396
        db.add(EpisodeWatched(
            user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1
        ))
        db.commit()

        seen = (
            "show_name,season_number,episode_number,updated_at\n"
            "Breaking Bad,1,1,2025-01-15T18:00:00Z\n"
            "Breaking Bad,1,2,2025-01-16T19:00:00Z\n"
        )
        r = _tvtime_upload(client, {"seen_episode.csv": seen})
        data = r.json()
        assert data["summary"]["imported"] == 1
        assert data["summary"]["skipped"] == 1

    def test_follow_only_show_goes_to_watchlist(
        self, client, seed_users, mock_tvtime, seed_show, db
    ):
        from app.models.watchlist import Watchlist
        mock_tvtime["search"]["Breaking Bad"] = 1396

        follow = "show_name,status\nBreaking Bad,following\n"
        r = _tvtime_upload(client, {"followed_tv_show.csv": follow})
        assert r.status_code == 200
        assert r.json()["summary"]["watchlisted"] == 1
        wl = db.query(Watchlist).filter_by(user_id="test-uid-1", content_id=1396).first()
        assert wl is not None

    def test_unfound_show_reported_as_failed(
        self, client, seed_users, mock_tvtime
    ):
        seen = "show_name,season_number,episode_number\nUnknown Show,1,1\n"
        r = _tvtime_upload(client, {"seen_episode.csv": seen})
        data = r.json()
        assert data["summary"]["failed"] >= 1
        assert any(
            res["status"] == "failed" and "Unknown Show" in res["title"]
            for res in data["results"]
        )

    def test_rating_applied_to_finished_show(
        self, client, seed_users, mock_tvtime, seed_show, db
    ):
        """If the show is already in Watched (e.g. user followed/finished it),
        a TV Time rating row should populate the rating column."""
        from app.models.watched import Watched
        mock_tvtime["search"]["Breaking Bad"] = 1396

        db.add(Watched(
            user_id="test-uid-1", content_type="tv", content_id=1396, rating=None
        ))
        # Need *some* TV Time content beyond ratings — endpoint rejects empty uploads.
        # Use a follow row that's already a duplicate of the Watched, so it doesn't
        # affect the watchlist outcome.
        db.commit()

        r = _tvtime_upload(client, {
            "followed_tv_show.csv": "show_name,status\nBreaking Bad,watched\n",
            "tv_show_rating.csv": "show_name,rating\nBreaking Bad,9\n",
        })
        assert r.status_code == 200, r.json()
        data = r.json()
        assert data["summary"]["ratings_applied"] == 1

        db.expire_all()
        w = db.query(Watched).filter_by(user_id="test-uid-1", content_id=1396).first()
        assert w.rating == 4.5


# ── TV Time "Out" Chrome extension format ─────────────────────────────────


class TestExtFormatHelpers:
    def test_detect_movies_json(self):
        text = '[{"id": {"tvdb": 1, "imdb": "tt0001"}, "title": "X", "year": 2000, "is_watched": true}]'
        assert ir._detect_ext_format("tvtime-movies.json", text) == "ext_movies_json"

    def test_detect_series_json(self):
        text = '[{"id": {"tvdb": 1, "imdb": null}, "title": "X", "seasons": []}]'
        assert ir._detect_ext_format("tvtime-series.json", text) == "ext_series_json"

    def test_detect_movies_csv(self):
        text = "uuid,tvdb_id,imdb_id,title,year,is_watched\nu,1,tt0001,X,2000,true\n"
        assert ir._detect_ext_format("tvtime-movies.csv", text) == "ext_movies_csv"

    def test_detect_series_csv(self):
        text = "uuid,tvdb_id,imdb_id,title,status,created_at\nu,1,,X,up_to_date,2026-01-01\n"
        assert ir._detect_ext_format("tvtime-series.csv", text) == "ext_series_csv"

    def test_detect_episodes_csv(self):
        text = "series_tvdb_id,series_imdb_id,series_uuid,title,season,episode,tvdb_id,is_watched\n1,,u,X,1,1,2,true\n"
        assert ir._detect_ext_format("tvtime-series-episodes.csv", text) == "ext_episodes_csv"

    def test_detect_unrecognized_returns_none(self):
        # Old TV Time format must NOT match ext format
        assert ir._detect_ext_format("seen_episode.csv", "show_name,season_number,episode_number\nFoo,1,1\n") is None

    def test_parse_ext_movies_json_filters_blank_titles(self):
        text = '[{"id": {"imdb": "tt001"}, "title": "Good", "year": 2000, "is_watched": true},' \
               ' {"id": {"imdb": "tt002"}, "title": "", "year": 2001, "is_watched": true}]'
        rows = ir._parse_ext_movies_json(text)
        assert len(rows) == 1
        assert rows[0]["title"] == "Good"
        assert rows[0]["imdb_id"] == "tt001"
        assert rows[0]["is_watched"] is True

    def test_parse_ext_movies_json_unwatched_movie(self):
        text = '[{"id": {"imdb": "tt010"}, "title": "Want", "year": 2020, "is_watched": false, "watched_at": null}]'
        rows = ir._parse_ext_movies_json(text)
        assert rows[0]["is_watched"] is False

    def test_parse_ext_series_json_collects_watched_episodes_only(self):
        text = (
            '[{"id": {"tvdb": 1, "imdb": null}, "title": "X", "status": "continuing", "seasons": [' \
            '{"number": 0, "is_specials": true, "episodes": [{"id": {}, "number": 1, "special": true, "is_watched": true}]},' \
            '{"number": 1, "is_specials": false, "episodes": [' \
            '{"id": {}, "number": 1, "special": false, "is_watched": true, "watched_at": "2025-06-01T00:00:00Z"},' \
            '{"id": {}, "number": 2, "special": false, "is_watched": false},' \
            '{"id": {}, "number": 3, "special": true, "is_watched": true}' \
            ']}' \
            ']}]'
        )
        shows, eps = ir._parse_ext_series_json(text)
        assert len(shows) == 1
        assert shows[0]["tvdb_id"] == 1
        assert shows[0]["status"] == "continuing"
        # Only the season-1 ep1 should be collected (specials and is_watched=false skipped)
        assert len(eps) == 1
        assert eps[0]["season"] == 1 and eps[0]["episode"] == 1
        assert eps[0]["series_tvdb_id"] == 1

    def test_parse_ext_episodes_csv_filters_unwatched_and_specials(self):
        text = (
            "series_tvdb_id,series_imdb_id,series_uuid,title,season,episode,tvdb_id,is_watched,watched_at,rewatch_count,special\n"
            "10,,u,Show,1,1,100,true,2025-01-01,0,false\n"
            "10,,u,Show,1,2,101,false,,0,false\n"
            "10,,u,Show,0,1,102,true,2025-01-02,0,true\n"
        )
        eps = ir._parse_ext_episodes_csv(text)
        assert len(eps) == 1
        assert eps[0]["episode"] == 1


class TestResolveExtHelpers:
    def test_resolve_movie_prefers_imdb_id(self):
        with patch.object(ir, "_tmdb_find_by_external") as find:
            find.return_value = (123, "movie")
            result = ir._resolve_ext_movie("tt0001", 99, "X", 2000)
            assert result == (123, "movie")
            find.assert_called_once_with("tt0001", "imdb_id")

    def test_resolve_movie_falls_back_to_tvdb(self):
        # IMDb miss, TVDB hit
        def fake_find(ext_id, source):
            return (456, "movie") if source == "tvdb_id" else None
        with patch.object(ir, "_tmdb_find_by_external", side_effect=fake_find):
            result = ir._resolve_ext_movie("tt0001", 99, "X", 2000)
            assert result == (456, "movie")

    def test_resolve_movie_falls_back_to_name_search(self):
        with patch.object(ir, "_tmdb_find_by_external", return_value=None), \
             patch.object(ir, "_find_tmdb_result", return_value=(789, "movie")) as name_search:
            result = ir._resolve_ext_movie(None, None, "X", 2000)
            assert result == (789, "movie")
            name_search.assert_called_once_with("X", 2000)

    def test_resolve_show_ignores_movie_match(self):
        # If /find returns a movie when we asked for a show, fall through.
        with patch.object(ir, "_tmdb_find_by_external", return_value=(11, "movie")), \
             patch.object(ir, "_find_tv_show_id", return_value=22):
            assert ir._resolve_ext_show(99, "tt0001", "X") == 22


@pytest.fixture
def mock_ext_tvtime():
    """Mock TMDB seams for the new ext format."""
    config = {
        # (ext_id, source) -> (tmdb_id, media_type)
        "ext": {},
        # name -> tmdb_id for show name-fallback
        "shows": {},
        # name -> (tmdb_id, media_type) for movie name-fallback
        "movies": {},
    }

    def fake_find_ext(ext_id, source):
        return config["ext"].get((ext_id, source))

    def fake_find_show(name, year):
        return config["shows"].get(name)

    def fake_find_movie(name, year):
        return config["movies"].get(name)

    with patch.object(ir, "_tmdb_find_by_external", side_effect=fake_find_ext), \
         patch.object(ir, "_find_tv_show_id", side_effect=fake_find_show), \
         patch.object(ir, "_find_tmdb_result", side_effect=fake_find_movie), \
         patch.object(ir, "fetch_show_from_tmdb", return_value=None), \
         patch.object(ir, "fetch_movie_from_tmdb", return_value=None), \
         patch.object(ir, "sync_season_episodes", return_value=None), \
         patch.object(ir, "maybe_auto_complete_show", return_value=False):
        yield config


def _ext_upload(client, files: dict[str, str], filename: str = "tvtime-out.zip"):
    """Upload one or more ext-format files as a zip to /import/tvtime."""
    return client.post(
        "/import/tvtime",
        files={"file": (filename, _tvtime_zip(files), "application/zip")},
    )


def _ext_upload_single(client, content: str, filename: str):
    """Upload a single ext-format file (JSON or CSV) to /import/tvtime."""
    mime = "application/json" if filename.endswith(".json") else "text/csv"
    return client.post(
        "/import/tvtime",
        files={"file": (filename, content.encode("utf-8"), mime)},
    )


class TestExtFormatEndpoint:
    def test_rejects_unsupported_extension(self, client, seed_users):
        r = client.post(
            "/import/tvtime",
            files={"file": ("notes.txt", b"hello", "text/plain")},
        )
        assert r.status_code == 422

    def test_movies_json_watched_and_unwatched(
        self, client, seed_users, mock_ext_tvtime, db
    ):
        from app.models.movie import Movie
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist as WL

        # Pre-seed both movies so ensure_movie_in_db is a no-op
        db.add_all([
            Movie(id=550, title="Fight Club", status="Released", tracking_count=0, vote_average=7.0),
            Movie(id=438631, title="Dune", status="Released", tracking_count=0, vote_average=8.0),
        ])
        db.commit()
        # IMDb-id resolution
        mock_ext_tvtime["ext"][("tt0137523", "imdb_id")] = (550, "movie")
        mock_ext_tvtime["ext"][("tt1160419", "imdb_id")] = (438631, "movie")

        content = (
            '[{"id":{"tvdb":1,"imdb":"tt0137523"},"title":"Fight Club","year":1999,'
            '"is_watched":true,"watched_at":"2025-01-15T00:00:00Z"},'
            '{"id":{"tvdb":2,"imdb":"tt1160419"},"title":"Dune","year":2021,'
            '"is_watched":false,"watched_at":null}]'
        )
        r = _ext_upload_single(client, content, "tvtime-movies.json")
        assert r.status_code == 200, r.json()
        data = r.json()
        assert data["summary"]["movies_imported"] == 1
        assert data["summary"]["movies_watchlisted"] == 1

        # Fight Club ended up in Watched, Dune in Watchlist
        assert db.query(Watched).filter_by(
            user_id="test-uid-1", content_type="movie", content_id=550
        ).first() is not None
        assert db.query(WL).filter_by(
            user_id="test-uid-1", content_type="movie", content_id=438631
        ).first() is not None

    def test_movies_json_falls_back_to_name_when_no_ids_resolve(
        self, client, seed_users, mock_ext_tvtime, db
    ):
        from app.models.movie import Movie
        # External-id lookup yields nothing; name search is the fallback
        mock_ext_tvtime["movies"]["Fight Club"] = (550, "movie")
        db.add(Movie(id=550, title="Fight Club", status="Released", tracking_count=0, vote_average=7.0))
        db.commit()

        content = '[{"id":{},"title":"Fight Club","year":1999,"is_watched":true}]'
        r = _ext_upload_single(client, content, "tvtime-movies.json")
        assert r.json()["summary"]["movies_imported"] == 1

    def test_movies_csv_format(self, client, seed_users, mock_ext_tvtime, db):
        from app.models.movie import Movie
        db.add(Movie(id=550, title="Fight Club", status="Released", tracking_count=0, vote_average=7.0))
        db.commit()
        mock_ext_tvtime["ext"][("tt0137523", "imdb_id")] = (550, "movie")

        content = (
            "uuid,tvdb_id,imdb_id,title,year,created_at,watched_at,is_watched,rewatch_count\n"
            "u,1,tt0137523,Fight Club,1999,2025-01-15,2025-01-15,true,0\n"
        )
        r = _ext_upload_single(client, content, "tvtime-movies.csv")
        assert r.status_code == 200, r.json()
        assert r.json()["summary"]["movies_imported"] == 1

    def test_series_json_imports_watched_episodes(
        self, client, seed_users, mock_ext_tvtime, seed_show, db
    ):
        from app.models.episode_watched import EpisodeWatched

        # Show resolves via TVDB id, not name
        mock_ext_tvtime["ext"][("81189", "tvdb_id")] = (1396, "tv")

        content = (
            '[{"id":{"tvdb":81189,"imdb":null},"title":"Breaking Bad","status":"continuing","seasons":[' \
            '{"number":1,"is_specials":false,"episodes":[' \
            '{"id":{"tvdb":11},"number":1,"special":false,"is_watched":true,"watched_at":"2025-01-15T00:00:00Z"},' \
            '{"id":{"tvdb":12},"number":2,"special":false,"is_watched":true,"watched_at":"2025-01-16T00:00:00Z"}' \
            ']}]}]'
        )
        r = _ext_upload_single(client, content, "tvtime-series.json")
        assert r.status_code == 200, r.json()
        data = r.json()
        assert data["summary"]["imported"] == 2
        rows = db.query(EpisodeWatched).filter_by(user_id="test-uid-1", show_id=1396).all()
        assert {(r.season_number, r.episode_number) for r in rows} == {(1, 1), (1, 2)}

    def test_series_json_show_with_no_watched_episodes_goes_to_watchlist(
        self, client, seed_users, mock_ext_tvtime, seed_show, db
    ):
        from app.models.watchlist import Watchlist as WL
        mock_ext_tvtime["ext"][("81189", "tvdb_id")] = (1396, "tv")

        content = (
            '[{"id":{"tvdb":81189,"imdb":null},"title":"Breaking Bad","status":"not_started_yet","seasons":[' \
            '{"number":1,"is_specials":false,"episodes":[' \
            '{"id":{"tvdb":11},"number":1,"special":false,"is_watched":false}' \
            ']}]}]'
        )
        r = _ext_upload_single(client, content, "tvtime-series.json")
        assert r.status_code == 200, r.json()
        assert r.json()["summary"]["watchlisted"] == 1
        assert db.query(WL).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=1396
        ).first() is not None

    def test_episodes_csv_imports_via_series_tvdb_id(
        self, client, seed_users, mock_ext_tvtime, seed_show, db
    ):
        from app.models.episode_watched import EpisodeWatched
        mock_ext_tvtime["ext"][("81189", "tvdb_id")] = (1396, "tv")

        content = (
            "series_tvdb_id,series_imdb_id,series_uuid,title,season,episode,tvdb_id,is_watched,watched_at,rewatch_count,special\n"
            "81189,,u,Breaking Bad,1,1,11,true,2025-01-15,0,false\n"
            "81189,,u,Breaking Bad,1,2,12,true,2025-01-16,0,false\n"
        )
        r = _ext_upload_single(client, content, "tvtime-series-episodes.csv")
        assert r.status_code == 200, r.json()
        rows = db.query(EpisodeWatched).filter_by(user_id="test-uid-1", show_id=1396).all()
        assert len(rows) == 2

    def test_zip_with_movies_and_series_json(
        self, client, seed_users, mock_ext_tvtime, seed_show, db
    ):
        from app.models.movie import Movie
        db.add(Movie(id=550, title="Fight Club", status="Released", tracking_count=0, vote_average=7.0))
        db.commit()
        mock_ext_tvtime["ext"][("tt0137523", "imdb_id")] = (550, "movie")
        mock_ext_tvtime["ext"][("81189", "tvdb_id")] = (1396, "tv")

        r = _ext_upload(client, {
            "tvtime-movies-2026.json":
                '[{"id":{"imdb":"tt0137523"},"title":"Fight Club","year":1999,"is_watched":true}]',
            "tvtime-series-2026.json":
                '[{"id":{"tvdb":81189},"title":"Breaking Bad","status":"continuing","seasons":[' \
                '{"number":1,"is_specials":false,"episodes":[' \
                '{"id":{"tvdb":11},"number":1,"special":false,"is_watched":true}]}]}]',
        })
        assert r.status_code == 200, r.json()
        data = r.json()
        assert data["summary"]["movies_imported"] == 1
        assert data["summary"]["imported"] >= 1  # episodes_imported + movies_imported

    def test_movie_not_resolved_marked_failed(
        self, client, seed_users, mock_ext_tvtime, db
    ):
        content = '[{"id":{"imdb":"tt9999999"},"title":"Nothing","year":2099,"is_watched":true}]'
        r = _ext_upload_single(client, content, "tvtime-movies.json")
        assert r.status_code == 200
        assert r.json()["summary"]["failed"] == 1

    def test_currently_watching_movie_is_skipped(
        self, client, seed_users, mock_ext_tvtime, db
    ):
        """A movie the user is currently watching shouldn't be re-added to
        Watched/Watchlist — that would generate redundant activity events."""
        from app.models.movie import Movie
        from app.models.watched import Watched
        from app.models.currently_watching import CurrentlyWatching

        db.add(Movie(id=550, title="Fight Club", status="Released", tracking_count=1, vote_average=7.0))
        db.add(CurrentlyWatching(user_id="test-uid-1", content_type="movie", content_id=550))
        db.commit()
        mock_ext_tvtime["ext"][("tt0137523", "imdb_id")] = (550, "movie")

        content = (
            '[{"id":{"imdb":"tt0137523"},"title":"Fight Club","year":1999,'
            '"is_watched":true,"watched_at":"2025-01-15T00:00:00Z"}]'
        )
        r = _ext_upload_single(client, content, "tvtime-movies.json")
        assert r.status_code == 200, r.json()
        data = r.json()
        assert data["summary"]["movies_imported"] == 0
        assert data["summary"]["skipped"] >= 1
        # Confirm no Watched row was written
        assert db.query(Watched).filter_by(
            user_id="test-uid-1", content_type="movie", content_id=550
        ).first() is None

    def test_currently_watching_show_skips_episode_writes(
        self, client, seed_users, mock_ext_tvtime, seed_show, db
    ):
        """A show the user is currently watching shouldn't have its episodes
        re-imported (no auto-complete + 'watched' activity)."""
        from app.models.episode_watched import EpisodeWatched
        from app.models.currently_watching import CurrentlyWatching

        db.add(CurrentlyWatching(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.commit()
        mock_ext_tvtime["ext"][("81189", "tvdb_id")] = (1396, "tv")

        content = (
            '[{"id":{"tvdb":81189,"imdb":null},"title":"Breaking Bad","status":"continuing","seasons":[' \
            '{"number":1,"is_specials":false,"episodes":[' \
            '{"id":{"tvdb":11},"number":1,"special":false,"is_watched":true,"watched_at":"2025-01-15T00:00:00Z"}' \
            ']}]}]'
        )
        r = _ext_upload_single(client, content, "tvtime-series.json")
        assert r.status_code == 200, r.json()
        assert r.json()["summary"]["imported"] == 0
        # No EpisodeWatched rows were added
        assert db.query(EpisodeWatched).filter_by(user_id="test-uid-1", show_id=1396).count() == 0

    def test_currently_watching_show_skips_watchlist_add(
        self, client, seed_users, mock_ext_tvtime, seed_show, db
    ):
        """If a show has no watched episodes but is in CurrentlyWatching, it
        shouldn't be added to the watchlist on import."""
        from app.models.watchlist import Watchlist as WL
        from app.models.currently_watching import CurrentlyWatching

        db.add(CurrentlyWatching(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.commit()
        mock_ext_tvtime["ext"][("81189", "tvdb_id")] = (1396, "tv")

        content = (
            '[{"id":{"tvdb":81189,"imdb":null},"title":"Breaking Bad","status":"not_started_yet","seasons":[' \
            '{"number":1,"is_specials":false,"episodes":[' \
            '{"id":{"tvdb":11},"number":1,"special":false,"is_watched":false}' \
            ']}]}]'
        )
        r = _ext_upload_single(client, content, "tvtime-series.json")
        assert r.status_code == 200, r.json()
        assert r.json()["summary"]["watchlisted"] == 0
        assert db.query(WL).filter_by(
            user_id="test-uid-1", content_type="tv", content_id=1396
        ).first() is None
