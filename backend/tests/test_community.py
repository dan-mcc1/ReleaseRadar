"""
Tests for the community (groups) feature: CRUD, visibility, membership,
media, posts/replies, likes.

Routes live in app.routers.community and delegate to app.services.community_service.
These tests hit the HTTP layer so both are exercised.
"""

import pytest

from tests.conftest import make_client


# ── Helpers ────────────────────────────────────────────────────────────────


@pytest.fixture
def three_users(db):
    """alice (test-uid-1), bob (test-uid-2), and carol — covers role hierarchy."""
    from app.models.user import User

    a = User(id="test-uid-1", username="alice", email="a@test.com")
    b = User(id="test-uid-2", username="bob", email="b@test.com")
    c = User(id="carol-uid", username="carol", email="c@test.com")
    db.add_all([a, b, c])
    db.commit()
    return a, b, c


@pytest.fixture
def carol_client(three_users):
    return make_client("carol-uid")


def _create_group(client, name="Movie Buffs", visibility="public",
                  description=None, banner_color=None):
    body = {"name": name, "visibility": visibility}
    if description is not None:
        body["description"] = description
    if banner_color is not None:
        body["banner_color"] = banner_color
    return client.post("/communities", json=body)


# ── Create / Read / Update / Delete ───────────────────────────────────────


class TestCreateCommunity:
    def test_create_public(self, client, three_users):
        r = _create_group(client)
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Movie Buffs"
        assert data["visibility"] == "public"
        assert data["member_count"] == 1
        assert data["viewer_role"] == "owner"

    def test_create_private(self, client, three_users):
        r = _create_group(client, visibility="private")
        assert r.json()["visibility"] == "private"

    def test_name_too_short_rejected(self, client, three_users):
        r = _create_group(client, name="x")
        assert r.status_code == 422

    def test_name_too_long_rejected(self, client, three_users):
        r = _create_group(client, name="x" * 51)
        assert r.status_code == 422

    def test_invalid_visibility_rejected(self, client, three_users):
        r = client.post("/communities", json={"name": "Foo", "visibility": "secret"})
        assert r.status_code == 422

    def test_invalid_banner_color_rejected(self, client, three_users):
        r = _create_group(client, banner_color="red")
        assert r.status_code == 422

    def test_owner_limit_enforced(self, client, three_users):
        for i in range(10):
            assert _create_group(client, name=f"Group {i}").status_code == 200
        r = _create_group(client, name="Group 11")
        assert r.status_code == 429

    def test_creator_is_auto_member(self, client, three_users, db):
        r = _create_group(client)
        cid = r.json()["id"]
        from app.models.community import CommunityMember
        m = db.query(CommunityMember).filter_by(
            community_id=cid, user_id="test-uid-1"
        ).first()
        assert m is not None
        assert m.role == "owner"


class TestGetCommunity:
    def test_get_public_by_slug(self, client, three_users):
        slug = _create_group(client).json()["slug"]
        r = client.get(f"/communities/{slug}")
        assert r.status_code == 200
        assert r.json()["viewer_role"] == "owner"

    def test_unknown_slug_404(self, client, three_users):
        r = client.get("/communities/does-not-exist")
        assert r.status_code == 404

    def test_private_group_hidden_from_non_members(
        self, client, client2, three_users
    ):
        slug = _create_group(client, visibility="private").json()["slug"]
        r = client2.get(f"/communities/{slug}")
        assert r.status_code == 404  # 404 to avoid leaking existence

    def test_private_group_visible_to_owner(self, client, three_users):
        slug = _create_group(client, visibility="private").json()["slug"]
        r = client.get(f"/communities/{slug}")
        assert r.status_code == 200


