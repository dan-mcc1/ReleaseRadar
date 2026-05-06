"""
Tests for friend request lifecycle: send, accept, decline, cancel, remove,
visibility rules, and activity feed isolation.
"""

import pytest
from tests.conftest import make_client


def _seed_users(db, *extras):
    from app.models.user import User

    db.add(User(id="test-uid-1", username="alice"))
    db.add(User(id="test-uid-2", username="bob"))
    for uid, username in extras:
        db.add(User(id=uid, username=username))
    db.commit()


class TestFriendRequest:
    def test_send_request(self, client, db):
        _seed_users(db)
        r = client.post("/friends/request", json={"addressee_username": "bob"})
        assert r.status_code == 200

    def test_send_to_nonexistent_user(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = client.post("/friends/request", json={"addressee_username": "nobody"})
        assert r.status_code in (400, 404)

    def test_send_to_self_fails(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = client.post("/friends/request", json={"addressee_username": "alice"})
        assert r.status_code in (400, 422)

    def test_send_duplicate_request(self, client, db):
        _seed_users(db)
        client.post("/friends/request", json={"addressee_username": "bob"})
        r = client.post("/friends/request", json={"addressee_username": "bob"})
        assert r.status_code in (200, 409)

    def test_incoming_request_visible(self, db):
        _seed_users(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        c1.post("/friends/request", json={"addressee_username": "bob"})
        r = c2.get("/friends/requests/incoming")
        assert len(r.json()) == 1

    def test_outgoing_request_visible(self, db):
        _seed_users(db)
        c1 = make_client("test-uid-1")
        c1.post("/friends/request", json={"addressee_username": "bob"})
        r = c1.get("/friends/requests/outgoing")
        assert len(r.json()) == 1


class TestFriendRequestAcceptDecline:
    def _make_pending(self, db):
        _seed_users(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        r = c1.post("/friends/request", json={"addressee_username": "bob"})
        friendship_id = r.json()["id"]
        return c1, c2, friendship_id

    def test_accept_request(self, db):
        c1, c2, fid = self._make_pending(db)
        r = c2.patch("/friends/respond", json={"friendship_id": fid, "accept": True})
        assert r.status_code == 200

    def test_accept_makes_friends(self, db):
        c1, c2, fid = self._make_pending(db)
        c2.patch("/friends/respond", json={"friendship_id": fid, "accept": True})
        r = c1.get("/friends")
        friends = r.json()
        assert any(f["friend"]["id"] == "test-uid-2" for f in friends)

    def test_decline_request(self, db):
        c1, c2, fid = self._make_pending(db)
        r = c2.patch("/friends/respond", json={"friendship_id": fid, "accept": False})
        assert r.status_code == 200

    def test_decline_does_not_add_friend(self, db):
        c1, c2, fid = self._make_pending(db)
        c2.patch("/friends/respond", json={"friendship_id": fid, "accept": False})
        r = c1.get("/friends")
        assert r.json() == []

    def test_non_addressee_cannot_respond(self, db):
        _seed_users(db, ("test-uid-3", "carol"))
        c1 = make_client("test-uid-1")
        c3 = make_client("test-uid-3")
        r = c1.post("/friends/request", json={"addressee_username": "bob"})
        fid = r.json()["id"]
        r2 = c3.patch("/friends/respond", json={"friendship_id": fid, "accept": True})
        assert r2.status_code in (403, 404)


class TestFriendCancel:
    def test_cancel_outgoing_request(self, db):
        _seed_users(db)
        c1 = make_client("test-uid-1")
        r = c1.post("/friends/request", json={"addressee_username": "bob"})
        fid = r.json()["id"]
        r2 = c1.delete(f"/friends/cancel/{fid}")
        assert r2.status_code == 200

    def test_cancel_nonexistent_is_graceful(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = client.delete("/friends/cancel/99999")
        assert r.status_code in (200, 404)

    def test_addressee_cannot_cancel_others_request(self, db):
        _seed_users(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        r = c1.post("/friends/request", json={"addressee_username": "bob"})
        fid = r.json()["id"]
        r2 = c2.delete(f"/friends/cancel/{fid}")
        assert r2.status_code in (403, 404)


class TestFriendRemove:
    def _make_friends(self, db):
        _seed_users(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        r = c1.post("/friends/request", json={"addressee_username": "bob"})
        fid = r.json()["id"]
        c2.patch("/friends/respond", json={"friendship_id": fid, "accept": True})
        return c1, c2

    def test_remove_friend(self, db):
        c1, c2 = self._make_friends(db)
        r = c1.delete("/friends/remove/test-uid-2")
        assert r.status_code == 200

    def test_remove_friend_bidirectional(self, db):
        c1, c2 = self._make_friends(db)
        c1.delete("/friends/remove/test-uid-2")
        r = c2.get("/friends")
        assert r.json() == []

    def test_remove_nonexistent_friend_graceful(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = client.delete("/friends/remove/test-uid-99")
        assert r.status_code in (200, 404)


class TestFriendSearch:
    def test_search_finds_user(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.add(User(id="test-uid-2", username="bob"))
        db.commit()
        r = client.get("/friends/search?q=bob")
        assert r.status_code == 200
        results = r.json()
        assert any(u["username"] == "bob" for u in results)

    def test_search_excludes_self(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = client.get("/friends/search?q=alice")
        results = r.json()
        assert not any(u["id"] == "test-uid-1" for u in results)

    def test_search_partial_match(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.add(User(id="test-uid-2", username="alexander"))
        db.add(User(id="test-uid-3", username="bob"))
        db.commit()
        r = client.get("/friends/search?q=al")
        results = r.json()
        usernames = [u["username"] for u in results]
        assert "alexander" in usernames
        assert "bob" not in usernames
