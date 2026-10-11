"""Friend suggestions: friends-of-friends first (by mutual count), then the
most-connected users, never anyone already connected, blocked, private,
banned or without a username."""

import pytest

from app.models.block import Block
from app.models.friendship import Friendship
from app.models.user import User
from app.services import friends_service
from app.services.friends_service import get_suggested_friends


@pytest.fixture(autouse=True)
def _fresh_popularity_cache():
    cache = getattr(friends_service, "_popular_cache", {})
    cache.clear()
    yield
    cache.clear()


def _user(db, uid, **kw):
    db.add(User(id=uid, username=kw.pop("username", uid), email=f"{uid}@t.com",
                profile_visibility=kw.pop("visibility", "public"), **kw))


def _link(db, a, b, status="accepted"):
    db.add(Friendship(requester_id=a, addressee_id=b, status=status))


def _ids(rows):
    return [r["id"] for r in rows]


@pytest.fixture
def network(db):
    """me — a, b (friends). a and b both know m2; a knows m1. p1/p2 are
    popular strangers (p1 has 3 connections, p2 has 2)."""
    for uid in ["me", "a", "b", "m1", "m2", "p1", "p2", "x1", "x2", "x3"]:
        _user(db, uid)
    db.flush()
    _link(db, "me", "a")
    _link(db, "b", "me")
    _link(db, "a", "m1")
    _link(db, "a", "m2")
    _link(db, "m2", "b", status="following")
    _link(db, "p1", "x1")
    _link(db, "p1", "x2")
    _link(db, "x3", "p1")
    _link(db, "p2", "x1")
    _link(db, "p2", "x2")
    db.commit()


class TestOrdering:
    def test_mutual_friends_first_then_most_connected(self, db, network):
        rows = get_suggested_friends(db, "me", limit=4)
        assert _ids(rows)[:2] == ["m2", "m1"]
        assert rows[0]["mutual_friends"] == 2 and rows[0]["reason"] == "mutual_friends"
        assert _ids(rows)[2:] == ["p1", "p2"]
        assert rows[2]["reason"] == "popular"

    def test_limit_is_respected(self, db, network):
        assert len(get_suggested_friends(db, "me", limit=3)) == 3


class TestExclusions:
    def test_never_suggests_self_or_existing_connections(self, db, network):
        _link(db, "me", "p2", status="pending")
        db.commit()
        ids = _ids(get_suggested_friends(db, "me", limit=20))
        assert not {"me", "a", "b", "p2"} & set(ids)

    def test_blocked_in_either_direction_is_excluded(self, db, network):
        db.add(Block(blocker_id="me", blocked_id="m2"))
        db.add(Block(blocker_id="p1", blocked_id="me"))
        db.commit()
        ids = _ids(get_suggested_friends(db, "me", limit=20))
        assert "m2" not in ids and "p1" not in ids

    def test_private_banned_and_nameless_users_are_excluded(self, db, network):
        db.query(User).filter_by(id="m1").update({"profile_visibility": "private"})
        db.query(User).filter_by(id="p1").update({"is_banned": True})
        db.query(User).filter_by(id="p2").update({"username": None})
        db.commit()
        ids = _ids(get_suggested_friends(db, "me", limit=20))
        assert not {"m1", "p1", "p2"} & set(ids)


class TestPopularityRankingIsShared:
    """Ranking everyone by connection count reads the whole friendship table;
    it's the same for every user, so it's computed once and reused."""

    def test_second_request_does_not_recount_everyone(self, db, network, count_queries):
        with count_queries() as first:
            get_suggested_friends(db, "me")
        with count_queries() as second:
            get_suggested_friends(db, "a")
        assert second.value < first.value
