"""
Tests for moderation endpoints: block/unblock, get my blocks, submit report.
Covers the validation literals (reported_type / reason) and the snapshot
capture logic for review and user reports.
"""

import pytest


# ── Helpers ────────────────────────────────────────────────────────────────


@pytest.fixture
def two_users(db):
    from app.models.user import User

    a = User(id="test-uid-1", username="alice", email="alice@test.com")
    b = User(id="test-uid-2", username="bob", email="bob@test.com")
    db.add_all([a, b])
    db.commit()
    return a, b


def _make_review(db, user_id, content_id=550, text="some review"):
    from app.models.review import Review

    r = Review(user_id=user_id, content_type="movie", content_id=content_id,
               review_text=text)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _make_community(db, name="Test Group", created_by="test-uid-2"):
    from app.models.community import Community

    c = Community(slug=name.lower().replace(" ", "-"), name=name,
                  visibility="public", created_by=created_by)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def _make_post(db, community_id, user_id, body="hello world"):
    from app.models.community import CommunityPost

    p = CommunityPost(community_id=community_id, user_id=user_id, body=body)
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def _make_reply(db, post_id, user_id, body="great post"):
    from app.models.community import CommunityReply

    r = CommunityReply(post_id=post_id, user_id=user_id, body=body)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


# ── Block endpoints ────────────────────────────────────────────────────────


class TestBlockUser:
    def test_block_user_succeeds(self, client, two_users):
        r = client.post("/moderation/block/test-uid-2")
        assert r.status_code == 200

        from app.models.block import Block
        from tests.conftest import TestingSessionLocal
        s = TestingSessionLocal()
        try:
            assert s.query(Block).filter_by(
                blocker_id="test-uid-1", blocked_id="test-uid-2"
            ).first() is not None
        finally:
            s.close()

    def test_cannot_block_self(self, client, two_users):
        r = client.post("/moderation/block/test-uid-1")
        assert r.status_code == 400

    def test_block_unknown_user_404(self, client, two_users):
        r = client.post("/moderation/block/does-not-exist")
        assert r.status_code == 404

    def test_duplicate_block_returns_409(self, client, two_users):
        client.post("/moderation/block/test-uid-2")
        r = client.post("/moderation/block/test-uid-2")
        assert r.status_code == 409


class TestUnblockUser:
    def test_unblock_succeeds(self, client, two_users):
        client.post("/moderation/block/test-uid-2")
        r = client.delete("/moderation/block/test-uid-2")
        assert r.status_code == 200

    def test_unblock_not_blocked_404(self, client, two_users):
        r = client.delete("/moderation/block/test-uid-2")
        assert r.status_code == 404


class TestGetMyBlocks:
    def test_empty_list(self, client, two_users):
        r = client.get("/moderation/blocks")
        assert r.status_code == 200
        assert r.json() == []

    def test_blocks_include_blocked_username(self, client, two_users):
        client.post("/moderation/block/test-uid-2")
        r = client.get("/moderation/blocks")
        rows = r.json()
        assert len(rows) == 1
        assert rows[0]["user_id"] == "test-uid-2"
        assert rows[0]["username"] == "bob"


# ── Submit report ──────────────────────────────────────────────────────────


def _submit_report(client, **overrides):
    body = {
        "reported_type": "review",
        "reported_id": "1",
        "reason": "spam",
    }
    body.update(overrides)
    return client.post("/moderation/report", json=body)


