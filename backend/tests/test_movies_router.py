"""Tests for app.routers.movies — TMDb-passthrough endpoints with DB fast-path."""

from unittest.mock import patch


class TestGetMovieInfo:
    def test_returns_db_movie_when_present(self, client, seed_movie):
        r = client.get("/movies/550")
        assert r.status_code == 200
        assert r.json()["id"] == 550
        assert r.json()["title"] == "Fight Club"

    def test_falls_back_to_tmdb_when_missing(self, client):
        with patch(
            "app.routers.movies.fetch_movie_from_tmdb",
            return_value={"id": 1, "title": "T"},
        ) as m:
            r = client.get("/movies/1")
        assert r.status_code == 200
        assert r.json() == {"id": 1, "title": "T"}
        m.assert_called_once()

    def test_tmdb_404_returns_404(self, client):
        with patch("app.routers.movies.fetch_movie_from_tmdb", return_value=None):
            r = client.get("/movies/9999")
        assert r.status_code == 404


class TestFullMovieInfo:
    def test_overlays_db_artwork(self, client, db):
        from app.models.movie import Movie
        from datetime import date

        db.add(
            Movie(
                id=42,
                title="X",
                release_date=date(2020, 1, 1),
                runtime=120,
                tracking_count=0,
                vote_average=7.0,
                backdrop_path="/db-backdrop.jpg",
                poster_path="/db-poster.jpg",
                logo_path="/db-logo.png",
            )
        )
        db.commit()

        tmdb_data = {
            "id": 42,
            "title": "X",
            "backdrop_path": "/from-tmdb-backdrop.jpg",
            "poster_path": "/from-tmdb-poster.jpg",
            "images": {"logos": []},
        }
        with patch(
            "app.routers.movies.fetch_movie_from_tmdb", return_value=tmdb_data
        ):
            r = client.get("/movies/42/info")
        body = r.json()
        # DB values overlay TMDb
        assert body["backdrop_path"] == "/db-backdrop.jpg"
        assert body["poster_path"] == "/db-poster.jpg"
        assert body["logo_path"] == "/db-logo.png"

    def test_picks_english_logo_when_db_absent(self, client):
        tmdb_data = {
            "id": 9,
            "title": "Y",
            "images": {
                "logos": [
                    {"iso_639_1": "fr", "file_path": "/fr.png"},
                    {"iso_639_1": "en", "file_path": "/en.png"},
                ]
            },
        }
        with patch(
            "app.routers.movies.fetch_movie_from_tmdb", return_value=tmdb_data
        ):
            r = client.get("/movies/9/info")
        assert r.json()["logo_path"] == "/en.png"

    def test_missing_movie_returns_404(self, client):
        with patch("app.routers.movies.fetch_movie_from_tmdb", return_value=None):
            r = client.get("/movies/1/info")
        assert r.status_code == 404
