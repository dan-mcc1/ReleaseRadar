"""Tests for app.routers.streaming."""

import pytest


@pytest.fixture
def seed_providers(db, seed_users):
    """Insert a couple of Provider rows for the picker."""
    from app.models.provider import Provider

    db.add(Provider(id=8, name="Netflix", logo_path="/netflix.png"))
    db.add(Provider(id=9, name="Amazon Prime Video", logo_path="/amz.png"))
    db.commit()


class TestListAllProviders:
    def test_returns_sorted_unique(self, client, seed_providers):
        r = client.get("/streaming/providers")
        assert r.status_code == 200
        body = r.json()
        names = [p["name"] for p in body]
        assert names == sorted(names)
        # At least the two providers we inserted
        assert any(p["id"] == 8 for p in body)
        assert any(p["id"] == 9 for p in body)


class TestGetMyServices:
    def test_empty_when_user_has_no_services(self, client, seed_providers):
        r = client.get("/streaming/services")
        assert r.status_code == 200
        assert r.json() == []

    def test_returns_saved_services(self, client, db, seed_providers):
        from app.models.user_streaming_service import UserStreamingService

        db.add(UserStreamingService(user_id="test-uid-1", provider_id=8))
        db.commit()
        r = client.get("/streaming/services")
        body = r.json()
        assert len(body) == 1
        assert body[0]["id"] == 8


class TestAddService:
    def test_unknown_provider_returns_404(self, client, seed_users):
        r = client.post("/streaming/services/99999")
        assert r.status_code == 404

    def test_adds_a_service(self, client, db, seed_providers):
        r = client.post("/streaming/services/8")
        assert r.status_code == 201
        assert r.json() == {"ok": True}
        from app.models.user_streaming_service import UserStreamingService

        rows = (
            db.query(UserStreamingService)
            .filter_by(user_id="test-uid-1")
            .all()
        )
        assert len(rows) == 1

    def test_idempotent_no_duplicate_on_repeat(self, client, db, seed_providers):
        client.post("/streaming/services/8")
        client.post("/streaming/services/8")
        from app.models.user_streaming_service import UserStreamingService

        rows = (
            db.query(UserStreamingService)
            .filter_by(user_id="test-uid-1")
            .all()
        )
        assert len(rows) == 1


class TestRemoveService:
    def test_removes_existing(self, client, db, seed_providers):
        from app.models.user_streaming_service import UserStreamingService

        db.add(UserStreamingService(user_id="test-uid-1", provider_id=8))
        db.commit()
        r = client.delete("/streaming/services/8")
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        assert (
            db.query(UserStreamingService).filter_by(user_id="test-uid-1").count()
            == 0
        )

    def test_remove_nonexistent_is_noop(self, client, seed_users):
        r = client.delete("/streaming/services/8")
        assert r.status_code == 200
        assert r.json() == {"ok": True}


class TestStreamingOptimizer:
    def test_empty_watchlist_returns_zeroed_payload(self, client, seed_users):
        r = client.get("/streaming/optimizer")
        assert r.status_code == 200
        body = r.json()
        assert body["total_items"] == 0
        assert body["items_with_streaming"] == 0
        assert body["coverage_by_provider"] == []
        assert body["uncovered_items"] == []
        assert body["suggested_combo"] == []

    def test_items_without_streaming_listed_in_no_streaming(
        self, client, db, seed_users, seed_show
    ):
        from app.models.watchlist import Watchlist

        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.commit()
        r = client.get("/streaming/optimizer")
        body = r.json()
        assert body["total_items"] == 1
        # No provider rows for this show
        assert body["items_with_streaming"] == 0
        assert len(body["no_streaming_items"]) == 1
        assert body["no_streaming_items"][0]["id"] == 1396

    def test_items_with_provider_recognized(self, client, db, seed_users, seed_show):
        from app.models.provider import Provider, ShowProvider
        from app.models.watchlist import Watchlist

        db.add(Provider(id=8, name="Netflix", logo_path="/n.png"))
        db.add(Watchlist(user_id="test-uid-1", content_type="tv", content_id=1396))
        db.flush()
        db.add(ShowProvider(show_id=1396, provider_id=8, flatrate=True))
        db.commit()

        r = client.get("/streaming/optimizer")
        body = r.json()
        assert body["items_with_streaming"] == 1
        assert len(body["coverage_by_provider"]) == 1
        assert body["coverage_by_provider"][0]["id"] == 8
        # User doesn't subscribe yet → item is uncovered
        assert any(i["id"] == 1396 for i in body["uncovered_items"])
        # And the suggested_combo should propose Netflix
        assert body["suggested_combo"]
        assert body["suggested_combo"][0]["id"] == 8
