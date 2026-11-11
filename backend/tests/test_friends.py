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


def _search(client, q):
    r = client.get("/friends/search", params={"q": q})
    assert r.status_code == 200
    return [u["username"] for u in r.json()]


def _add_users(db, *specs):
    """specs: (id, username[, display_name[, profile_visibility]])"""
    from app.models.user import User

    db.add(User(id="test-uid-1", username="me"))
    for spec in specs:
        uid, username, *rest = spec
        kwargs = {}
        if len(rest) > 0:
            kwargs["display_name"] = rest[0]
        if len(rest) > 1:
            kwargs["profile_visibility"] = rest[1]
        db.add(User(id=uid, username=username, **kwargs))
    db.commit()


def _relate(db, requester, addressee, status):
    from app.models.friendship import Friendship

    db.add(Friendship(requester_id=requester, addressee_id=addressee, status=status))
    db.commit()


class TestFriendSearchHardening:
    def test_percent_matches_nothing(self, client, db):
        _add_users(db, ("u2", "bob"), ("u3", "carol"))
        assert _search(client, "%%") == []
        assert _search(client, "_ _") == []

    def test_percent_and_underscore_are_literal(self, client, db):
        _add_users(db, ("u2", "abc"), ("u3", "a_c"), ("u4", "50%off"))
        assert _search(client, "a_c") == ["a_c"]
        assert _search(client, "_c") == []
        assert _search(client, "0%") == []
        assert _search(client, "50%") == ["50%off"]
        assert _search(client, "%%") == []
        assert _search(client, "__") == []

    def test_backslash_is_literal(self, client, db):
        _add_users(db, ("u2", "abc"), ("u3", "a\\c"))
        assert _search(client, "a\\c") == ["a\\c"]

    def test_two_chars_is_prefix_only(self, client, db):
        _add_users(db, ("u2", "bobby"), ("u3", "abob"))
        assert _search(client, "bo") == ["bobby"]

    def test_three_chars_is_contains(self, client, db):
        _add_users(db, ("u2", "bobby"), ("u3", "abobx"), ("u4", "zed"))
        assert sorted(_search(client, "bob")) == ["abobx", "bobby"]

    def test_case_insensitive(self, client, db):
        _add_users(db, ("u2", "BobbY"))
        assert _search(client, "BOB") == ["BobbY"]
        assert _search(client, "bo") == ["BobbY"]

    def test_display_name_not_matched_for_stranger(self, client, db):
        _add_users(db, ("u2", "xyz123", "Jonathan Smith"))
        assert _search(client, "jonathan") == []

    def test_display_name_matched_for_friend(self, client, db):
        _add_users(db, ("u2", "xyz123", "Jonathan Smith"))
        _relate(db, "u2", "test-uid-1", "accepted")
        assert _search(client, "jonathan") == ["xyz123"]
        assert _search(client, "jo") == ["xyz123"]

    def test_display_name_not_matched_for_pending(self, client, db):
        _add_users(db, ("u2", "xyz123", "Jonathan Smith"))
        _relate(db, "u2", "test-uid-1", "pending")
        assert _search(client, "jonathan") == []

    def test_private_hidden_from_stranger(self, client, db):
        _add_users(db, ("u2", "secret", None, "private"), ("u3", "secure", None, "friends_only"))
        assert _search(client, "sec") == ["secure"]

    def test_private_visible_to_friend(self, client, db):
        _add_users(db, ("u2", "secret", None, "private"))
        _relate(db, "test-uid-1", "u2", "accepted")
        assert _search(client, "secret") == ["secret"]

    def test_private_visible_with_pending_either_direction(self, client, db):
        _add_users(
            db,
            ("u2", "secret", None, "private"),
            ("u3", "secure", None, "private"),
        )
        _relate(db, "test-uid-1", "u2", "pending")
        _relate(db, "u3", "test-uid-1", "pending")
        assert sorted(_search(client, "sec")) == ["secret", "secure"]

    def test_private_hidden_after_declined(self, client, db):
        _add_users(db, ("u2", "secret", None, "private"))
        _relate(db, "test-uid-1", "u2", "declined")
        assert _search(client, "secre") == []

    def test_private_found_by_exact_handle_only(self, client, db):
        _add_users(db, ("u2", "Secret", "Sam Secret", "private"))
        assert _search(client, "secret") == ["Secret"]
        assert _search(client, "SECRET") == ["Secret"]
        assert _search(client, "secre") == []
        assert _search(client, "ecret") == []
        # A display name is never a way in for a stranger.
        assert _search(client, "Sam Secret") == []

    def test_excludes_self_and_blocked_both_ways(self, client, db):
        from app.models.block import Block

        _add_users(db, ("u2", "mebob"), ("u3", "mecat"), ("u4", "medog"))
        db.add(Block(blocker_id="test-uid-1", blocked_id="u2"))
        db.add(Block(blocker_id="u3", blocked_id="test-uid-1"))
        db.commit()
        assert _search(client, "me") == ["medog"]

    def test_order_exact_prefix_contains(self, client, db):
        _add_users(
            db,
            ("u2", "zbobz"),
            ("u3", "bobby"),
            ("u4", "bob"),
            ("u5", "abob"),
            ("u6", "bobalpha"),
        )
        assert _search(client, "bob") == ["bob", "bobalpha", "bobby", "abob", "zbobz"]

    def test_limit_applies_after_ordering(self, client, db):
        specs = [(f"u{i}", f"zzbob{i:02d}") for i in range(2, 14)]
        specs.append(("u99", "bob"))
        _add_users(db, *specs)
        results = _search(client, "bob")
        assert len(results) == 10
        assert results[0] == "bob"

    def test_response_fields(self, client, db):
        _add_users(db, ("u2", "bobby"))
        r = client.get("/friends/search", params={"q": "bob"})
        assert set(r.json()[0]) == {"id", "username", "display_name", "profile_visibility"}

    def test_one_char_rejected(self, client, db):
        _add_users(db, ("u2", "bobby"))
        assert client.get("/friends/search", params={"q": "b"}).status_code == 422
        assert client.get("/friends/search", params={"q": "%"}).status_code == 422

    def test_whitespace_only_returns_empty(self, client, db):
        _add_users(db, ("u2", "bobby"))
        r = client.get("/friends/search", params={"q": "   "})
        assert r.status_code == 200
        assert r.json() == []

    def test_padded_single_char_returns_empty(self, client, db):
        _add_users(db, ("u2", "bobby"))
        r = client.get("/friends/search", params={"q": " b "})
        assert r.status_code == 200
        assert r.json() == []
