"""My services: the per-service overview, pausing, popular titles, and the
resume reminders for paused services."""

from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest

TODAY = date(2026, 11, 12)
NOW = datetime(2026, 11, 12, 15, 0, tzinfo=timezone.utc)

NETFLIX, NETFLIX_ADS, HULU, MAX = 8, 1796, 15, 1899


@pytest.fixture
def planner_world(db):
    """alice (test-uid-1) pays for Netflix (saved as its ads variant), Hulu
    and Max.
    - Netflix: Stranger Things S5 premieres in 20 days (Watchlist).
    - Hulu: The Bear finished; S4 premieres in 200 days (Watched, in
      production). Nothing logged on Hulu.
    - Max: nothing coming, but she watched an episode of Succession 5 days ago.
    - Netflix also has Dune (movie, out, on her Watchlist): ready now.
    """
    from app.models.episode import Episode
    from app.models.episode_watched import EpisodeWatched
    from app.models.movie import Movie
    from app.models.provider import MovieProvider, Provider, ShowProvider
    from app.models.season import Season
    from app.models.show import Show
    from app.models.user import User
    from app.models.user_streaming_service import UserStreamingService
    from app.models.watched import Watched
    from app.models.watchlist import Watchlist

    db.add(User(id="test-uid-1", username="alice", email="alice@test.com"))
    for pid, name in ((NETFLIX, "Netflix"), (NETFLIX_ADS, "Netflix Standard with Ads"),
                      (HULU, "Hulu"), (MAX, "Max")):
        db.add(Provider(id=pid, name=name, logo_path=f"/{pid}.png"))
    db.flush()
    for pid in (NETFLIX_ADS, HULU, MAX):
        db.add(UserStreamingService(user_id="test-uid-1", provider_id=pid))

    db.add_all([
        Show(id=66732, name="Stranger Things", in_production=True, first_air_date=date(2016, 7, 15)),
        Show(id=136315, name="The Bear", in_production=True, first_air_date=date(2022, 6, 23)),
        Show(id=76331, name="Succession", in_production=False, first_air_date=date(2018, 6, 3)),
        Movie(id=438631, title="Dune", release_date=date(2021, 10, 22)),
    ])
    db.flush()
    db.add_all([
        ShowProvider(show_id=66732, provider_id=NETFLIX, flatrate=True),
        ShowProvider(show_id=136315, provider_id=HULU, flatrate=True),
        ShowProvider(show_id=76331, provider_id=MAX, flatrate=True),
        MovieProvider(movie_id=438631, provider_id=NETFLIX, flatrate=True),
        Season(id=900005, show_id=66732, season_number=5, episode_count=8,
               air_date=TODAY + timedelta(days=20)),
        Season(id=900004, show_id=136315, season_number=4, episode_count=10,
               air_date=TODAY + timedelta(days=200)),
        Episode(id=900101, show_id=76331, season_number=4, episode_number=10,
                name="With Open Eyes", air_date=date(2023, 5, 28)),
    ])
    db.add_all([
        Watchlist(user_id="test-uid-1", content_type="tv", content_id=66732, notify=True),
        Watchlist(user_id="test-uid-1", content_type="movie", content_id=438631, notify=True),
        Watched(user_id="test-uid-1", content_type="tv", content_id=136315),
        EpisodeWatched(user_id="test-uid-1", show_id=76331, episode_id=900101,
                       season_number=4, episode_number=10,
                       watched_at=NOW - timedelta(days=5)),
    ])
    db.commit()


def _by_name(overview):
    return {s["name"]: s for s in overview["services"]}


