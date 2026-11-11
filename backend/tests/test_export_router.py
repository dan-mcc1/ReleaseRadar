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


class TestFormulaNeutralising:
    def test_formula_cells_are_prefixed_and_numbers_untouched(
        self, client, db, seed_users
    ):
        from app.models.movie import Movie
        from app.models.rewatch import Rewatch
        from app.models.review import Review
        from app.models.shelf import Shelf
        from app.models.shelf_item import ShelfItem
        from app.models.watched import Watched

        db.add(Movie(id=7, title="-Evil Title", status="Released"))
        db.flush()
        db.add(
            Review(
                user_id="test-uid-1",
                content_type="movie",
                content_id=7,
                review_text='=HYPERLINK("http://evil.test","x")',
            )
        )
        db.add(
            Rewatch(
                user_id="test-uid-1",
                content_type="movie",
                content_id=7,
                rating=-1.5,
                notes="@SUM(1+1)",
            )
        )
        db.add(Watched(user_id="test-uid-1", content_type="movie", content_id=7, rating=4.5))
        s = Shelf(user_id="test-uid-1", name="+1")
        db.add(s)
        db.flush()
        db.add(
            ShelfItem(
                shelf_id=s.id, user_id="test-uid-1", content_type="movie", content_id=7
            )
        )
        db.commit()

        zf = _open_zip(client.get("/export/zip").content)
        review = _read_csv(zf, "reviews.csv")[0]
        assert review["review"] == "'=HYPERLINK(\"http://evil.test\",\"x\")"
        assert review["title"] == "'-Evil Title"
        rewatch = _read_csv(zf, "rewatches.csv")[0]
        assert rewatch["notes"] == "'@SUM(1+1)"
        assert rewatch["rating"] == "-1.5"
        assert _read_csv(zf, "shelves.csv")[0]["shelf"] == "'+1"
        assert _read_csv(zf, "watched.csv")[0]["rating"] == "4.5"


NEW_FILE_HEADERS = {
    "currently_watching.csv": ["type", "title", "tmdb_id", "added_at"],
    "episodes_watched.csv": [
        "show_title", "show_tmdb_id", "season", "episode",
        "episode_title", "rating", "watched_at",
    ],
    "favorites.csv": ["type", "title", "tmdb_id", "added_at"],
    "season_ratings.csv": ["show_title", "show_tmdb_id", "season", "rating", "rated_at"],
    "goals.csv": ["show_title", "show_tmdb_id", "target_date"],
    "friends.csv": ["username", "accepted_at"],
    "collection_rankings.csv": [
        "collection", "collection_tmdb_id", "movie_title",
        "movie_tmdb_id", "rank", "updated_at",
    ],
}


def _headers(zf, name):
    return zf.read(name).decode().splitlines()[0].split(",")


def _seed_everything(db):
    from app.models.collection import Collection
    from app.models.currently_watching import CurrentlyWatching
    from app.models.episode import Episode
    from app.models.episode_watched import EpisodeWatched
    from app.models.favorite import Favorite
    from app.models.finish_by_goal import FinishByGoal
    from app.models.friendship import Friendship
    from app.models.movie import Movie
    from app.models.season_rating import SeasonRating
    from app.models.show import Show
    from app.models.user_collection_ranking import UserCollectionRanking

    db.add_all([
        Show(id=1396, name="Breaking Bad"),
        Movie(id=550, title="Fight Club", status="Released"),
        Collection(id=9, name="Trilogy"),
    ])
    db.flush()
    db.add_all([
        CurrentlyWatching(user_id="test-uid-1", content_type="tv", content_id=1396),
        Favorite(user_id="test-uid-1", content_type="movie", content_id=550),
        SeasonRating(user_id="test-uid-1", show_id=1396, season_number=1, rating=4.0),
        FinishByGoal(user_id="test-uid-1", show_id=1396, target_date=date(2027, 1, 2)),
        UserCollectionRanking(user_id="test-uid-1", collection_id=9, movie_id=550, rank=1),
        Episode(id=5001, show_id=1396, season_number=1, episode_number=1, name="Pilot"),
        EpisodeWatched(user_id="test-uid-1", show_id=1396, season_number=1, episode_number=1, rating=4.5),
        Friendship(requester_id="test-uid-1", addressee_id="test-uid-2", status="accepted"),
    ])
    db.commit()


