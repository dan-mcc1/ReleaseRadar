"""Households: membership rules, friends-only invites, the shared list,
progress on shared shows, and logging a watch for the room."""

from datetime import date, timedelta

import pytest

ALICE, BOB, CAROL = "test-uid-1", "test-uid-2", "test-uid-3"


@pytest.fixture
def people(db, seed_users):
    """alice and bob are friends; carol is friends with nobody."""
    from app.models.friendship import Friendship
    from app.models.user import User

    db.add(User(id=CAROL, username="carol", email="carol@test.com"))
    db.add(Friendship(requester_id=ALICE, addressee_id=BOB, status="accepted"))
    db.commit()


def _create(client, name="Us"):
    r = client.post("/households", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _join(client, client2, hid):
    """alice invites bob, bob accepts."""
    assert client.post(f"/households/{hid}/invites", json={"username": "bob"}).status_code == 201
    invite_id = client2.get("/households").json()["invites"][0]["id"]
    assert client2.post(f"/households/invites/{invite_id}/accept").status_code == 200


class TestMembership:
    def test_create_makes_you_owner(self, client, people):
        hid = _create(client)
        h = client.get(f"/households/{hid}").json()
        assert h["role"] == "owner"
        assert [m["username"] for m in h["members"]] == ["alice"]

    def test_household_limit(self, client, people):
        for i in range(5):
            _create(client, f"H{i}")
        r = client.post("/households", json={"name": "One too many"})
        assert r.status_code == 409

    def test_blank_name_rejected(self, client, people):
        assert client.post("/households", json={"name": "   "}).status_code == 422

    def test_invite_accept(self, client, client2, people):
        hid = _create(client)
        client.post(f"/households/{hid}/invites", json={"username": "bob"})
        assert client2.get("/households/invites/count").json() == {"count": 1}
        invite = client2.get("/households").json()["invites"][0]
        assert invite["household"]["name"] == "Us"
        assert invite["invited_by"]["username"] == "alice"

        assert client2.post(f"/households/invites/{invite['id']}/accept").status_code == 200
        assert client2.get("/households/invites/count").json() == {"count": 0}
        members = client.get(f"/households/{hid}").json()["members"]
        assert [(m["username"], m["role"]) for m in members] == [("alice", "owner"), ("bob", "member")]

    def test_only_friends_can_be_invited(self, client, people):
        hid = _create(client)
        r = client.post(f"/households/{hid}/invites", json={"username": "carol"})
        assert r.status_code == 404
        # Same answer for someone who doesn't exist.
        assert client.post(f"/households/{hid}/invites", json={"username": "nobody"}).status_code == 404

    def test_decline_then_reinvite(self, client, client2, people):
        hid = _create(client)
        client.post(f"/households/{hid}/invites", json={"username": "bob"})
        invite_id = client2.get("/households").json()["invites"][0]["id"]
        assert client2.post(f"/households/invites/{invite_id}/decline").status_code == 200
        assert client2.get("/households").json()["invites"] == []
        client.post(f"/households/{hid}/invites", json={"username": "bob"})
        assert len(client2.get("/households").json()["invites"]) == 1

    def test_cant_accept_someone_elses_invite(self, client, client2, people):
        hid = _create(client)
        r = client.post(f"/households/{hid}/invites", json={"username": "bob"}).json()
        assert client.post(f"/households/invites/{r['id']}/accept").status_code == 404

    def test_already_a_member(self, client, client2, people):
        hid = _create(client)
        _join(client, client2, hid)
        assert client.post(f"/households/{hid}/invites", json={"username": "bob"}).status_code == 409

    def test_size_limit_counts_pending_invites(self, client, db, people):
        from app.models.friendship import Friendship
        from app.models.household import HouseholdMember
        from app.models.user import User

        hid = _create(client)
        for i in range(4):
            db.add(User(id=f"m{i}", username=f"m{i}", email=f"m{i}@t.com"))
            db.flush()
            db.add(HouseholdMember(household_id=hid, user_id=f"m{i}"))
        db.commit()
        # 5 members + bob's invite = 6, the limit.
        assert client.post(f"/households/{hid}/invites", json={"username": "bob"}).status_code == 201
        db.add(Friendship(requester_id=ALICE, addressee_id=CAROL, status="accepted"))
        db.commit()
        assert client.post(f"/households/{hid}/invites", json={"username": "carol"}).status_code == 409

    def test_outsiders_see_nothing(self, client, client2, people):
        hid = _create(client)
        assert client2.get(f"/households/{hid}").status_code == 404
        assert client2.get(f"/households/{hid}/progress").status_code == 404
        assert client2.post(f"/households/{hid}/items", json={"content_type": "movie", "content_id": 550}).status_code == 404

    def test_only_owner_renames_and_deletes(self, client, client2, people):
        hid = _create(client)
        _join(client, client2, hid)
        assert client2.patch(f"/households/{hid}", json={"name": "Mine"}).status_code == 403
        assert client2.delete(f"/households/{hid}").status_code == 403
        assert client.patch(f"/households/{hid}", json={"name": "Ours"}).json()["name"] == "Ours"
        assert client.delete(f"/households/{hid}").status_code == 200
        assert client2.get("/households").json()["households"] == []

    def test_owner_leaving_hands_over(self, client, client2, people):
        hid = _create(client)
        _join(client, client2, hid)
        assert client.delete(f"/households/{hid}/members/{ALICE}").status_code == 200
        h = client2.get(f"/households/{hid}").json()
        assert [(m["username"], m["role"]) for m in h["members"]] == [("bob", "owner")]

    def test_last_member_leaving_deletes(self, client, db, people):
        from app.models.household import Household

        hid = _create(client)
        client.delete(f"/households/{hid}/members/{ALICE}")
        assert db.get(Household, hid) is None

    def test_members_cant_remove_others(self, client, client2, people):
        hid = _create(client)
        _join(client, client2, hid)
        assert client2.delete(f"/households/{hid}/members/{ALICE}").status_code == 403
        assert client.delete(f"/households/{hid}/members/{BOB}").status_code == 200


class TestSharedList:
    def test_add_list_remove(self, client, client2, db, people, seed_movie):
        from app.models.watchlist import Watchlist

        hid = _create(client)
        _join(client, client2, hid)
        db.add(Watchlist(user_id=BOB, content_type="movie", content_id=550))
        db.commit()
        assert client.post(f"/households/{hid}/items", json={"content_type": "movie", "content_id": 550}).status_code == 201
        # Adding twice is harmless.
        client2.post(f"/households/{hid}/items", json={"content_type": "movie", "content_id": 550})

        items = client2.get(f"/households/{hid}").json()["items"]
        assert len(items) == 1
        assert items[0]["title"] == "Fight Club"
        assert items[0]["added_by"]["username"] == "alice"
        assert items[0]["member_status"] == {BOB: "Want To Watch"}
        assert client.get("/households/containing", params={"content_type": "movie", "content_id": 550}).json() == {
            "household_ids": [hid]
        }

        assert client2.delete(f"/households/{hid}/items/movie/550").status_code == 200
        assert client.get(f"/households/{hid}").json()["items"] == []

    def test_services_between_you(self, client, client2, db, people):
        from app.models.provider import Provider
        from app.models.user_streaming_service import UserStreamingService

        hid = _create(client)
        _join(client, client2, hid)
        db.add_all([Provider(id=8, name="Netflix"), Provider(id=15, name="Hulu"), Provider(id=1796, name="Netflix ads")])
        db.flush()
        db.add_all([
            UserStreamingService(user_id=ALICE, provider_id=8),
            UserStreamingService(user_id=BOB, provider_id=1796),
            UserStreamingService(user_id=BOB, provider_id=15),
        ])
        db.commit()
        services = client.get(f"/households/{hid}").json()["services"]
        assert [(s["name"], s["user_ids"]) for s in services] == [
            ("Hulu", [BOB]),
            ("Netflix", [ALICE, BOB]),
        ]


@pytest.fixture
def five_episode_show(db):
    from app.models.episode import Episode
    from app.models.season import Season
    from app.models.show import Show

    db.add(Show(id=500, name="Shared Show", in_production=True))
    db.flush()
    db.add(Season(id=5001, show_id=500, season_number=1, episode_count=6))
    for n in range(1, 6):
        db.add(Episode(id=50100 + n, show_id=500, season_number=1, episode_number=n,
                       name=f"Ep {n}", air_date=date(2024, 1, n)))
    db.add(Episode(id=50106, show_id=500, season_number=1, episode_number=6,
                   name="Future", air_date=date.today() + timedelta(days=30)))
    db.commit()


def _watch(db, uid, *episodes):
    from app.models.episode_watched import EpisodeWatched
    for n in episodes:
        db.add(EpisodeWatched(user_id=uid, show_id=500, episode_id=50100 + n, season_number=1, episode_number=n))
    db.commit()


class TestProgress:
    def test_side_by_side(self, client, client2, db, people, five_episode_show):
        hid = _create(client)
        _join(client, client2, hid)
        _watch(db, ALICE, 1, 2)
        _watch(db, BOB, 1, 2, 3, 4)

        shows = client.get(f"/households/{hid}/progress").json()["shows"]
        assert len(shows) == 1
        show = shows[0]
        assert show["title"] == "Shared Show"
        assert show["total_aired"] == 5  # the future episode doesn't count
        assert show["together_next"]["episode_number"] == 3
        by_user = {m["user_id"]: m for m in show["members"]}
        assert by_user[ALICE]["next"]["episode_number"] == 3
        assert by_user[BOB]["next"]["episode_number"] == 5
        assert (by_user[ALICE]["ahead_by"], by_user[BOB]["ahead_by"]) == (0, 2)

    def test_one_person_only_isnt_shared(self, client, client2, db, people, five_episode_show):
        hid = _create(client)
        _join(client, client2, hid)
        _watch(db, ALICE, 1)
        assert client.get(f"/households/{hid}/progress").json()["shows"] == []
        # ...unless it's on the shared list.
        client.post(f"/households/{hid}/items", json={"content_type": "tv", "content_id": 500})
        assert len(client.get(f"/households/{hid}/progress").json()["shows"]) == 1

    def test_everyone_caught_up_drops_off(self, client, client2, db, people, five_episode_show):
        hid = _create(client)
        _join(client, client2, hid)
        _watch(db, ALICE, 1, 2, 3, 4, 5)
        _watch(db, BOB, 1, 2, 3, 4, 5)
        assert client.get(f"/households/{hid}/progress").json()["shows"] == []


class TestLogTogether:
    def test_episode_for_both(self, client, client2, db, people, five_episode_show):
        from app.models.activity import Activity
        from app.models.episode_watched import EpisodeWatched

        hid = _create(client)
        _join(client, client2, hid)
        r = client.post(f"/households/{hid}/log", json={
            "user_ids": [ALICE, BOB], "content_type": "tv", "content_id": 500,
            "season_number": 1, "episode_number": 2,
        })
        assert r.status_code == 200
        assert r.json() == {"logged": [ALICE, BOB]}
        db.expire_all()
        assert {w.user_id for w in db.query(EpisodeWatched).filter_by(show_id=500, episode_number=2)} == {ALICE, BOB}
        logged_by = {a.user_id: a.logged_by for a in db.query(Activity).filter_by(content_id=500)}
        assert logged_by == {ALICE: None, BOB: ALICE}

        from app.services.activity_service import get_my_activity
        entry = next(a for a in get_my_activity(db, BOB) if a["content_id"] == 500)
        assert entry["logged_by_username"] == "alice"

    def test_only_household_members(self, client, client2, people, five_episode_show):
        hid = _create(client)
        _join(client, client2, hid)
        r = client.post(f"/households/{hid}/log", json={
            "user_ids": [ALICE, CAROL], "content_type": "tv", "content_id": 500,
            "season_number": 1, "episode_number": 2,
        })
        assert r.status_code == 403

    def test_unaired_episode(self, client, client2, people, five_episode_show):
        hid = _create(client)
        r = client.post(f"/households/{hid}/log", json={
            "user_ids": [ALICE], "content_type": "tv", "content_id": 500,
            "season_number": 1, "episode_number": 6,
        })
        assert r.status_code == 400

    def test_movie_moves_off_their_watchlist(self, client, client2, db, people, seed_movie):
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        hid = _create(client)
        _join(client, client2, hid)
        db.add(Watchlist(user_id=BOB, content_type="movie", content_id=550))
        db.commit()
        r = client.post(f"/households/{hid}/log", json={
            "user_ids": [ALICE, BOB], "content_type": "movie", "content_id": 550,
        })
        assert r.status_code == 200
        db.expire_all()
        assert {w.user_id for w in db.query(Watched).filter_by(content_id=550)} == {ALICE, BOB}
        assert db.query(Watchlist).filter_by(user_id=BOB, content_id=550).first() is None

    def test_whole_season(self, client, client2, db, people, five_episode_show):
        from unittest.mock import patch
        from app.models.episode_watched import EpisodeWatched

        hid = _create(client)
        _join(client, client2, hid)
        with patch("app.services.watched_episode_service.sync_season_episodes"):
            r = client.post(f"/households/{hid}/log", json={
                "user_ids": [BOB], "content_type": "tv", "content_id": 500, "season_number": 1,
            })
        assert r.status_code == 200
        db.expire_all()
        assert db.query(EpisodeWatched).filter_by(user_id=BOB, show_id=500).count() >= 5


class TestAccountDeletion:
    def test_deleting_the_owner_hands_over(self, client, client2, db, people):
        from app.models.household import HouseholdMember
        from app.services.account_service import delete_user_data

        hid = _create(client)
        _join(client, client2, hid)
        delete_user_data(db, ALICE)
        db.commit()
        db.expire_all()
        rows = db.query(HouseholdMember).filter_by(household_id=hid).all()
        assert [(r.user_id, r.role) for r in rows] == [(BOB, "owner")]


def test_nav_counts_include_household_invites(db, people):
    from unittest.mock import patch
    from app.services import nav_counts
    from app.services.household_service import create, invite

    h = create(db, ALICE, "Us")
    invite(db, ALICE, h["id"], "bob")
    with patch.object(nav_counts, "publish") as publish:
        nav_counts.notify_counts_changed(db, BOB)
    assert publish.call_args.args[1]["household_invites"] == 1


class TestReviewFixes:
    def test_repeat_invite_when_full_is_fine(self, client, db, people):
        from app.models.household import HouseholdMember
        from app.models.user import User

        hid = _create(client)
        for i in range(4):
            db.add(User(id=f"m{i}", username=f"m{i}", email=f"m{i}@t.com"))
            db.flush()
            db.add(HouseholdMember(household_id=hid, user_id=f"m{i}"))
        db.commit()
        first = client.post(f"/households/{hid}/invites", json={"username": "bob"})
        again = client.post(f"/households/{hid}/invites", json={"username": "bob"})
        assert (first.status_code, again.status_code) == (201, 201)
        assert first.json()["id"] == again.json()["id"]

    def test_deleting_clears_invitees_badge(self, client, people):
        from unittest.mock import patch
        from app.routers import households as router

        hid = _create(client)
        client.post(f"/households/{hid}/invites", json={"username": "bob"})
        with patch.object(router, "notify_counts_changed") as notify:
            client.delete(f"/households/{hid}")
        assert [c.args[1] for c in notify.call_args_list] == [BOB]

    def test_unknown_episode_is_refused(self, client, people, five_episode_show):
        from unittest.mock import patch

        hid = _create(client)
        with patch("app.services.episode_service.sync_season_episodes"):
            r = client.post(f"/households/{hid}/log", json={
                "user_ids": [ALICE], "content_type": "tv", "content_id": 500,
                "season_number": 1, "episode_number": 9,
            })
        assert r.status_code == 404

    def test_double_add_is_one_row(self, client, db, people, seed_movie):
        from app.models.household import HouseholdItem

        hid = _create(client)
        for _ in range(2):
            assert client.post(f"/households/{hid}/items", json={"content_type": "movie", "content_id": 550}).status_code == 201
        assert db.query(HouseholdItem).filter_by(household_id=hid).count() == 1


class TestLoggedByPrivacy:
    """carol is friends with bob but not alice. When alice logs for bob,
    carol sees bob's watch but not who logged it."""

    def _log_for_bob(self, client, client2, db, five_episode_show):
        from app.models.friendship import Friendship

        db.add(Friendship(requester_id=BOB, addressee_id=CAROL, status="accepted"))
        db.commit()
        hid = _create(client)
        _join(client, client2, hid)
        client.post(f"/households/{hid}/log", json={
            "user_ids": [BOB], "content_type": "tv", "content_id": 500,
            "season_number": 1, "episode_number": 1,
        })

    def test_viewer_who_doesnt_know_the_logger(self, client, client2, db, people, five_episode_show):
        from app.services.activity_service import get_activity_feed

        self._log_for_bob(client, client2, db, five_episode_show)
        entry = next(a for a in get_activity_feed(db, CAROL) if a["user_id"] == BOB)
        assert entry["logged_by_username"] is None

    def test_the_person_and_the_loggers_friends_see_it(self, client, client2, db, people, five_episode_show):
        from app.services.activity_service import get_activity_feed, get_my_activity

        self._log_for_bob(client, client2, db, five_episode_show)
        assert next(a for a in get_my_activity(db, BOB) if a["content_id"] == 500)["logged_by_username"] == "alice"
        # alice is bob's friend, and the logger.
        entry = next(a for a in get_activity_feed(db, ALICE) if a["user_id"] == BOB)
        assert entry["logged_by_username"] == "alice"


class TestInvitable:
    def test_friends_not_in_the_household(self, client, client2, db, people):
        from app.models.friendship import Friendship

        db.add(Friendship(requester_id=CAROL, addressee_id=ALICE, status="accepted"))
        db.commit()
        hid = _create(client)
        client.post(f"/households/{hid}/invites", json={"username": "carol"})
        out = client.get(f"/households/{hid}/invitable").json()
        assert [(p["username"], p["invited"]) for p in out] == [("bob", False), ("carol", True)]

        _join(client, client2, hid)
        assert [p["username"] for p in client.get(f"/households/{hid}/invitable").json()] == ["carol"]

    def test_outsiders_get_404(self, client, client2, people):
        hid = _create(client)
        assert client2.get(f"/households/{hid}/invitable").status_code == 404


class TestRecommendations:
    @pytest.fixture
    def recs_world(self, client, client2, db, people):
        """alice and bob both watched Show 10; only alice watched Movie 20.
        Show 10's list recommends Show 11 (and Show 10's own sibling 12);
        Movie 20's list recommends Movie 21. Bob has Show 12 on his watchlist."""
        from app.models.movie import Movie
        from app.models.show import Show
        from app.models.title_recs import RecCandidate, TitleRecs
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        hid = _create(client)
        _join(client, client2, hid)
        db.add_all([Show(id=10, name="Both Watched"), Movie(id=20, title="Alice Only")])
        db.add_all([
            Watched(user_id=ALICE, content_type="tv", content_id=10),
            Watched(user_id=BOB, content_type="tv", content_id=10),
            Watched(user_id=ALICE, content_type="movie", content_id=20),
            Watchlist(user_id=BOB, content_type="tv", content_id=12),
            TitleRecs(content_type="tv", content_id=10, origin="tmdb", recs=[["tv", 11], ["tv", 12]]),
            TitleRecs(content_type="movie", content_id=20, origin="tmdb", recs=[["movie", 21]]),
            RecCandidate(content_type="tv", content_id=11, title="Pick Show", popularity=5.0),
            RecCandidate(content_type="tv", content_id=12, title="On Bob's list", popularity=5.0),
            RecCandidate(content_type="movie", content_id=21, title="Pick Movie", popularity=5.0),
        ])
        db.commit()
        return hid

    def test_picks_from_what_you_share(self, client, recs_world):
        out = client.get(f"/households/{recs_world}/recommendations").json()
        assert [s["name"] for s in out["shows"]] == ["Pick Show"]  # Show 12 is on bob's list
        assert out["shows"][0]["because"] == [
            {"id": 10, "content_type": "tv", "title": "Both Watched", "reason": "watched"}
        ]
        # alice's solo movie still yields a pick, with no shared reason named.
        assert [m["title"] for m in out["movies"]] == ["Pick Movie"]
        assert out["movies"][0]["because"] == []
        assert out["shared_count"] == 1

    def test_shared_list_counts(self, client, db, recs_world):
        from app.models.movie import Movie
        from app.models.title_recs import RecCandidate, TitleRecs

        db.add_all([
            Movie(id=30, title="On the shared list"),
            TitleRecs(content_type="movie", content_id=30, origin="tmdb", recs=[["movie", 31]]),
            RecCandidate(content_type="movie", content_id=31, title="From the list", popularity=1.0),
        ])
        db.commit()
        client.post(f"/households/{recs_world}/items", json={"content_type": "movie", "content_id": 30})
        movies = client.get(f"/households/{recs_world}/recommendations").json()["movies"]
        pick = next(m for m in movies if m["title"] == "From the list")
        assert pick["because"][0]["reason"] == "lists"

    def test_outsiders_get_404(self, client, people):
        from tests.conftest import make_client

        hid = _create(client)
        assert make_client("test-uid-3").get(f"/households/{hid}/recommendations").status_code == 404


class TestPicks:
    @pytest.fixture
    def tonight(self, client, client2, db, people, five_episode_show):
        """alice is on episode 2 of Shared Show, bob on 4 (runtime 30 min).
        Both have Movie 40 (PG, 100 min, on Netflix, which alice pays for) on
        their watchlists. Movie 41 (R) is on the shared list. Both watched
        Movie 42, which is also on the shared list."""
        from app.models.episode import Episode
        from app.models.household import HouseholdItem
        from app.models.movie import Movie
        from app.models.provider import MovieProvider, Provider
        from app.models.user_streaming_service import UserStreamingService
        from app.models.watched import Watched
        from app.models.watchlist import Watchlist

        hid = _create(client)
        _join(client, client2, hid)
        _watch(db, ALICE, 1, 2)
        _watch(db, BOB, 1, 2, 3, 4)
        db.query(Episode).filter_by(show_id=500).update({"runtime": 30})
        db.add_all([
            Movie(id=40, title="Family Movie", certification="PG", runtime=100),
            Movie(id=41, title="Grown-up Movie", certification="R", runtime=120),
            Movie(id=42, title="Seen It", certification="PG", runtime=90),
            Provider(id=8, name="Netflix"),
        ])
        db.flush()
        db.add_all([
            MovieProvider(movie_id=40, provider_id=8, flatrate=True),
            UserStreamingService(user_id=ALICE, provider_id=8),
            Watchlist(user_id=ALICE, content_type="movie", content_id=40),
            Watchlist(user_id=BOB, content_type="movie", content_id=40),
            Watched(user_id=ALICE, content_type="movie", content_id=42),
            Watched(user_id=BOB, content_type="movie", content_id=42),
            HouseholdItem(household_id=hid, content_type="movie", content_id=41, added_by=BOB),
            HouseholdItem(household_id=hid, content_type="movie", content_id=42, added_by=ALICE),
        ])
        db.commit()
        return hid

    def _picks(self, client, hid, **params):
        r = client.get(f"/households/{hid}/picks", params=params)
        assert r.status_code == 200, r.text
        return r.json()["picks"]

    def test_ranked_with_reasons(self, client, tonight):
        picks = self._picks(client, tonight)
        assert [p["title"] for p in picks] == ["Shared Show", "Grown-up Movie", "Family Movie"]
        show = picks[0]
        assert show["episode"]["episode_number"] == 3  # where alice is
        assert show["reasons"][0]["type"] == "next_episode"
        assert set(show["reasons"][0]["user_ids"]) == {ALICE, BOB}
        assert picks[1]["reasons"] == [{"type": "shared_list", "user_id": BOB}]
        assert picks[2]["reasons"][0]["type"] == "want"
        assert picks[2]["services"] == [{"id": 8, "name": "Netflix"}]

    def test_seen_by_everyone_is_left_out(self, client, tonight):
        assert "Seen It" not in [p["title"] for p in self._picks(client, tonight)]

    def test_time_filters(self, client, tonight):
        assert [p["title"] for p in self._picks(client, tonight, time="movie")] == ["Grown-up Movie", "Family Movie"]
        assert [p["title"] for p in self._picks(client, tonight, time="short")] == ["Shared Show"]

    def test_kid_friendly(self, client, tonight):
        # The show has no rating stored, so it can't be promised as kid-friendly.
        assert [p["title"] for p in self._picks(client, tonight, kids="true")] == ["Family Movie"]

    def test_on_our_services(self, client, tonight):
        assert [p["title"] for p in self._picks(client, tonight, services="true")] == ["Family Movie"]

    def test_just_one_person_watching(self, client, tonight):
        picks = self._picks(client, tonight, present=ALICE)
        titles = [p["title"] for p in picks]
        # One person can't share a want; the shared list still counts.
        assert "Family Movie" not in titles
        assert "Grown-up Movie" in titles

    def test_present_must_be_members(self, client, tonight):
        r = client.get(f"/households/{tonight}/picks", params={"present": CAROL})
        assert r.status_code == 422

    def test_outsiders_get_404(self, client, tonight):
        from tests.conftest import make_client
        assert make_client(CAROL).get(f"/households/{tonight}/picks").status_code == 404


class TestPicksReviewFixes:
    def _hid(self, client, client2):
        hid = _create(client)
        _join(client, client2, hid)
        return hid

    def test_no_s1e1_when_someone_has_started(self, client, client2, db, people, five_episode_show):
        from app.models.watchlist import Watchlist

        hid = self._hid(client, client2)
        _watch(db, BOB, 1, 2, 3)  # only bob has started; it's not shared
        db.add_all([
            Watchlist(user_id=ALICE, content_type="tv", content_id=500),
            Watchlist(user_id=BOB, content_type="tv", content_id=500),
        ])
        db.commit()
        pick = next(p for p in client.get(f"/households/{hid}/picks").json()["picks"] if p["id"] == 500)
        assert pick["episode"] is None

    def test_s1e1_for_an_unstarted_show(self, client, client2, db, people, five_episode_show):
        hid = self._hid(client, client2)
        client.post(f"/households/{hid}/items", json={"content_type": "tv", "content_id": 500})
        pick = next(p for p in client.get(f"/households/{hid}/picks").json()["picks"] if p["id"] == 500)
        assert (pick["episode"]["season_number"], pick["episode"]["episode_number"]) == (1, 1)

    def test_no_s1e1_before_it_airs(self, client, client2, db, people, five_episode_show):
        from app.models.episode import Episode

        hid = self._hid(client, client2)
        db.query(Episode).filter_by(show_id=500, episode_number=1).update(
            {"air_date": date.today() + timedelta(days=10)}
        )
        db.commit()
        client.post(f"/households/{hid}/items", json={"content_type": "tv", "content_id": 500})
        pick = next(p for p in client.get(f"/households/{hid}/picks").json()["picks"] if p["id"] == 500)
        assert pick["episode"] is None

    def test_present_is_deduplicated(self, client, client2, people):
        hid = self._hid(client, client2)
        r = client.get(f"/households/{hid}/picks", params={"present": f"{ALICE},{ALICE}"})
        assert r.json()["present"] == [ALICE]


class TestPicksNeverWaitOnTmdb:
    def test_missing_lists_are_fetched_after_the_response(self, client, client2, db, people):
        from unittest.mock import patch
        from app.models.show import Show
        from app.models.watched import Watched
        from app.services import household_picks, household_recs

        hid = _create(client)
        _join(client, client2, hid)
        # Both watched a show that has no stored recommendation list.
        db.add(Show(id=600, name="No list yet"))
        db.add_all([
            Watched(user_id=ALICE, content_type="tv", content_id=600),
            Watched(user_id=BOB, content_type="tv", content_id=600),
        ])
        db.commit()

        with patch.object(household_recs, "fetch_and_store") as fetch:
            household_picks.household_picks(db, ALICE, hid)
            fetch.assert_not_called()  # the request itself never waits on TMDb
            r = client.get(f"/households/{hid}/picks")
        assert r.status_code == 200
        assert "missing" not in r.json()
        # ...but the route queued it for after the response.
        assert fetch.call_count == 1
        assert ("tv", 600) in fetch.call_args.args[1]


class TestSwipeSessions:
    @pytest.fixture
    def swipe_world(self, client, client2, db, people):
        """alice and bob both want movies 70 and 71 (on their watchlists)."""
        from app.models.movie import Movie
        from app.models.watchlist import Watchlist

        hid = _create(client)
        _join(client, client2, hid)
        db.add_all([Movie(id=70, title="Seventy", runtime=100), Movie(id=71, title="Seventy-one", runtime=100)])
        db.flush()
        for uid in (ALICE, BOB):
            for mid in (70, 71):
                db.add(Watchlist(user_id=uid, content_type="movie", content_id=mid))
        db.commit()
        return hid

    def _start(self, client, hid, present=(ALICE, BOB), **filters):
        return client.post(f"/households/{hid}/sessions", json={"present": list(present), **filters})

    def _vote(self, c, hid, sid, mid, yes=True):
        return c.post(f"/households/{hid}/sessions/{sid}/votes",
                      json={"content_type": "movie", "content_id": mid, "vote": yes})

    def test_nothing_revealed_until_everyone_is_done(self, client, client2, swipe_world):
        from unittest.mock import patch
        from app.services import household_sessions

        r = self._start(client, swipe_world)
        assert r.status_code == 201, r.text
        s = r.json()
        assert {c["id"] for c in s["candidates"]} == {70, 71}
        assert set(s["participants"]) == {ALICE, BOB}

        with patch.object(household_sessions, "publish") as publish:
            self._vote(client, swipe_world, s["id"], 70)
            self._vote(client, swipe_world, s["id"], 71)
            mid = self._vote(client2, swipe_world, s["id"], 70).json()
            # bob has one card left: no tallies, no matches, no announcement.
            assert (mid["finished"], mid["results"], mid["matches"]) == (False, None, [])
            assert {c.args[1]["event"] for c in publish.call_args_list} == {"vote"}
            done = self._vote(client2, swipe_world, s["id"], 71, yes=False).json()

        assert done["finished"] is True
        assert [(c["id"], c["yes"], c["of"]) for c in done["results"]] == [(70, 2, 2), (71, 1, 2)]
        assert [m["id"] for m in done["matches"]] == [70]
        finished = [c for c in publish.call_args_list if c.args[1]["event"] == "finished"]
        assert {c.args[0] for c in finished} == {ALICE, BOB}  # once, to each member

    def test_results_after_a_change_of_mind(self, client, client2, swipe_world):
        sid = self._start(client, swipe_world).json()["id"]
        for c in (client, client2):
            self._vote(c, swipe_world, sid, 70)
            self._vote(c, swipe_world, sid, 71, yes=False)
        assert [m["id"] for m in client.get(f"/households/{swipe_world}/sessions/current").json()["matches"]] == [70]
        out = self._vote(client2, swipe_world, sid, 70, yes=False).json()
        assert out["matches"] == []
        assert [(c["id"], c["yes"]) for c in out["results"]] == [(70, 1)]

    def test_round_size(self, client, swipe_world):
        assert self._start(client, swipe_world, size=2).status_code == 422
        assert self._start(client, swipe_world, size=16).status_code == 422
        assert self._start(client, swipe_world, size=5).status_code == 201

    def test_everyone_sees_the_session_and_their_own_votes(self, client, client2, swipe_world):
        sid = self._start(client, swipe_world).json()["id"]
        self._vote(client, swipe_world, sid, 70)
        mine = client.get(f"/households/{swipe_world}/sessions/current").json()
        theirs = client2.get(f"/households/{swipe_world}/sessions/current").json()
        assert mine["my_votes"] == {"movie:70": True}
        assert theirs["my_votes"] == {}
        assert theirs["progress"] == {ALICE: 1, BOB: 0}

    def test_pick_closes_it(self, client, client2, swipe_world):
        sid = self._start(client, swipe_world).json()["id"]
        r = client2.post(f"/households/{swipe_world}/sessions/{sid}/pick", json={"content_type": "movie", "content_id": 70})
        assert r.json()["status"] == "picked"
        # Everyone sees what was picked, but nobody can keep voting.
        shown = client.get(f"/households/{swipe_world}/sessions/current").json()
        assert (shown["status"], shown["picked"]) == ("picked", {"content_type": "movie", "id": 70})
        assert self._vote(client, swipe_world, sid, 71).status_code == 409
        # A new round replaces it.
        new = self._start(client, swipe_world).json()
        assert client.get(f"/households/{swipe_world}/sessions/current").json()["id"] == new["id"]

    def test_starting_again_ends_the_old_one(self, client, swipe_world):
        first = self._start(client, swipe_world).json()["id"]
        second = self._start(client, swipe_world).json()["id"]
        assert first != second
        assert client.get(f"/households/{swipe_world}/sessions/current").json()["id"] == second
        assert self._vote(client, swipe_world, first, 70).status_code == 409

    def test_expired_sessions_are_gone(self, client, db, swipe_world):
        from datetime import datetime, timezone
        from app.models.household import HouseholdSession

        sid = self._start(client, swipe_world).json()["id"]
        db.query(HouseholdSession).filter_by(id=sid).update({"expires_at": datetime(2020, 1, 1, tzinfo=timezone.utc)})
        db.commit()
        assert client.get(f"/households/{swipe_world}/sessions/current").json() is None

    def test_rules(self, client, client2, db, swipe_world):
        from app.models.household import HouseholdMember
        from app.models.user import User

        # You must be in it, and it takes two.
        assert self._start(client, swipe_world, present=(BOB,)).status_code == 422
        assert self._start(client, swipe_world, present=(ALICE,)).status_code == 422
        # Filters that leave nothing.
        assert self._start(client, swipe_world, time="short").status_code == 422
        # A member who isn't swiping can't vote.
        db.add(User(id="dee", username="dee", email="dee@t.com"))
        db.flush()
        db.add(HouseholdMember(household_id=swipe_world, user_id="dee"))
        db.commit()
        sid = self._start(client, swipe_world).json()["id"]
        from tests.conftest import make_client
        assert self._vote(make_client("dee"), swipe_world, sid, 70).status_code == 403
        # Outsiders see nothing.
        assert make_client(CAROL).get(f"/households/{swipe_world}/sessions/current").status_code == 404

    def test_only_titles_in_the_session(self, client, swipe_world):
        sid = self._start(client, swipe_world).json()["id"]
        assert self._vote(client, swipe_world, sid, 999).status_code == 404

    def test_deleting_the_household_removes_sessions(self, client, client2, db, swipe_world):
        from app.models.household import HouseholdSession, HouseholdSessionVote

        sid = self._start(client, swipe_world).json()["id"]
        self._vote(client, swipe_world, sid, 70)
        client.delete(f"/households/{swipe_world}")
        db.expire_all()
        assert db.query(HouseholdSession).count() == 0
        assert db.query(HouseholdSessionVote).count() == 0

    def test_someone_leaving_doesnt_hold_up_the_round(self, client, client2, db, swipe_world):
        from app.models.household import HouseholdMember
        from app.models.user import User

        # A third person joins, everyone starts swiping, then they leave.
        db.add(User(id="dee", username="dee", email="dee@t.com"))
        db.flush()
        db.add(HouseholdMember(household_id=swipe_world, user_id="dee"))
        db.commit()
        sid = self._start(client, swipe_world, present=(ALICE, BOB, "dee")).json()["id"]
        db.query(HouseholdMember).filter_by(household_id=swipe_world, user_id="dee").delete()
        db.commit()
        for c in (client, client2):
            self._vote(c, swipe_world, sid, 70)
            out = self._vote(c, swipe_world, sid, 71, yes=False).json()
        assert out["finished"] is True
        assert [m["id"] for m in out["matches"]] == [70]
        assert set(out["participants"]) == {ALICE, BOB}

    def test_finished_is_announced_once(self, client, client2, swipe_world):
        from unittest.mock import patch
        from app.services import household_sessions

        sid = self._start(client, swipe_world).json()["id"]
        for c in (client, client2):
            self._vote(c, swipe_world, sid, 70)
            self._vote(c, swipe_world, sid, 71)
        with patch.object(household_sessions, "publish") as publish:
            self._vote(client2, swipe_world, sid, 71, yes=False)
        assert {c.args[1]["event"] for c in publish.call_args_list} == {"vote"}