class TestOverview:
    def test_verdicts(self, db, planner_world):
        from app.services.service_planner import build_service_overview

        services = _by_name(build_service_overview(db, "test-uid-1", TODAY, NOW))
        assert services["Netflix"]["verdict"] == "keep"      # something coming
        assert services["Max"]["verdict"] == "keep"          # used 5 days ago
        assert services["Hulu"]["verdict"] == "pause"        # neither

    def test_variant_counts_as_the_service(self, db, planner_world):
        """Saved as Netflix-with-ads; the show streams on plain Netflix."""
        from app.services.service_planner import build_service_overview

        netflix = _by_name(build_service_overview(db, "test-uid-1", TODAY, NOW))["Netflix"]
        assert netflix["id"] == NETFLIX
        assert [(u["title"], u["kind"], u["season_number"]) for u in netflix["upcoming"]] == [
            ("Stranger Things", "season_premiere", 5)
        ]
        assert netflix["upcoming_count"] == 1

    def test_ready_now_is_the_released_queue(self, db, planner_world):
        from app.services.service_planner import build_service_overview

        services = _by_name(build_service_overview(db, "test-uid-1", TODAY, NOW))
        # Dune is out; Stranger Things is out too (S1 2016) and on the Watchlist.
        assert services["Netflix"]["ready_now"]["count"] == 2
        # The Bear is Watched, not queued.
        assert services["Hulu"]["ready_now"]["count"] == 0

    def test_next_release_beyond_the_window(self, db, planner_world):
        from app.services.service_planner import build_service_overview

        hulu = _by_name(build_service_overview(db, "test-uid-1", TODAY, NOW))["Hulu"]
        assert hulu["upcoming"] == []
        assert hulu["next_release"]["title"] == "The Bear"
        assert hulu["next_release"]["date"] == (TODAY + timedelta(days=200)).isoformat()

    def test_last_used(self, db, planner_world):
        from app.services.service_planner import build_service_overview

        services = _by_name(build_service_overview(db, "test-uid-1", TODAY, NOW))
        assert services["Max"]["last_used"]["title"] == "Succession"
        assert services["Hulu"]["last_used"] is None

    def test_old_use_doesnt_count(self, db, planner_world):
        from app.services.service_planner import build_service_overview

        later = NOW + timedelta(days=40)
        services = _by_name(build_service_overview(db, "test-uid-1", TODAY + timedelta(days=40), later))
        assert services["Max"]["verdict"] == "pause"

    def test_no_services(self, db):
        from app.models.user import User
        from app.services.service_planner import build_service_overview

        db.add(User(id="nobody", username="n", email="n@test.com"))
        db.commit()
        assert build_service_overview(db, "nobody", TODAY, NOW)["services"] == []


class TestPauseRoutes:
    def test_pause_then_resume(self, client, db, planner_world):
        from app.models.user_streaming_service import UserStreamingService

        r = client.post(f"/streaming/services/{NETFLIX}/pause")
        assert r.status_code == 200
        db.expire_all()
        row = db.query(UserStreamingService).filter_by(provider_id=NETFLIX_ADS).one()
        assert row.paused_at is not None

        overview = client.get("/streaming/overview").json()
        assert _by_name(overview)["Netflix"]["verdict"] == "paused"

        assert client.delete(f"/streaming/services/{NETFLIX}/pause").status_code == 200
        db.expire_all()
        assert db.query(UserStreamingService).filter_by(provider_id=NETFLIX_ADS).one().paused_at is None

    def test_pausing_twice_keeps_the_first_date(self, db, planner_world):
        from app.models.user_streaming_service import UserStreamingService
        from app.services.service_planner import set_service_paused

        set_service_paused(db, "test-uid-1", HULU, True)
        first = db.query(UserStreamingService).filter_by(provider_id=HULU).one().paused_at
        set_service_paused(db, "test-uid-1", HULU, True)
        assert db.query(UserStreamingService).filter_by(provider_id=HULU).one().paused_at == first

    def test_unknown_service_is_404(self, client, planner_world):
        assert client.post("/streaming/services/337/pause").status_code == 404