class TestUpdateCommunity:
    def test_owner_can_update(self, client, three_users):
        cid = _create_group(client).json()["id"]
        r = client.patch(f"/communities/{cid}", json={"name": "Renamed"})
        assert r.status_code == 200
        assert r.json()["name"] == "Renamed"

    def test_non_member_cannot_update(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        r = client2.patch(f"/communities/{cid}", json={"name": "Hacked"})
        assert r.status_code == 403

    def test_regular_member_cannot_update(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client2.patch(f"/communities/{cid}", json={"name": "Member edit"})
        assert r.status_code == 403


class TestDeleteCommunity:
    def test_owner_can_delete(self, client, three_users, db):
        cid = _create_group(client).json()["id"]
        r = client.delete(f"/communities/{cid}")
        assert r.status_code == 200
        from app.models.community import Community
        assert db.query(Community).filter_by(id=cid).first() is None

    def test_non_owner_cannot_delete(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client2.delete(f"/communities/{cid}")
        assert r.status_code == 403


# ── Browse / list ──────────────────────────────────────────────────────────


class TestBrowse:
    def test_browse_shows_public_groups(self, client, client2, three_users):
        _create_group(client, name="One")
        _create_group(client, name="Two", visibility="private")
        r = client2.get("/communities")
        names = {c["name"] for c in r.json()}
        assert "One" in names
        assert "Two" not in names  # private hidden from non-members

    def test_browse_shows_private_groups_to_members(
        self, client, client2, three_users
    ):
        cid = _create_group(client, name="Secret", visibility="private").json()["id"]
        # Owner invites bob
        client.post(f"/communities/{cid}/members/invite",
                    json={"username": "bob"})
        r = client2.get("/communities")
        assert "Secret" in {c["name"] for c in r.json()}

    def test_search_by_name(self, client, three_users):
        _create_group(client, name="Anime Fans")
        _create_group(client, name="Sci-Fi Fans")
        r = client.get("/communities?q=anime")
        names = {c["name"] for c in r.json()}
        assert "Anime Fans" in names
        assert "Sci-Fi Fans" not in names

    def test_mine_lists_my_memberships(self, client, three_users):
        _create_group(client, name="Mine 1")
        _create_group(client, name="Mine 2")
        r = client.get("/communities/mine")
        assert {c["name"] for c in r.json()} == {"Mine 1", "Mine 2"}


# ── Membership ─────────────────────────────────────────────────────────────


class TestJoinLeave:
    def test_join_public_group(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        r = client2.post(f"/communities/{cid}/join")
        assert r.status_code == 200
        assert r.json()["role"] == "member"

    def test_cannot_join_private_group(self, client, client2, three_users):
        cid = _create_group(client, visibility="private").json()["id"]
        r = client2.post(f"/communities/{cid}/join")
        assert r.status_code == 403

    def test_join_is_idempotent(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client2.post(f"/communities/{cid}/join")
        assert r.status_code == 200

    def test_member_can_leave(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client2.post(f"/communities/{cid}/leave")
        assert r.status_code == 200

    def test_sole_owner_cannot_leave(self, client, three_users):
        cid = _create_group(client).json()["id"]
        r = client.post(f"/communities/{cid}/leave")
        assert r.status_code == 400

    def test_leave_decrements_member_count(self, client, client2, three_users, db):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        client2.post(f"/communities/{cid}/leave")
        from app.models.community import Community
        db.expire_all()
        assert db.query(Community).filter_by(id=cid).first().member_count == 1


class TestInviteRemove:
    def test_owner_invites_member(self, client, three_users):
        cid = _create_group(client, visibility="private").json()["id"]
        r = client.post(f"/communities/{cid}/members/invite",
                        json={"username": "bob"})
        assert r.status_code == 200
        assert r.json()["role"] == "member"

    def test_invite_unknown_username_404(self, client, three_users):
        cid = _create_group(client).json()["id"]
        r = client.post(f"/communities/{cid}/members/invite",
                        json={"username": "ghost"})
        assert r.status_code == 404

    def test_cannot_double_invite(self, client, three_users):
        cid = _create_group(client).json()["id"]
        client.post(f"/communities/{cid}/members/invite",
                    json={"username": "bob"})
        r = client.post(f"/communities/{cid}/members/invite",
                        json={"username": "bob"})
        assert r.status_code == 409

    def test_non_owner_cannot_invite(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client2.post(f"/communities/{cid}/members/invite",
                        json={"username": "carol"})
        assert r.status_code == 403

    def test_owner_removes_member(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client.delete(f"/communities/{cid}/members/test-uid-2")
        assert r.status_code == 200

    def test_cannot_remove_owner(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        # bob (member) tries to remove alice (owner)
        r = client2.delete(f"/communities/{cid}/members/test-uid-1")
        # bob isn't owner/admin so 403 fires first
        assert r.status_code == 403

    def test_admin_cannot_remove_other_admin(
        self, client, client2, carol_client, three_users
    ):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        carol_client.post(f"/communities/{cid}/join")
        # Promote both to admin
        client.patch(f"/communities/{cid}/members/test-uid-2/role",
                     json={"role": "admin"})
        client.patch(f"/communities/{cid}/members/carol-uid/role",
                     json={"role": "admin"})
        # bob (admin) tries to remove carol (admin) — only owner allowed
        r = client2.delete(f"/communities/{cid}/members/carol-uid")
        assert r.status_code == 403


class TestSetRole:
    def test_owner_promotes_member_to_admin(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client.patch(f"/communities/{cid}/members/test-uid-2/role",
                         json={"role": "admin"})
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_non_owner_cannot_set_role(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        # bob (member) tries to promote himself
        r = client2.patch(f"/communities/{cid}/members/test-uid-2/role",
                          json={"role": "admin"})
        assert r.status_code == 403

    def test_invalid_role_rejected(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client.patch(f"/communities/{cid}/members/test-uid-2/role",
                         json={"role": "owner"})
        # owner isn't allowed via this endpoint (only admin/member). Pydantic
        # CommunityRole literal includes "owner" so it passes validation —
        # the service then returns 422.
        assert r.status_code == 422


class TestListMembers:
    def test_list_members_sorted_by_role(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client.get(f"/communities/{cid}/members")
        roles = [m["role"] for m in r.json()]
        assert roles == ["owner", "member"]  # owner first

    def test_private_group_members_hidden_from_outsiders(
        self, client, client2, three_users
    ):
        cid = _create_group(client, visibility="private").json()["id"]
        r = client2.get(f"/communities/{cid}/members")
        assert r.status_code == 404


# ── Media ──────────────────────────────────────────────────────────────────


class TestMedia:
    def test_member_can_add_media(self, client, three_users, seed_movie):
        cid = _create_group(client).json()["id"]
        r = client.post(f"/communities/{cid}/media",
                        json={"content_type": "movie", "content_id": 550})
        assert r.status_code == 200

    def test_non_member_cannot_add_media(
        self, client, client2, three_users, seed_movie
    ):
        cid = _create_group(client).json()["id"]
        r = client2.post(f"/communities/{cid}/media",
                         json={"content_type": "movie", "content_id": 550})
        assert r.status_code == 403

    def test_adding_same_media_returns_existing(
        self, client, three_users, seed_movie
    ):
        cid = _create_group(client).json()["id"]
        a = client.post(f"/communities/{cid}/media",
                        json={"content_type": "movie", "content_id": 550})
        b = client.post(f"/communities/{cid}/media",
                        json={"content_type": "movie", "content_id": 550})
        assert a.json()["id"] == b.json()["id"]

    def test_list_media_returns_movies_and_shows(
        self, client, three_users, seed_movie, seed_show
    ):
        cid = _create_group(client).json()["id"]
        client.post(f"/communities/{cid}/media",
                    json={"content_type": "movie", "content_id": 550})
        client.post(f"/communities/{cid}/media",
                    json={"content_type": "tv", "content_id": 1396})
        r = client.get(f"/communities/{cid}/media")
        data = r.json()
        assert len(data["movies"]) == 1
        assert len(data["shows"]) == 1

    def test_adder_can_remove_own_media(
        self, client, three_users, seed_movie
    ):
        cid = _create_group(client).json()["id"]
        mid = client.post(
            f"/communities/{cid}/media",
            json={"content_type": "movie", "content_id": 550},
        ).json()["id"]
        r = client.delete(f"/communities/{cid}/media/{mid}")
        assert r.status_code == 200

    def test_other_member_cannot_remove_someone_elses_media(
        self, client, client2, three_users, seed_movie
    ):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        mid = client.post(
            f"/communities/{cid}/media",
            json={"content_type": "movie", "content_id": 550},
        ).json()["id"]
        r = client2.delete(f"/communities/{cid}/media/{mid}")
        assert r.status_code == 403


# ── Posts ──────────────────────────────────────────────────────────────────


def _create_post(client, cid, body="hello there", title=None):
    payload = {"body": body}
    if title is not None:
        payload["title"] = title
    return client.post(f"/communities/{cid}/posts", json=payload)


class TestPosts:
    def test_member_can_post(self, client, three_users):
        cid = _create_group(client).json()["id"]
        r = _create_post(client, cid, body="my first post")
        assert r.status_code == 200
        assert r.json()["body"] == "my first post"

    def test_non_member_cannot_post(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        r = _create_post(client2, cid)
        assert r.status_code == 403

    def test_empty_post_rejected(self, client, three_users):
        cid = _create_group(client).json()["id"]
        r = _create_post(client, cid, body="   ")
        assert r.status_code == 422

    def test_list_posts(self, client, three_users):
        cid = _create_group(client).json()["id"]
        _create_post(client, cid, body="one")
        _create_post(client, cid, body="two")
        r = client.get(f"/communities/{cid}/posts")
        assert len(r.json()) == 2

    def test_private_group_posts_hidden_from_outsiders(
        self, client, client2, three_users
    ):
        cid = _create_group(client, visibility="private").json()["id"]
        _create_post(client, cid, body="secret")
        r = client2.get(f"/communities/{cid}/posts")
        assert r.status_code == 404

    def test_get_post_with_replies(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        r = client.get(f"/communities/posts/{pid}")
        assert r.status_code == 200
        assert r.json()["post"]["id"] == pid
        assert r.json()["replies"] == []

    def test_author_can_edit_own_post(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        r = client.patch(f"/communities/posts/{pid}", json={"body": "edited"})
        assert r.status_code == 200
        assert r.json()["body"] == "edited"
        assert r.json()["edited_at"] is not None

    def test_non_author_cannot_edit_post(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        client2.post(f"/communities/{cid}/join")
        r = client2.patch(f"/communities/posts/{pid}", json={"body": "hacked"})
        assert r.status_code == 403

    def test_author_can_delete_own_post(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        r = client.delete(f"/communities/posts/{pid}")
        assert r.status_code == 200

    def test_admin_can_delete_other_member_post(
        self, client, client2, three_users
    ):
        cid = _create_group(client).json()["id"]
        client2.post(f"/communities/{cid}/join")
        pid = _create_post(client2, cid).json()["id"]
        # alice (owner) deletes bob's post
        r = client.delete(f"/communities/posts/{pid}")
        assert r.status_code == 200


# ── Replies ────────────────────────────────────────────────────────────────


class TestReplies:
    def test_member_can_reply(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        r = client.post(f"/communities/posts/{pid}/replies",
                        json={"body": "I agree"})
        assert r.status_code == 200
        assert r.json()["body"] == "I agree"

    def test_non_member_cannot_reply(self, client, client2, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        r = client2.post(f"/communities/posts/{pid}/replies",
                         json={"body": "hi"})
        assert r.status_code == 403

    def test_reply_increments_post_reply_count(self, client, three_users, db):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        client.post(f"/communities/posts/{pid}/replies",
                    json={"body": "first"})
        client.post(f"/communities/posts/{pid}/replies",
                    json={"body": "second"})
        from app.models.community import CommunityPost
        db.expire_all()
        assert db.query(CommunityPost).filter_by(id=pid).first().reply_count == 2

    def test_empty_reply_rejected(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        r = client.post(f"/communities/posts/{pid}/replies",
                        json={"body": "   "})
        assert r.status_code == 422

    def test_author_can_edit_own_reply(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        rid = client.post(
            f"/communities/posts/{pid}/replies",
            json={"body": "v1"},
        ).json()["id"]
        r = client.patch(f"/communities/replies/{rid}", json={"body": "v2"})
        assert r.status_code == 200
        assert r.json()["body"] == "v2"

    def test_delete_reply_decrements_post_count(self, client, three_users, db):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        rid = client.post(
            f"/communities/posts/{pid}/replies",
            json={"body": "x"},
        ).json()["id"]
        client.delete(f"/communities/replies/{rid}")
        from app.models.community import CommunityPost
        db.expire_all()
        assert db.query(CommunityPost).filter_by(id=pid).first().reply_count == 0


# ── Likes ──────────────────────────────────────────────────────────────────


class TestLikes:
    def test_toggle_post_like_adds_then_removes(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        r1 = client.post(f"/communities/posts/{pid}/like")
        assert r1.json() == {"liked": True, "like_count": 1}
        r2 = client.post(f"/communities/posts/{pid}/like")
        assert r2.json() == {"liked": False, "like_count": 0}

    def test_toggle_reply_like_adds_then_removes(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        rid = client.post(
            f"/communities/posts/{pid}/replies", json={"body": "x"}
        ).json()["id"]
        r1 = client.post(f"/communities/replies/{rid}/like")
        assert r1.json()["liked"] is True
        r2 = client.post(f"/communities/replies/{rid}/like")
        assert r2.json()["liked"] is False

    def test_get_post_shows_viewer_liked_flag(self, client, three_users):
        cid = _create_group(client).json()["id"]
        pid = _create_post(client, cid).json()["id"]
        client.post(f"/communities/posts/{pid}/like")
        r = client.get(f"/communities/posts/{pid}")
        assert r.json()["post"]["viewer_liked"] is True
