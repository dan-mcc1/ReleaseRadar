"""
Tests for app.services.media_serializers.

All functions are pure: take a SQLAlchemy Movie/Show row and return a dict.
We build rows directly in the DB (so relationships fire properly via
selectinload-style access) and assert the shape of the output.
"""

from datetime import date

import pytest


# ── Fixtures ──────────────────────────────────────────────────────────────


@pytest.fixture
def show_with_relations(db):
    """A Show with a season, two genres, and three providers (flatrate / rent / buy)."""
    from app.models.show import Show
    from app.models.season import Season
    from app.models.genre import Genre, ShowGenre
    from app.models.provider import Provider, ShowProvider

    s = Show(
        id=2000,
        name="Test Show",
        backdrop_path="/bd.jpg",
        logo_path="/logo.jpg",
        first_air_date=date(2020, 1, 1),
        last_air_date=date(2024, 12, 31),
        homepage="http://example.com",
        in_production=True,
        number_of_seasons=2,
        number_of_episodes=20,
        overview="o",
        poster_path="/p.jpg",
        status="Returning Series",
        tagline="A tagline",
        type="Scripted",
        tracking_count=42,
        air_time="20:00",
        air_timezone="America/New_York",
        vote_average=7.7,
        certification="TV-MA",
    )
    db.add(s)
    db.flush()

    season = Season(
        id=8000, show_id=2000, season_number=1, name="Season 1",
        overview="overview1", air_date=date(2020, 1, 1), episode_count=10,
        poster_path="/sp.jpg", vote_average=8.0,
    )
    season_no_date = Season(
        id=8001, show_id=2000, season_number=2, name="Season 2",
        air_date=None, episode_count=10,
    )
    db.add_all([season, season_no_date])

    g1 = Genre(id=18, name="Drama")
    g2 = Genre(id=10765, name="Sci-Fi")
    db.add_all([g1, g2])
    db.flush()
    db.add_all([ShowGenre(show_id=2000, genre_id=18),
                ShowGenre(show_id=2000, genre_id=10765)])

    p_flat = Provider(id=8, name="Netflix", logo_path="/nf.jpg")
    p_rent = Provider(id=2, name="Apple TV Store", logo_path="/atv.jpg")
    p_buy = Provider(id=3, name="Google Play", logo_path="/gp.jpg")
    db.add_all([p_flat, p_rent, p_buy])
    db.flush()
    db.add_all([
        ShowProvider(show_id=2000, provider_id=8, flatrate=True),
        ShowProvider(show_id=2000, provider_id=2, rent=True),
        ShowProvider(show_id=2000, provider_id=3, buy=True),
    ])
    db.commit()
    db.refresh(s)
    return s


@pytest.fixture
def movie_with_relations(db):
    """A Movie with two genres and one flatrate provider."""
    from app.models.movie import Movie
    from app.models.genre import Genre, MovieGenre
    from app.models.provider import Provider, MovieProvider

    m = Movie(
        id=3000, imdb_id="tt000",
        title="Pure Movie", status="Released",
        release_date=date(2020, 5, 5), runtime=100,
        overview="ov", tagline="tag", backdrop_path="/bd.jpg",
        logo_path="/lg.jpg", poster_path="/p.jpg",
        homepage="http://m.example", budget=10, revenue=20,
        tracking_count=5, vote_average=7.0, certification="PG-13",
    )
    db.add(m)
    db.flush()

    g1 = Genre(id=28, name="Action")
    g2 = Genre(id=12, name="Adventure")
    db.add_all([g1, g2])
    db.flush()
    db.add_all([MovieGenre(movie_id=3000, genre_id=28),
                MovieGenre(movie_id=3000, genre_id=12)])

    p = Provider(id=9, name="Amazon Prime Video", logo_path="/amz.jpg")
    db.add(p)
    db.flush()
    db.add(MovieProvider(movie_id=3000, provider_id=9, flatrate=True))
    db.commit()
    db.refresh(m)
    return m


