"""End-to-end auction draft tests. Exercises the HTTP routes (which delegate
to fantasy_auction_service) plus the close_expired_nominations sweep."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import make_client


def _ensure_utc(dt):
    """SQLite drops timezone info on round-trip; normalize for comparison."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ─── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture
def league_and_season(db, seed_users, seed_movie, seed_show):
    """Two-member league (alice owner, bob member) with a current 90-day season."""
    from app.services.fantasy_league_service import (
        add_member_by_username,
        create_league,
        create_season,
    )

    league = create_league(db, "test-uid-1", name="Test League")
    add_member_by_username(db, "test-uid-1", league["id"], username="bob")

    now = datetime.now(timezone.utc)
    # Wide window so the seed_movie (Fight Club, 1999) and seed_show
    # (Breaking Bad, 2008) both fall inside the season window for tests.
    season = create_season(
        db,
        "test-uid-1",
        league["id"],
        code="summer",
        year=2026,
        starts_at=now - timedelta(days=365 * 30),
        ends_at=now + timedelta(days=365),
        make_current=True,
    )
    return league, season


@pytest.fixture
def alice():
    return make_client("test-uid-1")


@pytest.fixture
def bob():
    return make_client("test-uid-2")


def _start_draft_with_alice_first(client, league_id, season_id):
    """Helper: start draft with explicit order so alice nominates first."""
    return client.post(
        f"/fantasy/auction/{league_id}/seasons/{season_id}/start",
        json={"member_order": ["test-uid-1", "test-uid-2"]},
    )


# ─── Start draft ────────────────────────────────────────────────────────────


class TestStartDraft:
    def test_owner_starts(self, alice, league_and_season):
        league, season = league_and_season
        r = alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/start",
            json={},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "draft"
        assert len(data["nomination_order"]) == 2
        assert data["current_nominator_user_id"] in (
            "test-uid-1",
            "test-uid-2",
        )

    def test_non_owner_rejected(self, bob, league_and_season):
        league, season = league_and_season
        r = bob.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/start",
            json={},
        )
        assert r.status_code == 403

    def test_explicit_order_is_respected(self, alice, league_and_season):
        league, season = league_and_season
        r = _start_draft_with_alice_first(alice, league["id"], season["id"])
        assert r.status_code == 200
        assert r.json()["nomination_order"] == ["test-uid-1", "test-uid-2"]
        assert r.json()["current_nominator_user_id"] == "test-uid-1"

    def test_member_order_must_match_membership(self, alice, league_and_season):
        league, season = league_and_season
        r = alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/start",
            json={"member_order": ["test-uid-1", "ghost-user"]},
        )
        assert r.status_code == 422

    def test_cannot_restart_active_draft(self, alice, league_and_season):
        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        r = _start_draft_with_alice_first(alice, league["id"], season["id"])
        assert r.status_code == 409


# ─── Nominate ───────────────────────────────────────────────────────────────


class TestNominate:
    def test_current_nominator_opens_auction(
        self, alice, league_and_season, seed_movie
    ):
        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        r = alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/nominate",
            json={"content_type": "movie", "content_id": 550, "starting_bid": 10},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["content_id"] == 550
        assert data["current_high_bid"] == 10
        assert data["current_high_bidder_id"] == "test-uid-1"
        assert data["status"] == "open"

    def test_wrong_turn_rejected(self, alice, bob, league_and_season, seed_movie):
        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        r = bob.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/nominate",
            json={"content_type": "movie", "content_id": 550, "starting_bid": 10},
        )
        assert r.status_code == 403

    def test_starting_bid_above_budget_rejected(
        self, alice, league_and_season, seed_movie
    ):
        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        r = alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/nominate",
            json={
                "content_type": "movie",
                "content_id": 550,
                "starting_bid": 10000,
            },
        )
        assert r.status_code == 409

    def test_only_one_nomination_at_a_time(
        self, alice, league_and_season, seed_movie
    ):
        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/nominate",
            json={"content_type": "movie", "content_id": 550, "starting_bid": 10},
        )
        # Even if alice somehow nominated again, the open-nomination guard fires
        r = alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/nominate",
            json={"content_type": "movie", "content_id": 550, "starting_bid": 20},
        )
        assert r.status_code == 409

    def test_nonexistent_content_rejected(
        self, alice, league_and_season
    ):
        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        r = alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/nominate",
            json={
                "content_type": "movie",
                "content_id": 999_999,
                "starting_bid": 10,
            },
        )
        assert r.status_code == 404


# ─── Bidding ────────────────────────────────────────────────────────────────


