"""Tests for app.routers.export_router — /export/zip user data export."""

import csv
import io
import json
import zipfile

from datetime import date

import pytest


def _open_zip(content: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(content))


def _read_csv(zf: zipfile.ZipFile, name: str) -> list[dict]:
    with zf.open(name) as f:
        text = f.read().decode()
    return list(csv.DictReader(io.StringIO(text)))


class TestExportZip:
    def test_empty_user_still_returns_zip(self, client, seed_users):
        r = client.get("/export/zip")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/zip")
        assert "attachment" in r.headers["content-disposition"]
        assert ".zip" in r.headers["content-disposition"]

        zf = _open_zip(r.content)
        names = set(zf.namelist())
        assert {
            "watched.csv",
            "watchlist.csv",
            "reviews.csv",
            "rewatches.csv",
            "shelves.csv",
            "profile.json",
        } <= names

    def test_profile_json_contains_user_metadata(self, client, seed_users):
        r = client.get("/export/zip")
        zf = _open_zip(r.content)
        with zf.open("profile.json") as f:
            profile = json.loads(f.read())
        assert profile["username"] == "alice"
        assert profile["email"] == "alice@test.com"

    def test_watched_csv_includes_rows_with_titles(
        self, client, db, seed_users, seed_movie
    ):
        from app.models.watched import Watched

        db.add(
            Watched(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                rating=4.5,
            )
        )
        db.commit()

        r = client.get("/export/zip")
        zf = _open_zip(r.content)
        rows = _read_csv(zf, "watched.csv")
        assert len(rows) == 1
        row = rows[0]
        assert row["type"] == "movie"
        assert row["title"] == "Fight Club"
        assert row["tmdb_id"] == "550"
        assert row["rating"] == "4.5"

    def test_watchlist_csv_includes_show_titles(
        self, client, db, seed_users, seed_show
    ):
        from app.models.watchlist import Watchlist

        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.commit()
        r = client.get("/export/zip")
        zf = _open_zip(r.content)
        rows = _read_csv(zf, "watchlist.csv")
        assert len(rows) == 1
        assert rows[0]["type"] == "tv"
        assert rows[0]["title"] == "Breaking Bad"
        assert rows[0]["tmdb_id"] == "1396"

    def test_reviews_csv_included(self, client, db, seed_users, seed_movie):
        from app.models.review import Review

        db.add(
            Review(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                review_text="Great",
            )
        )
        db.commit()
        r = client.get("/export/zip")
        zf = _open_zip(r.content)
        rows = _read_csv(zf, "reviews.csv")
        assert len(rows) == 1
        assert rows[0]["review"] == "Great"
        assert rows[0]["title"] == "Fight Club"

    def test_rewatches_csv_included(self, client, db, seed_users, seed_movie):
        from app.models.rewatch import Rewatch

        db.add(
            Rewatch(
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
                rating=5.0,
                notes="rewatch",
            )
        )
        db.commit()
        r = client.get("/export/zip")
        zf = _open_zip(r.content)
        rows = _read_csv(zf, "rewatches.csv")
        assert len(rows) == 1
        assert rows[0]["notes"] == "rewatch"
        assert rows[0]["rating"] == "5.0"

    def test_shelves_csv_includes_items(
        self, client, db, seed_users, seed_movie
    ):
        from app.models.shelf import Shelf
        from app.models.shelf_item import ShelfItem

        s = Shelf(user_id="test-uid-1", name="Cozy")
        db.add(s)
        db.flush()
        db.add(
            ShelfItem(
                shelf_id=s.id,
                user_id="test-uid-1",
                content_type="movie",
                content_id=550,
            )
        )
        db.commit()
        r = client.get("/export/zip")
        zf = _open_zip(r.content)
        rows = _read_csv(zf, "shelves.csv")
        assert len(rows) == 1
        assert rows[0]["shelf"] == "Cozy"
        assert rows[0]["title"] == "Fight Club"

    def test_filename_includes_username_and_date(self, client, seed_users):
        r = client.get("/export/zip")
        disp = r.headers["content-disposition"]
        # Format: releaseradar-{username}-{YYYY-MM-DD}.zip
        assert "releaseradar-alice-" in disp
