"""
Shared fixtures for all ReleaseRadar backend tests.

- In-memory SQLite database (no real DB needed).
- Firebase auth is mocked — every request is authenticated as a test UID.
- External HTTP calls (TMDb, TVMaze, OMDb) are mocked at the service layer.
- Email sending is always mocked.
"""

import os
import sys

# Set required env vars before any app code is imported
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("TMDB_BEARER_TOKEN", "test-token")
os.environ.setdefault("FIREBASE_CREDS_PATH", "firebase-service.json")
os.environ.setdefault("RESEND_API_KEY", "test-key")
os.environ.setdefault("EMAIL_FROM", "test@test.com")
os.environ.setdefault("OMDB_API_KEY", "test-key")
os.environ.setdefault("ICAL_SECRET", "test-secret")
os.environ.setdefault("UNSUBSCRIBE_KEY", "test-unsubscribe")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")
os.environ.setdefault("ENVIRONMENT", "test")

import pytest
from datetime import date
from unittest.mock import MagicMock
from fastapi import Request as FastAPIRequest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Patch Firebase before anything imports firebase_admin
firebase_mock = MagicMock()
firebase_mock.verify_id_token.return_value = {"uid": "test-uid-1"}
sys.modules["firebase_admin"] = MagicMock()
sys.modules["firebase_admin.auth"] = firebase_mock
sys.modules["firebase_admin.credentials"] = MagicMock()
sys.modules["firebase_admin._apps"] = {}

# -- SQLite test engine (StaticPool = one shared in-memory DB) ---------------
engine = create_engine(
    "sqlite:///./test.db",
    connect_args={"check_same_thread": False},
)
# expire_on_commit=False prevents re-queries after commit, reducing cursor churn
TestingSessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=engine, expire_on_commit=False
)

# Patch the app's session module BEFORE importing app code that uses it
import app.db.session as _app_session

_app_session.engine = engine
_app_session.SessionLocal = sessionmaker(
    autocommit=False, autoflush=False, bind=engine, expire_on_commit=False
)

from app.db.base import Base
from app.db.session import get_db
from app.main import app

# Disable rate limiting in tests so repeated calls don't get throttled
from app.core.limiter import limiter

limiter.enabled = False


def create_tables():
    # Import all models so metadata is populated
    import app.models.user
    import app.models.show
    import app.models.movie
    import app.models.episode
    import app.models.season
    import app.models.genre
    import app.models.provider
    import app.models.watchlist
    import app.models.watched
    import app.models.currently_watching
    import app.models.episode_watched
    import app.models.favorite
    import app.models.recommendation
    import app.models.friendship
    import app.models.activity
    import app.models.review

    Base.metadata.create_all(bind=engine)


create_tables()


@pytest.fixture(autouse=True)
def reset_db():
    """Drop and recreate all tables between tests for full isolation."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _make_override_get_db():
    """Return a FastAPI dependency that creates its own session and always rolls back on close."""

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.rollback()
            session.close()

    return override_get_db


def make_client(uid: str = "test-uid-1"):
    """
    Return a TestClient authenticated as the given uid.

    Uses a header-based auth override so multiple clients with different
    UIDs can coexist.
    """
    app.dependency_overrides[get_db] = _make_override_get_db()

    from app.dependencies.auth import get_current_user

    # Read UID from X-Test-UID header so each client carries its own identity
    async def _uid_from_header(request: FastAPIRequest):
        return request.headers.get("X-Test-UID", "test-uid-1")

    app.dependency_overrides[get_current_user] = _uid_from_header

    client = TestClient(
        app,
        raise_server_exceptions=True,
        base_url="http://localhost",
        headers={"X-Test-UID": uid},
    )
    return client


@pytest.fixture
def client():
    return make_client("test-uid-1")


@pytest.fixture
def client2():
    """A second authenticated user for multi-user tests."""
    return make_client("test-uid-2")


# -- Pre-seeded DB helpers ----------------------------------------------------


@pytest.fixture
def seed_users(db):
    """Insert two User rows directly."""
    from app.models.user import User

    u1 = User(id="test-uid-1", username="alice", email="alice@test.com")
    u2 = User(id="test-uid-2", username="bob", email="bob@test.com")
    db.add_all([u1, u2])
    db.commit()
    return u1, u2


@pytest.fixture
def seed_movie(db):
    """Insert a Movie row directly (bypasses TMDb)."""
    from app.models.movie import Movie

    m = Movie(
        id=550,
        title="Fight Club",
        status="Released",
        release_date=date(1999, 10, 15),
        runtime=139,
        overview="Test overview",
        tracking_count=0,
        vote_average=8.4,
    )
    db.add(m)
    db.commit()
    return m


@pytest.fixture
def seed_show(db):
    """Insert a Show + one Season + two Episodes directly."""
    from app.models.show import Show
    from app.models.season import Season
    from app.models.episode import Episode

    s = Show(
        id=1396,
        name="Breaking Bad",
        status="Ended",
        first_air_date=date(2008, 1, 20),
        number_of_seasons=5,
        number_of_episodes=62,
        overview="Test overview",
        tracking_count=0,
        vote_average=9.5,
    )
    db.add(s)
    db.flush()
    season = Season(
        id=3572,
        show_id=1396,
        season_number=1,
        name="Season 1",
        episode_count=7,
    )
    db.add(season)
    db.flush()
    ep1 = Episode(
        id=62085,
        show_id=1396,
        season_number=1,
        episode_number=1,
        name="Pilot",
        air_date=date(2008, 1, 20),
    )
    ep2 = Episode(
        id=62086,
        show_id=1396,
        season_number=1,
        episode_number=2,
        name="Cat's in the Bag",
        air_date=date(2008, 1, 27),
    )
    db.add_all([ep1, ep2])
    db.commit()
    return s