class TestBidding:
    def _open_nomination(
        self, alice, league_id, season_id, content_id=550, starting_bid=10
    ):
        _start_draft_with_alice_first(alice, league_id, season_id)
        return alice.post(
            f"/fantasy/auction/{league_id}/seasons/{season_id}/nominate",
            json={
                "content_type": "movie",
                "content_id": content_id,
                "starting_bid": starting_bid,
            },
        ).json()

    def test_higher_bid_takes_lead(
        self, alice, bob, league_and_season, seed_movie
    ):
        league, season = league_and_season
        nom = self._open_nomination(alice, league["id"], season["id"])
        r = bob.post(
            f"/fantasy/auction/{league['id']}/nominations/{nom['id']}/bid",
            json={"amount": 20},
        )
        assert r.status_code == 200
        assert r.json()["current_high_bid"] == 20
        assert r.json()["current_high_bidder_id"] == "test-uid-2"

    def test_equal_bid_rejected(self, alice, bob, league_and_season, seed_movie):
        league, season = league_and_season
        nom = self._open_nomination(alice, league["id"], season["id"])
        r = bob.post(
            f"/fantasy/auction/{league['id']}/nominations/{nom['id']}/bid",
            json={"amount": 10},
        )
        assert r.status_code == 409

    def test_non_member_cannot_bid(
        self, alice, league_and_season, seed_movie
    ):
        league, season = league_and_season
        nom = self._open_nomination(alice, league["id"], season["id"])
        carol = make_client("ghost-uid")
        r = carol.post(
            f"/fantasy/auction/{league['id']}/nominations/{nom['id']}/bid",
            json={"amount": 50},
        )
        assert r.status_code == 404

    def test_snipe_extension(self, alice, bob, league_and_season, seed_movie, db):
        """If a bid lands inside the extension window, expires_at extends."""
        from app.models.fantasy import FantasyDraftNomination

        league, season = league_and_season
        nom_payload = self._open_nomination(alice, league["id"], season["id"])

        # Force the nomination to be about to expire (3 seconds left, extension is 600s).
        nom = db.get(FantasyDraftNomination, nom_payload["id"])
        nom.expires_at = datetime.now(timezone.utc) + timedelta(seconds=3)
        db.commit()

        before = _ensure_utc(nom.expires_at)

        r = bob.post(
            f"/fantasy/auction/{league['id']}/nominations/{nom_payload['id']}/bid",
            json={"amount": 20},
        )
        assert r.status_code == 200

        db.refresh(nom)
        after = _ensure_utc(nom.expires_at)
        assert after > before
        # New expiry should be ~extension_seconds from now (default 600).
        delta = (after - datetime.now(timezone.utc)).total_seconds()
        assert delta > 60  # well past the 3s that was left

    def test_bid_after_expiry_rejected(
        self, alice, bob, league_and_season, seed_movie, db
    ):
        from app.models.fantasy import FantasyDraftNomination

        league, season = league_and_season
        nom_payload = self._open_nomination(alice, league["id"], season["id"])

        nom = db.get(FantasyDraftNomination, nom_payload["id"])
        nom.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

        r = bob.post(
            f"/fantasy/auction/{league['id']}/nominations/{nom_payload['id']}/bid",
            json={"amount": 20},
        )
        assert r.status_code == 409


# ─── Closing expired nominations ────────────────────────────────────────────


class TestCloseExpired:
    def test_close_assigns_asset_and_deducts_budget(
        self, alice, league_and_season, seed_movie, db
    ):
        from app.models.fantasy import (
            FantasyAsset,
            FantasyDraftNomination,
            FantasyLeagueMember,
        )
        from app.services.fantasy_auction_service import (
            close_expired_nominations,
        )

        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        nom_payload = alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/nominate",
            json={"content_type": "movie", "content_id": 550, "starting_bid": 25},
        ).json()

        # Force expiry.
        nom = db.get(FantasyDraftNomination, nom_payload["id"])
        nom.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

        closed = close_expired_nominations(db)
        assert closed == 1

        # Refresh to see post-commit state.
        db.expire_all()
        nom = db.get(FantasyDraftNomination, nom_payload["id"])
        assert nom.status == "closed"
        assert nom.resulting_asset_id is not None

        asset = db.get(FantasyAsset, nom.resulting_asset_id)
        assert asset is not None
        assert asset.content_id == 550
        assert asset.owner_user_id == "test-uid-1"
        assert asset.auction_price == 25

        alice_member = (
            db.query(FantasyLeagueMember)
            .filter(
                FantasyLeagueMember.league_id == league["id"],
                FantasyLeagueMember.user_id == "test-uid-1",
            )
            .first()
        )
        # Started with starting_budget=200, paid 25 → 175.
        assert alice_member.budget_remaining == 175

    def test_close_advances_turn(
        self, alice, league_and_season, seed_movie, db
    ):
        from app.models.fantasy import FantasyDraftNomination, FantasySeason
        from app.services.fantasy_auction_service import (
            close_expired_nominations,
        )

        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        nom_payload = alice.post(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/nominate",
            json={"content_type": "movie", "content_id": 550, "starting_bid": 10},
        ).json()

        nom = db.get(FantasyDraftNomination, nom_payload["id"])
        nom.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        close_expired_nominations(db)

        db.expire_all()
        s = db.get(FantasySeason, season["id"])
        order = json.loads(s.nomination_order)
        assert order[s.next_nominator_index % len(order)] == "test-uid-2"


# ─── State endpoint ─────────────────────────────────────────────────────────


class TestState:
    def test_state_includes_members_and_slots(
        self, alice, league_and_season
    ):
        league, season = league_and_season
        _start_draft_with_alice_first(alice, league["id"], season["id"])
        r = alice.get(
            f"/fantasy/auction/{league['id']}/seasons/{season['id']}/state"
        )
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "draft"
        assert len(data["members"]) == 2
        for m in data["members"]:
            assert m["open_slots"]["movie"] == 4
            assert m["open_slots"]["tv"] == 3
            assert m["open_slots"]["flex"] == 1