class TestPopular:
    def test_excludes_titles_on_lists_and_interleaves(self, db, planner_world):
        from app.services import service_planner

        fake = {
            "tv": ({"id": 66732, "name": "Stranger Things", "poster_path": "/st.jpg"},
                   {"id": 1, "name": "Show A", "poster_path": "/a.jpg", "first_air_date": "2024-01-01"}),
            "movie": ({"id": 2, "title": "Movie B", "poster_path": "/b.jpg", "release_date": "2025-03-01"},
                      {"id": 3, "title": "No poster", "poster_path": None}),
        }
        with patch.object(service_planner, "_discover_popular", lambda media, ids: fake[media]):
            out = service_planner.popular_on_service(db, "test-uid-1", NETFLIX_ADS)
        assert [(x["content_type"], x["id"]) for x in out] == [("tv", 1), ("movie", 2)]
        assert out[0]["year"] == "2024"

    def test_only_for_the_users_own_services(self, client, planner_world):
        from app.services import service_planner

        with patch.object(service_planner, "_discover_popular") as discover:
            r = client.get("/streaming/services/337/popular")  # Disney+: not hers
        assert r.status_code == 404
        discover.assert_not_called()

    def test_route_hides_tmdb_failures(self, client, planner_world):
        from app.services import service_planner

        def boom(media, ids):
            raise RuntimeError("tmdb down")

        with patch.object(service_planner, "_discover_popular", boom):
            r = client.get(f"/streaming/services/{NETFLIX}/popular")
        assert r.status_code == 502
        assert "tmdb" not in r.text


class TestResumeReminders:
    def _pause(self, db, pid):
        from app.services.service_planner import set_service_paused
        set_service_paused(db, "test-uid-1", pid, True)

    def test_premiere_within_a_week_on_a_paused_service(self, db, planner_world):
        from app.services.service_planner import pending_resume_reminders

        self._pause(db, NETFLIX)
        # Stranger Things S5 is 20 days out: not yet.
        assert pending_resume_reminders(db, "test-uid-1", TODAY) == []
        due = pending_resume_reminders(db, "test-uid-1", TODAY + timedelta(days=14))
        assert [(a["title"], a["provider_name"], a["days_away"]) for a in due] == [
            ("Stranger Things", "Netflix", 6)
        ]

    def test_unpaused_service_gets_nothing(self, db, planner_world):
        from app.services.service_planner import pending_resume_reminders

        assert pending_resume_reminders(db, "test-uid-1", TODAY + timedelta(days=14)) == []

    def test_mid_season_episodes_dont_remind(self, db, planner_world):
        from app.models.episode import Episode
        from app.services.service_planner import pending_resume_reminders

        db.add(Episode(id=900201, show_id=136315, season_number=3, episode_number=5,
                       name="Weekly", air_date=TODAY + timedelta(days=3)))
        db.commit()
        self._pause(db, HULU)
        assert pending_resume_reminders(db, "test-uid-1", TODAY) == []

    def test_weekly_episode_doesnt_hide_a_later_premiere(self, db, planner_world):
        """The Bear has a mid-season episode in 2 days and S4 in 200; with S4
        moved to 5 days out, the reminder is about S4."""
        from app.models.episode import Episode
        from app.models.season import Season
        from app.services.service_planner import build_service_overview, pending_resume_reminders

        db.add(Episode(id=900202, show_id=136315, season_number=3, episode_number=9,
                       name="Weekly", air_date=TODAY + timedelta(days=2)))
        db.query(Season).filter_by(id=900004).update({"air_date": TODAY + timedelta(days=5)})
        db.commit()
        self._pause(db, HULU)
        due = pending_resume_reminders(db, "test-uid-1", TODAY)
        assert [(a["title"], a["kind"], a["season_number"]) for a in due] == [
            ("The Bear", "season_premiere", 4)
        ]
        hulu = _by_name(build_service_overview(db, "test-uid-1", TODAY, NOW))["Hulu"]
        assert hulu["next_release"]["kind"] == "episode"
        assert hulu["next_premiere"]["season_number"] == 4

    def test_muted_title_stays_muted_on_another_list(self, db, planner_world):
        """Muted on the Watchlist but also Currently Watching: still muted."""
        from app.models.currently_watching import CurrentlyWatching
        from app.models.watchlist import Watchlist
        from app.services.service_planner import pending_resume_reminders

        db.query(Watchlist).filter_by(content_id=66732).update({"notify": False})
        db.add(CurrentlyWatching(user_id="test-uid-1", content_type="tv", content_id=66732))
        db.commit()
        self._pause(db, NETFLIX)
        assert pending_resume_reminders(db, "test-uid-1", TODAY + timedelta(days=14)) == []

    def test_muted_watchlist_title_doesnt_remind(self, db, planner_world):
        from app.models.watchlist import Watchlist
        from app.services.service_planner import pending_resume_reminders

        db.query(Watchlist).filter_by(content_id=66732).update({"notify": False})
        db.commit()
        self._pause(db, NETFLIX)
        assert pending_resume_reminders(db, "test-uid-1", TODAY + timedelta(days=14)) == []