class TestSubmitReport:
    def test_report_review_captures_snapshot(self, client, two_users, db, seed_movie):
        review = _make_review(db, "test-uid-2", text="snapshot me")
        r = _submit_report(client, reported_type="review",
                           reported_id=str(review.id))
        assert r.status_code == 200

        from app.models.report import Report
        rpt = db.query(Report).first()
        assert rpt.reported_type == "review"
        assert rpt.snapshot_review_text == "snapshot me"
        assert rpt.snapshot_author_username == "bob"
        assert rpt.snapshot_content_id == 550

    def test_cannot_report_own_review(self, client, two_users, db, seed_movie):
        review = _make_review(db, "test-uid-1")
        r = _submit_report(client, reported_type="review",
                           reported_id=str(review.id))
        assert r.status_code == 400

    def test_report_nonexistent_review_404(self, client, two_users):
        r = _submit_report(client, reported_type="review", reported_id="99999")
        assert r.status_code == 404

    def test_review_id_must_be_numeric(self, client, two_users):
        r = _submit_report(client, reported_type="review", reported_id="abc")
        assert r.status_code == 400

    def test_report_user_captures_snapshot(self, client, two_users, db):
        r = _submit_report(client, reported_type="user", reported_id="test-uid-2")
        assert r.status_code == 200

        from app.models.report import Report
        rpt = db.query(Report).first()
        assert rpt.snapshot_user_username == "bob"
        assert rpt.snapshot_user_email == "bob@test.com"

    def test_cannot_report_self(self, client, two_users):
        r = _submit_report(client, reported_type="user", reported_id="test-uid-1")
        assert r.status_code == 400

    def test_report_unknown_user_404(self, client, two_users):
        r = _submit_report(client, reported_type="user", reported_id="ghost-uid")
        assert r.status_code == 404

    def test_duplicate_pending_report_returns_409(
        self, client, two_users, db, seed_movie
    ):
        review = _make_review(db, "test-uid-2")
        first = _submit_report(client, reported_type="review",
                               reported_id=str(review.id))
        assert first.status_code == 200
        dup = _submit_report(client, reported_type="review",
                             reported_id=str(review.id))
        assert dup.status_code == 409

    def test_invalid_reason_rejected_by_pydantic(self, client, two_users):
        r = _submit_report(client, reported_type="user",
                           reported_id="test-uid-2", reason="bogus")
        assert r.status_code == 422

    def test_invalid_reported_type_rejected_by_pydantic(self, client, two_users):
        r = _submit_report(client, reported_type="not_a_type",
                           reported_id="x")
        assert r.status_code == 422

    def test_message_over_max_rejected_by_pydantic(self, client, two_users, db, seed_movie):
        review = _make_review(db, "test-uid-2")
        # REPORT_MESSAGE_MAX_LEN is 1000 in common.py.
        r = _submit_report(
            client,
            reported_type="review",
            reported_id=str(review.id),
            message="x" * 1001,
        )
        assert r.status_code == 422


class TestSubmitReportCommunity:
    def test_report_community(self, client, two_users, db):
        c = _make_community(db)
        r = _submit_report(client, reported_type="community", reported_id=str(c.id))
        assert r.status_code == 200

    def test_report_unknown_community_404(self, client, two_users):
        r = _submit_report(client, reported_type="community", reported_id="99999")
        assert r.status_code == 404

    def test_community_id_must_be_numeric(self, client, two_users):
        r = _submit_report(client, reported_type="community", reported_id="abc")
        assert r.status_code == 400

    def test_report_community_post(self, client, two_users, db):
        c = _make_community(db)
        post = _make_post(db, c.id, "test-uid-2")
        r = _submit_report(client, reported_type="community_post",
                           reported_id=str(post.id))
        assert r.status_code == 200

    def test_cannot_report_own_post(self, client, two_users, db):
        c = _make_community(db)
        post = _make_post(db, c.id, "test-uid-1")
        r = _submit_report(client, reported_type="community_post",
                           reported_id=str(post.id))
        assert r.status_code == 400

    def test_report_community_reply(self, client, two_users, db):
        c = _make_community(db)
        post = _make_post(db, c.id, "test-uid-2")
        reply = _make_reply(db, post.id, "test-uid-2")
        r = _submit_report(client, reported_type="community_reply",
                           reported_id=str(reply.id))
        assert r.status_code == 200

    def test_cannot_report_own_reply(self, client, two_users, db):
        c = _make_community(db)
        post = _make_post(db, c.id, "test-uid-2")
        reply = _make_reply(db, post.id, "test-uid-1")
        r = _submit_report(client, reported_type="community_reply",
                           reported_id=str(reply.id))
        assert r.status_code == 400