@pytest.fixture
def show_no_providers(db):
    from app.models.show import Show
    s = Show(id=2100, name="Bare Show", status="Ended", tracking_count=0)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@pytest.fixture
def movie_no_providers(db):
    from app.models.movie import Movie
    m = Movie(id=3100, title="Bare Movie", status="Released", tracking_count=0)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


# ── serialize_show / serialize_movie ──────────────────────────────────────


class TestSerializeShow:
    def test_full_show(self, db, show_with_relations):
        from app.services.media_serializers import serialize_show
        s = serialize_show(show_with_relations)

        assert s["id"] == 2000
        assert s["name"] == "Test Show"
        assert s["status"] == "Returning Series"
        assert s["tracking_count"] == 42
        assert s["air_time"] == "20:00"
        assert s["certification"] == "TV-MA"

        # 2 seasons (sorted by season_number per Show relationship)
        assert len(s["seasons"]) == 2
        # season 1 air_date is stringified
        assert s["seasons"][0]["air_date"] == "2020-01-01"
        # season 2 air_date is None
        assert s["seasons"][1]["air_date"] is None

        # 2 genres
        assert {g["id"] for g in s["genres"]} == {18, 10765}

        # providers grouped by section
        assert s["providers"]["flatrate"][0]["provider_name"] == "Netflix"
        # rent slot has Apple TV Store, which canonicalizes to Apple TV+ (id=350)
        rent_entry = s["providers"]["rent"][0]
        assert rent_entry["provider_id"] == 350  # canonical
        assert rent_entry["provider_name"] == "Apple TV+"
        # buy slot
        assert s["providers"]["buy"][0]["provider_id"] == 3

    def test_show_with_no_providers(self, db, show_no_providers):
        from app.services.media_serializers import serialize_show
        s = serialize_show(show_no_providers)
        assert s["providers"] is None
        assert s["seasons"] == []
        assert s["genres"] == []


class TestSerializeMovie:
    def test_full_movie(self, db, movie_with_relations):
        from app.services.media_serializers import serialize_movie
        out = serialize_movie(movie_with_relations)
        assert out["id"] == 3000
        assert out["title"] == "Pure Movie"
        assert out["runtime"] == 100
        assert out["certification"] == "PG-13"
        assert {g["id"] for g in out["genres"]} == {28, 12}
        assert out["providers"]["flatrate"][0]["provider_name"] == "Amazon Prime Video"

    def test_movie_with_no_providers(self, db, movie_no_providers):
        from app.services.media_serializers import serialize_movie
        out = serialize_movie(movie_no_providers)
        assert out["providers"] is None
        assert out["genres"] == []


# ── List serializers ──────────────────────────────────────────────────────


class TestSerializeShowList:
    def test_lightweight_shape(self, db, show_with_relations):
        from app.services.media_serializers import serialize_show_list
        out = serialize_show_list(show_with_relations)
        assert out["id"] == 2000
        assert "seasons" not in out
        assert "providers" not in out
        # Only flatrate provider IDs are included
        assert out["flatrate_provider_ids"] == [8]
        assert {g["id"] for g in out["genres"]} == {18, 10765}

    def test_no_flatrate_providers(self, db, show_no_providers):
        from app.services.media_serializers import serialize_show_list
        out = serialize_show_list(show_no_providers)
        assert out["flatrate_provider_ids"] == []
        assert out["genres"] == []


class TestSerializeMovieList:
    def test_lightweight_shape(self, db, movie_with_relations):
        from app.services.media_serializers import serialize_movie_list
        out = serialize_movie_list(movie_with_relations)
        assert out["id"] == 3000
        assert "providers" not in out
        assert out["flatrate_provider_ids"] == [9]

    def test_no_flatrate_providers(self, db, movie_no_providers):
        from app.services.media_serializers import serialize_movie_list
        out = serialize_movie_list(movie_no_providers)
        assert out["flatrate_provider_ids"] == []


# ── Calendar serializers ──────────────────────────────────────────────────