class TestResumeReminderJobs:
    def _setup(self, db):
        from app.models.user import User
        from app.models.season import Season
        from app.services.service_planner import set_service_paused

        user = db.get(User, "test-uid-1")
        user.email_notifications = True
        user.push_notifications_enabled = True
        user.digest_hour = 9
        user.digest_timezone = "America/New_York"
        # The fixed clock below is 2024-06-01; move the premiere 3 days past it.
        db.query(Season).filter_by(id=900005).update({"air_date": date(2024, 6, 4)})
        db.commit()
        set_service_paused(db, "test-uid-1", NETFLIX, True)

    def test_dispatch_queues_users_with_paused_services(self, db, planner_world):
        from app.jobs import notifications
        from tests.test_jobs import _NineAmInNewYork, _fake_enqueue_many

        self._setup(db)
        calls = []
        with patch.object(notifications, "enqueue_many", _fake_enqueue_many(calls)), \
             patch.object(notifications, "datetime", _NineAmInNewYork):
            notifications.dispatch_resume_reminders()
        assert calls == [(
            "send_resume_reminders",
            [{"user_id": "test-uid-1", "alert_date": "2024-06-01"}],
            ["resume:test-uid-1:2024-06-01"],
        )]

    def test_send_emails_records_pushes_once(self, db, planner_world):
        from app.jobs import notifications
        from app.models.sent_resume_reminder import SentResumeReminder

        self._setup(db)
        with patch.object(notifications, "send_resume_reminder_email") as email, \
             patch.object(notifications, "push_notification") as push:
            notifications.send_resume_reminders(user_id="test-uid-1", alert_date="2024-06-01")
            notifications.send_resume_reminders(user_id="test-uid-1", alert_date="2024-06-02")
        assert email.call_count == 1
        assert push.call_count == 1
        alerts = email.call_args.args[2]
        assert alerts[0]["title"] == "Stranger Things"
        db.expire_all()
        assert db.query(SentResumeReminder).count() == 1

    def test_streaming_alerts_off_means_no_reminders(self, db, planner_world):
        from app.jobs import notifications
        from app.models.user import User

        self._setup(db)
        db.get(User, "test-uid-1").notify_streaming_changes = False
        db.commit()
        with patch.object(notifications, "send_resume_reminder_email") as email:
            notifications.send_resume_reminders(user_id="test-uid-1", alert_date="2024-06-01")
        assert email.call_count == 0

    def test_scheduled_hourly(self):
        from app.jobs import SCHEDULES, Schedule
        from durable_queue.scheduler import hourly

        assert Schedule("resume-reminders", "dispatch_resume_reminders", {}, hourly(0)) in SCHEDULES


def test_reminder_email_renders(db):
    from app.services import email_service

    alert = {"provider_name": "Netflix", "title": "Stranger Things", "content_type": "tv", "id": 66732,
             "poster_path": None, "date": "2026-11-20", "kind": "season_premiere",
             "season_number": 5, "days_away": 6}
    with patch.object(email_service, "send_email") as send:
        email_service.send_resume_reminder_email("a@test.com", "alice", [alert], uid="u1")
    subject, html = send.call_args.args[1], send.call_args.args[2]
    assert subject.startswith("Time to resume Netflix?")
    assert "Season 5 premiere" in html
    assert email_service.resume_reminder_push_text(alert) == (
        "Time to resume Netflix?",
        "Stranger Things: season 5 premiere on Friday, November 20, 2026.",
    )
