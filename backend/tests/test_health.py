"""GET/HEAD /health: unauthenticated liveness that runs no SQL."""
from app.main import app


def test_health_ok_without_auth_or_sql(client):
    app.dependency_overrides.clear()  # no signed-in user
    r = client.get("/health")

    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
    assert r.headers["cache-control"] == "no-store"
    # Server-Timing's statement count: probes must not wake the database.
    assert r.headers["server-timing"].endswith('desc="0 queries"')


def test_health_answers_head(client):
    r = client.head("/health")
    assert r.status_code == 200
