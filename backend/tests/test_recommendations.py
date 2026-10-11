"""
Tests for recommendation endpoints: send, inbox, unread count, mark read, delete.
"""

import pytest
from tests.conftest import make_client


def _seed_both_users(db):
    from app.models.user import User

    db.add(User(id="test-uid-1", username="alice", email="alice@test.com"))
    db.add(User(id="test-uid-2", username="bob", email="bob@test.com"))
    db.commit()


def _make_friends(db):
    """Seed two users and create an accepted friendship between them."""
    from app.models.user import User
    from app.models.friendship import Friendship

    db.add(User(id="test-uid-1", username="alice", email="alice@test.com"))
    db.add(User(id="test-uid-2", username="bob", email="bob@test.com"))
    db.flush()
    db.add(
        Friendship(
            requester_id="test-uid-1", addressee_id="test-uid-2", status="accepted"
        )
    )
    db.commit()


def _send(client, recipient="bob", content_type="movie", content_id=550, message=None):
    payload = {
        "recipient_username": recipient,
        "content_type": content_type,
        "content_id": content_id,
        "content_title": "Fight Club",
        "content_poster_path": "/test.jpg",
    }
    if message:
        payload["message"] = message
    return client.post("/recommendations/send", json=payload)


class TestRecommendationSend:
    def test_send_to_existing_user(self, client, db, seed_movie):
        _make_friends(db)
        r = _send(client)
        assert r.status_code == 200

    def test_send_requires_friendship(self, client, db, seed_movie):
        # Users exist but are not friends — should get 403
        _seed_both_users(db)
        r = _send(client)
        assert r.status_code == 403

    def test_send_to_nonexistent_user_returns_error(self, client, db, seed_movie):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = _send(client, recipient="nobody")
        assert r.status_code in (400, 404)

    def test_send_to_self_returns_error(self, client, db, seed_movie):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = _send(client, recipient="alice")
        assert r.status_code in (400, 422)

    def test_send_invalid_content_type(self, client, db):
        _make_friends(db)
        r = client.post(
            "/recommendations/send",
            json={
                "recipient_username": "bob",
                "content_type": "podcast",
                "content_id": 1,
                "content_title": "Test",
            },
        )
        assert r.status_code == 422

    def test_send_with_message(self, client, db, seed_movie):
        _make_friends(db)
        r = _send(client, message="You'll love this!")
        assert r.status_code == 200

    def test_send_creates_db_row(self, client, db, seed_movie):
        from app.models.recommendation import Recommendation

        _make_friends(db)
        _send(client)
        db.expire_all()
        rows = db.query(Recommendation).filter_by(sender_id="test-uid-1").all()
        assert len(rows) == 1

    def test_send_show(self, client, db, seed_show):
        _make_friends(db)
        r = _send(client, content_type="tv", content_id=1396)
        assert r.status_code == 200