class TestExportCompleteness:
    def test_new_files_have_headers_and_one_row(self, client, db, seed_users):
        _seed_everything(db)
        zf = _open_zip(client.get("/export/zip").content)
        assert "README.txt" in zf.namelist()
        for name, headers in NEW_FILE_HEADERS.items():
            assert _headers(zf, name) == headers, name
            assert len(_read_csv(zf, name)) == 1, name
        assert _read_csv(zf, "currently_watching.csv")[0]["title"] == "Breaking Bad"
        assert _read_csv(zf, "favorites.csv")[0]["title"] == "Fight Club"
        assert _read_csv(zf, "season_ratings.csv")[0]["rating"] == "4.0"
        assert _read_csv(zf, "goals.csv")[0]["target_date"] == "2027-01-02"
        ranking = _read_csv(zf, "collection_rankings.csv")[0]
        assert (ranking["collection"], ranking["movie_title"], ranking["rank"]) == (
            "Trilogy", "Fight Club", "1",
        )
        episode = _read_csv(zf, "episodes_watched.csv")[0]
        assert (episode["episode_title"], episode["rating"]) == ("Pilot", "4.5")

    def test_existing_files_keep_leading_columns(self, client, seed_users):
        zf = _open_zip(client.get("/export/zip").content)
        assert _headers(zf, "watched.csv") == ["type", "title", "tmdb_id", "rating", "watched_at"]
        assert _headers(zf, "watchlist.csv")[:4] == ["type", "title", "tmdb_id", "added_at"]
        assert _headers(zf, "watchlist.csv")[4:] == ["notify"]
        assert _headers(zf, "reviews.csv")[:5] == ["type", "title", "tmdb_id", "review", "created_at"]
        assert _headers(zf, "reviews.csv")[5:] == ["is_spoiler"]
        assert _headers(zf, "rewatches.csv") == ["type", "title", "tmdb_id", "rating", "notes", "watched_at"]
        assert _headers(zf, "shelves.csv") == ["shelf", "type", "title", "tmdb_id", "added_at"]

    def test_watchlist_notify_and_review_spoiler(self, client, db, seed_users, seed_movie):
        from app.models.review import Review
        from app.models.watchlist import Watchlist

        db.add(Watchlist(user_id="test-uid-1", content_type="movie", content_id=550, notify=False))
        db.add(Review(user_id="test-uid-1", content_type="movie", content_id=550,
                      review_text="x", is_spoiler=True))
        db.commit()
        zf = _open_zip(client.get("/export/zip").content)
        assert _read_csv(zf, "watchlist.csv")[0]["notify"] == "False"
        assert _read_csv(zf, "reviews.csv")[0]["is_spoiler"] == "True"

    def test_missing_user_returns_404(self, seed_users):
        from tests.conftest import make_client

        r = make_client("ghost-uid").get("/export/zip")
        assert r.status_code == 404
        assert r.json()["detail"] == "User not found."

    def test_null_email_does_not_crash(self, client, db, seed_users):
        seed_users[0].email = None
        db.commit()
        zf = _open_zip(client.get("/export/zip").content)
        assert json.loads(zf.read("profile.json"))["email"] is None


class TestEpisodesWatched:
    def _add_episodes(self, db, first, last):
        from app.models.episode import Episode
        from app.models.episode_watched import EpisodeWatched
        from app.models.show import Show

        if first == 1:
            db.add_all([Show(id=1, name="Show One"), Show(id=2, name="Show Two")])
            db.flush()
        for sid in (1, 2):
            for n in range(first, last + 1):
                db.add(Episode(id=sid * 100000 + n, show_id=sid, season_number=1,
                               episode_number=n, name=f"Ep {n}"))
                db.add(EpisodeWatched(user_id="test-uid-1", show_id=sid,
                                      season_number=1, episode_number=n))
        db.commit()

    def test_rows_correct_and_query_count_bounded(
        self, client, db, seed_users, count_queries
    ):
        self._add_episodes(db, 1, 3)
        with count_queries() as small:
            r = client.get("/export/zip")
        rows = _read_csv(_open_zip(r.content), "episodes_watched.csv")
        assert len(rows) == 6
        first = rows[0]
        assert (first["show_title"], first["show_tmdb_id"], first["season"],
                first["episode"], first["episode_title"]) == ("Show One", "1", "1", "1", "Ep 1")
        assert "T" in first["watched_at"]  # full ISO timestamp

        self._add_episodes(db, 4, 6)  # double the rows
        with count_queries() as big:
            r = client.get("/export/zip")
        assert len(_read_csv(_open_zip(r.content), "episodes_watched.csv")) == 12
        assert big.value == small.value


class TestFriendsAndProfile:
    def test_friends_lists_username_only_accepted_only(self, client, db, seed_users):
        from app.models.friendship import Friendship
        from app.models.user import User

        db.add(User(id="uid-carol", username="carol", email="carol@test.com"))
        db.add(User(id="uid-dave", username="dave", email="dave@test.com"))
        db.flush()
        db.add(Friendship(requester_id="uid-carol", addressee_id="test-uid-1", status="accepted"))
        db.add(Friendship(requester_id="test-uid-1", addressee_id="uid-dave", status="pending"))
        db.commit()
        zf = _open_zip(client.get("/export/zip").content)
        raw = zf.read("friends.csv").decode()
        assert [r["username"] for r in _read_csv(zf, "friends.csv")] == ["carol"]
        for forbidden in ("uid-carol", "uid-dave", "carol@test.com", "dave", "@"):
            assert forbidden not in raw

    def test_profile_has_new_keys_and_no_forbidden_ones(self, client, db, seed_users):
        from app.models.provider import Provider
        from app.models.user_streaming_service import UserStreamingService

        user = seed_users[0]
        user.display_name = "Alice A"
        user.suspension_reason = "SECRET-SUSPENSION"
        user.ban_reason = "SECRET-BAN"
        user.warning_count = 7
        user.ical_token_version = 4242
        db.add(Provider(id=8, name="Netflix"))
        db.flush()
        db.add(UserStreamingService(user_id="test-uid-1", provider_id=8))
        db.commit()

        zf = _open_zip(client.get("/export/zip").content)
        text = zf.read("profile.json").decode()
        profile = json.loads(text)
        for key in ("display_name", "streaming_services", "digest_hour", "digest_timezone",
                    "exported_at", "notify_new_seasons", "notify_streaming_changes",
                    "notify_trailers", "push_notifications_enabled",
                    "push_notify_episode_air", "episode_alert_lead_minutes"):
            assert key in profile, key
        assert profile["streaming_services"] == ["Netflix"]
        for forbidden in ("ical", "token", "warning", "ban", "suspen", "silence",
                          "SECRET-SUSPENSION", "SECRET-BAN", "4242", "test-uid"):
            assert forbidden not in text, forbidden