class TestCalendarSerializers:
    def test_show_calendar(self, db, show_with_relations):
        from app.services.media_serializers import serialize_show_calendar
        out = serialize_show_calendar(show_with_relations)
        # Only scalar fields, no joins required
        assert set(out.keys()) == {
            "id", "name", "poster_path", "backdrop_path", "logo_path",
            "air_time", "air_timezone",
        }
        assert out["air_time"] == "20:00"

    def test_movie_calendar(self, db, movie_with_relations):
        from app.services.media_serializers import serialize_movie_calendar
        out = serialize_movie_calendar(movie_with_relations)
        assert out["id"] == 3000
        assert out["runtime"] == 100
        # No genres / providers fields
        assert "providers" not in out
        assert "genres" not in out


# ── serialize_providers edge cases ────────────────────────────────────────


class TestSerializeProvidersEdge:
    def test_empty_input(self):
        from app.services.media_serializers import serialize_providers
        assert serialize_providers([]) is None

    def test_canonical_collapse(self, db):
        """Two variant providers for the same service collapse to one canonical entry."""
        from app.models.show import Show
        from app.models.provider import Provider, ShowProvider
        from app.services.media_serializers import serialize_providers

        s = Show(id=2200, name="Collapse Show", status="Ended", tracking_count=0)
        # Provider 8 = canonical Netflix. Provider 1796 = "Netflix basic with ads" → 8.
        p_canon = Provider(id=8, name="Netflix", logo_path="/n.jpg")
        p_variant = Provider(id=1796, name="Netflix basic with ads", logo_path="/x.jpg")
        db.add_all([s, p_canon, p_variant])
        db.flush()
        db.add_all([
            ShowProvider(show_id=2200, provider_id=8, flatrate=True),
            ShowProvider(show_id=2200, provider_id=1796, flatrate=True),
        ])
        db.commit()
        db.refresh(s)

        result = serialize_providers(s.show_providers)
        # Only one Netflix entry, with the canonical id and name
        assert len(result["flatrate"]) == 1
        assert result["flatrate"][0]["provider_id"] == 8
        assert result["flatrate"][0]["provider_name"] == "Netflix"


# ── _query_options companions ─────────────────────────────────────────────


class TestQueryOptionsPrefetch:
    """The _query_options helpers return selectinload directives that, when
    applied to a query, prefetch relationships in additional round-trips."""

    def test_show_query_options_returns_three_loads(self):
        from app.services.media_serializers import _show_query_options
        opts = _show_query_options()
        assert len(opts) == 3

    def test_movie_query_options_returns_two_loads(self):
        from app.services.media_serializers import _movie_query_options
        opts = _movie_query_options()
        assert len(opts) == 2

    def test_show_query_options_list_returns_two_loads(self):
        from app.services.media_serializers import _show_query_options_list
        opts = _show_query_options_list()
        assert len(opts) == 2

    def test_movie_query_options_list_returns_two_loads(self):
        from app.services.media_serializers import _movie_query_options_list
        opts = _movie_query_options_list()
        assert len(opts) == 2

    def test_show_query_options_can_be_applied(self, db, show_with_relations):
        """Sanity-check the directives execute against a real query."""
        from app.models.show import Show
        from app.services.media_serializers import _show_query_options, serialize_show
        loaded = (
            db.query(Show).filter(Show.id == 2000)
            .options(*_show_query_options())
            .first()
        )
        out = serialize_show(loaded)
        assert out["providers"]["flatrate"][0]["provider_name"] == "Netflix"

    def test_movie_query_options_can_be_applied(self, db, movie_with_relations):
        from app.models.movie import Movie
        from app.services.media_serializers import _movie_query_options, serialize_movie
        loaded = (
            db.query(Movie).filter(Movie.id == 3000)
            .options(*_movie_query_options())
            .first()
        )
        out = serialize_movie(loaded)
        assert out["providers"]["flatrate"][0]["provider_name"] == "Amazon Prime Video"