class TestRecommendationInbox:
    def test_inbox_empty(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = client.get("/recommendations/inbox")
        assert r.status_code == 200
        assert r.json() == []

    def test_inbox_contains_received_rec(self, db, seed_movie):
        _make_friends(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        _send(c1)  # alice sends to bob
        r = c2.get("/recommendations/inbox")
        assert len(r.json()) == 1

    def test_inbox_does_not_show_sent_recs(self, db, seed_movie):
        _make_friends(db)
        c1 = make_client("test-uid-1")
        _send(c1)
        r = c1.get("/recommendations/inbox")
        assert r.json() == []


class TestRecommendationUnreadCount:
    def test_unread_count_zero(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = client.get("/recommendations/unread-count")
        assert r.json()["count"] == 0

    def test_unread_count_increments(self, db, seed_movie):
        _make_friends(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        _send(c1)
        r = c2.get("/recommendations/unread-count")
        assert r.json()["count"] == 1


class TestRecommendationMarkRead:
    def test_mark_read(self, db, seed_movie):
        _make_friends(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        _send(c1)
        inbox = c2.get("/recommendations/inbox").json()
        rec_id = inbox[0]["id"]

        r = c2.patch(f"/recommendations/{rec_id}/read")
        assert r.status_code == 200

        count = c2.get("/recommendations/unread-count").json()["count"]
        assert count == 0

    def test_mark_read_wrong_user_fails(self, db, seed_movie):
        _make_friends(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        _send(c1)
        inbox = c2.get("/recommendations/inbox").json()
        rec_id = inbox[0]["id"]

        # User 1 (sender) tries to mark recipient's rec as read
        r = c1.patch(f"/recommendations/{rec_id}/read")
        assert r.status_code in (403, 404)


class TestRecommendationDelete:
    def test_delete_recommendation(self, db, seed_movie):
        _make_friends(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        _send(c1)
        inbox = c2.get("/recommendations/inbox").json()
        rec_id = inbox[0]["id"]

        r = c2.delete(f"/recommendations/{rec_id}")
        assert r.status_code == 200

        inbox_after = c2.get("/recommendations/inbox").json()
        assert inbox_after == []

    def test_delete_wrong_user_fails(self, db, seed_movie):
        _make_friends(db)
        c1 = make_client("test-uid-1")
        c2 = make_client("test-uid-2")
        _send(c1)
        inbox = c2.get("/recommendations/inbox").json()
        rec_id = inbox[0]["id"]

        r = c1.delete(f"/recommendations/{rec_id}")
        assert r.status_code in (403, 404)

    def test_delete_nonexistent(self, client, db):
        from app.models.user import User

        db.add(User(id="test-uid-1", username="alice"))
        db.commit()
        r = client.delete("/recommendations/99999")
        assert r.status_code in (200, 404)


class TestTitleComesFromTheCatalog:
    """The sender's client used to supply the title and poster that land in
    the recipient's inbox, push and email — so it could say anything."""

    def _send_spoofed(self, client, content_type="movie", content_id=550):
        return client.post("/recommendations/send", json={
            "recipient_username": "bob",
            "content_type": content_type,
            "content_id": content_id,
            "content_title": "WIN A PRIZE at evil.example",
            "content_poster_path": '/x.jpg" onerror="alert(1)',
        })

    def _stored(self, db):
        from app.models.recommendation import Recommendation

        db.expire_all()
        return db.query(Recommendation).filter_by(sender_id="test-uid-1").one()

    def test_cached_title_and_poster_are_used(self, client, db, seed_movie):
        seed_movie.poster_path = "/fightclub.jpg"
        db.commit()
        _make_friends(db)

        assert self._send_spoofed(client).status_code == 200

        rec = self._stored(db)
        assert (rec.content_title, rec.content_poster_path) == ("Fight Club", "/fightclub.jpg")

    def test_uncached_title_is_looked_up_on_tmdb(self, client, db):
        from unittest.mock import patch

        _make_friends(db)
        with patch("app.services.recommendation_service.fetch_movie_from_tmdb_cached",
                   return_value={"id": 329865, "title": "Arrival", "poster_path": "/arrival.jpg"}):
            assert self._send_spoofed(client, content_id=329865).status_code == 200

        rec = self._stored(db)
        assert (rec.content_title, rec.content_poster_path) == ("Arrival", "/arrival.jpg")

    def test_title_tmdb_doesnt_know_is_rejected(self, client, db):
        from unittest.mock import patch
        from app.models.recommendation import Recommendation

        _make_friends(db)
        with patch("app.services.recommendation_service.fetch_show_from_tmdb_cached",
                   side_effect=RuntimeError("404 Not Found")):
            r = self._send_spoofed(client, content_type="tv", content_id=99999999)

        assert r.status_code == 404
        assert db.query(Recommendation).count() == 0


class TestSenderPrivacy:
    def test_email_never_stands_in_for_a_missing_username(self, client, db, seed_movie):
        # A sender without a username used to be shown to the recipient by
        # their email address.
        from unittest.mock import patch
        from app.models.user import User

        _make_friends(db)
        db.query(User).filter_by(id="test-uid-1").update({"username": None})
        db.query(User).filter_by(id="test-uid-2").update({"email_notifications": True})
        db.commit()

        with patch("app.routers.recommendations.send_recommendation_email") as send:
            client.post("/recommendations/send", json={
                "recipient_username": "bob", "content_type": "movie", "content_id": 550,
            })

        params = send.call_args.kwargs
        assert "alice@test.com" not in params["from_username"]
