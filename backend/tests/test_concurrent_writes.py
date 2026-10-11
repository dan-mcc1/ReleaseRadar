"""A double-click, or two users adding the same new title at once, used to
surface as a 500 (unique / primary-key violation). Each test inserts the
competing row immediately before the code's own INSERT, standing in for a
concurrent request that committed between the existence check and the write.
"""

import pytest
from sqlalchemy import event

from app.models.currently_watching import CurrentlyWatching
from app.models.episode_watched import EpisodeWatched
from app.models.movie import Movie
from app.models.show import Show
from app.models.watched import Watched
from app.models.watchlist import Watchlist
from app.services.currently_watching_service import add_to_currently_watching
from app.services.watched_episode_service import add_episode_watched, add_season_watched
from app.services.watched_service import add_to_watched
from app.services.watchlist_service import add_to_watchlist
from tests.conftest import engine


@pytest.fixture
def insert_first():
    hooks = []

    def arm(table: str, sql: str, params: tuple = ()):
        fired = []

        def hook(conn, cursor, statement, parameters, context, executemany):
            if fired or not statement.lstrip().upper().startswith(f"INSERT INTO {table.upper()} "):
                return
            fired.append(True)
            cursor.execute(sql, params)  # raw DBAPI cursor: doesn't re-enter the hook

        event.listen(engine, "before_cursor_execute", hook)
        hooks.append(hook)
        return fired

    yield arm
    for hook in hooks:
        event.remove(engine, "before_cursor_execute", hook)


class TestDoubleSubmit:
    def test_watchlist_add(self, db, seed_users, seed_movie, insert_first):
        fired = insert_first(
            "watchlist",
            "INSERT INTO watchlist (user_id, content_type, content_id, sort_key, notify)"
            " VALUES ('test-uid-1', 'movie', 550, 1000, 1)",
        )

        result = add_to_watchlist(db, "test-uid-1", "movie", 550)

        assert fired
        rows = db.query(Watchlist).filter_by(user_id="test-uid-1").all()
        assert len(rows) == 1
        assert result["id"] == rows[0].id

    def test_currently_watching_add(self, db, seed_users, seed_movie, insert_first):
        fired = insert_first(
            "currently_watching",
            "INSERT INTO currently_watching (user_id, content_type, content_id)"
            " VALUES ('test-uid-1', 'movie', 550)",
        )

        entry = add_to_currently_watching(db, "test-uid-1", "movie", 550)

        assert fired
        assert db.query(CurrentlyWatching).filter_by(user_id="test-uid-1").count() == 1
        assert entry.content_id == 550

    def test_watched_add(self, db, seed_users, seed_movie, insert_first):
        fired = insert_first(
            "watched",
            "INSERT INTO watched (user_id, content_type, content_id)"
            " VALUES ('test-uid-1', 'movie', 550)",
        )

        result = add_to_watched(db, "test-uid-1", "movie", 550)

        assert fired
        rows = db.query(Watched).filter_by(user_id="test-uid-1").all()
        assert len(rows) == 1
        assert result["id"] == rows[0].id

    def test_episode_watched_add(self, db, seed_users, seed_show, insert_first):
        fired = insert_first(
            "episode_watched",
            "INSERT INTO episode_watched (user_id, show_id, season_number, episode_number)"
            " VALUES ('test-uid-1', 1396, 1, 1)",
        )

        entry = add_episode_watched(db, "test-uid-1", 1396, 1, 1)

        assert fired
        assert db.query(EpisodeWatched).filter_by(user_id="test-uid-1").count() == 1
        assert (entry.season_number, entry.episode_number) == (1, 1)

    def test_season_watched_add(self, db, seed_users, seed_show, insert_first, monkeypatch):
        monkeypatch.setattr(
            "app.services.watched_episode_service.sync_season_episodes",
            lambda *a, **k: None,
        )
        fired = insert_first(
            "episode_watched",
            "INSERT INTO episode_watched (user_id, show_id, season_number, episode_number)"
            " VALUES ('test-uid-1', 1396, 1, 2)",
        )

        add_season_watched(db, "test-uid-1", 1396, 1)

        assert fired
        watched = {
            e for (e,) in db.query(EpisodeWatched.episode_number)
            .filter_by(user_id="test-uid-1", show_id=1396, season_number=1)
        }
        assert watched == {1, 2}


class TestNewTitleAddedConcurrently:
    def test_show_stub(self, db, seed_users, insert_first):
        fired = insert_first(
            "show",
            "INSERT INTO show (id, name, tracking_count) VALUES (4242, '', 0)",
        )

        add_to_watchlist(db, "test-uid-1", "tv", 4242)

        assert fired
        db.expire_all()
        assert db.query(Show).filter_by(id=4242).one().tracking_count == 1

    def test_movie_stub(self, db, seed_users, insert_first):
        fired = insert_first(
            "movie",
            "INSERT INTO movie (id, tracking_count) VALUES (4243, 0)",
        )

        add_to_watched(db, "test-uid-1", "movie", 4243)

        assert fired
        db.expire_all()
        assert db.query(Movie).filter_by(id=4243).one().tracking_count == 1
