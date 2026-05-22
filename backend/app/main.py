import asyncio
import logging
import time
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo
from fastapi import FastAPI, Header, HTTPException, Request
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.core.limiter import limiter
from app.core.logging import setup_logging, request_elapsed_ms
from app.config import settings
from app.routers import (
    tv,
    movies,
    person,
    user,
    watchlist,
    watched,
    watched_episode,
    search,
    friends,
    currently_watching,
    notifications,
    ical,
    favorites,
    recommendations,
    events,
    reviews,
    box_office,
    collections,
    calendar,
    shelf,
    admin,
    billing,
    dev,
    news,
    rewatch,
    import_router,
    moderation,
    export_router,
    streaming,
    watch_status,
    feedback,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from app.db.session import SessionLocal, engine
from app.db.base import Base
from app.services.activity_service import delete_old_activity, lift_expired_moderation
from app.services.recommendation_service import delete_old_recommendations
from app.routers.notifications import (
    send_daily_digest_to_all,
    send_season_premiere_alerts_to_all,
)
from app.services.vote_update_service import update_all_vote_averages
from app.services.episode_service import (
    refresh_episodes_for_active_shows,
    check_and_reactivate_watched_shows,
    prune_stale_cache,
)
from app.services.streaming_notification_service import refresh_streaming_providers
from app.services.trailer_notification_service import refresh_trailers
from app.services.stripe_reconciliation_service import reconcile_stripe_subscriptions

logger = logging.getLogger(__name__)


@contextmanager
def _db_session():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def _activity_cleanup_loop():
    """Delete activity and old recommendations, runs every hour."""
    while True:
        try:
            with _db_session() as db:
                deleted_activity = delete_old_activity(db)
                if deleted_activity:
                    logger.info("activity cleanup: removed %d old activity entries", deleted_activity)
                deleted_recs = delete_old_recommendations(db)
                if deleted_recs:
                    logger.info("activity cleanup: removed %d expired recommendations", deleted_recs)
                lift_expired_moderation(db)
        except Exception as e:
            logger.error("activity cleanup error: %s", e)
        await asyncio.sleep(3600)  # 1 hour


# async def _daily_digest_loop():
#     """Send daily email digest at 9am Eastern every day."""
#     eastern = ZoneInfo("America/New_York")
#     while True:
#         now = datetime.now(eastern)
#         next_run = now.replace(hour=9, minute=0, second=0, microsecond=0)
#         if now >= next_run:
#             next_run += timedelta(days=1)
#         wait_seconds = (next_run - now).total_seconds()
#         await asyncio.sleep(wait_seconds)
#         print("[daily digest] Firing now...")
#         try:
#             db = SessionLocal()
#             send_daily_digest_to_all(db)
#             send_season_premiere_alerts_to_all(db)
#             print("[daily digest] Done — emails sent")
#         except Exception as e:
#             print(f"[daily digest] Error: {e}")
#         finally:
#             db.close()


async def _daily_digest_loop():
    """Fires at the top of every hour. Each function filters users by their preferred local hour."""
    while True:
        try:
            now = datetime.now(dt_timezone.utc)
            next_hour = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
            wait_seconds = (next_hour - now).total_seconds()
            logger.info("daily digest: sleeping %.0fs until top of next hour", wait_seconds)
            await asyncio.sleep(wait_seconds)

            now_utc = datetime.now(dt_timezone.utc)
            logger.info("daily digest: hourly sweep firing at %s UTC", now_utc.strftime("%H:%M"))
            with _db_session() as db:
                await asyncio.to_thread(send_daily_digest_to_all, db, now_utc=now_utc)
                await asyncio.to_thread(send_season_premiere_alerts_to_all, db, now_utc=now_utc)
            logger.info("daily digest: hourly sweep done")

        except Exception as e:
            logger.error("daily digest loop error: %s", e)
            await asyncio.sleep(60)


async def _episode_update_loop():
    """Refresh show's episodes and TMDB vote_average for all shows and movies once a day at 3am."""
    eastern = ZoneInfo("America/New_York")
    while True:
        now = datetime.now(eastern)
        next_run = now.replace(hour=3, minute=0, second=0, microsecond=0)
        if now >= next_run:
            next_run += timedelta(days=1)
        await asyncio.sleep((next_run - now).total_seconds())
        logger.info("vote update: starting daily vote_average refresh")
        try:
            with _db_session() as db:
                refresh_episodes_for_active_shows(db)
                check_and_reactivate_watched_shows(db)
                await asyncio.to_thread(update_all_vote_averages, db)
                prune_stale_cache(db)
        except Exception as e:
            logger.error("vote update error: %s", e)


async def _trailer_refresh_loop():
    """Refresh trailers and notify users of new ones once a day at noon Eastern."""
    eastern = ZoneInfo("America/New_York")
    while True:
        try:
            now = datetime.now(eastern)
            next_run = now.replace(hour=12, minute=0, second=0, microsecond=0)
            if now >= next_run:
                next_run += timedelta(days=1)
            await asyncio.sleep((next_run - now).total_seconds())
            logger.info("trailers: starting trailer refresh")
            with _db_session() as db:
                await asyncio.to_thread(refresh_trailers, db)
            logger.info("trailers: done")
        except Exception as e:
            logger.error("trailers loop error: %s", e)
            await asyncio.sleep(60)


async def _stripe_reconciliation_loop():
    """Reconcile local subscription state against Stripe once a day at 4am Eastern."""
    eastern = ZoneInfo("America/New_York")
    while True:
        try:
            now = datetime.now(eastern)
            next_run = now.replace(hour=4, minute=0, second=0, microsecond=0)
            if now >= next_run:
                next_run += timedelta(days=1)
            await asyncio.sleep((next_run - now).total_seconds())
            logger.info("stripe reconcile: starting")
            with _db_session() as db:
                await asyncio.to_thread(reconcile_stripe_subscriptions, db)
            logger.info("stripe reconcile: done")
        except Exception as e:
            logger.error("stripe reconcile loop error: %s", e)
            await asyncio.sleep(60)


async def _streaming_refresh_loop():
    """Refresh streaming providers and notify users of changes once a day at 5am."""
    eastern = ZoneInfo("America/New_York")
    while True:
        try:
            now = datetime.now(eastern)
            next_run = now.replace(hour=11, minute=0, second=0, microsecond=0)
            if now >= next_run:
                next_run += timedelta(days=1)
            await asyncio.sleep((next_run - now).total_seconds())
            logger.info("streaming: starting provider refresh")
            with _db_session() as db:
                await asyncio.to_thread(refresh_streaming_providers, db)
            logger.info("streaming: done")
        except Exception as e:
            logger.error("streaming loop error: %s", e)
            await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import app.models  # noqa: F401 — registers all models with Base.metadata

    Base.metadata.create_all(engine)
    task = asyncio.create_task(_activity_cleanup_loop())
    digest_task = asyncio.create_task(_daily_digest_loop())
    vote_task = asyncio.create_task(_episode_update_loop())
    streaming_task = asyncio.create_task(_streaming_refresh_loop())
    trailer_task = asyncio.create_task(_trailer_refresh_loop())
    reconcile_task = asyncio.create_task(_stripe_reconciliation_loop())
    yield
    tasks = [task, digest_task, vote_task, streaming_task, trailer_task, reconcile_task]
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="ReleaseRadar API", lifespan=lifespan, redirect_slashes=True)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

setup_logging()


@app.middleware("http")
async def log_request_time(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    request_elapsed_ms.set((time.perf_counter() - start) * 1000)
    return response


app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=[
        "api.releaseradar.co",
        "releaseradar.co",
        "www.releaseradar.co",
        "localhost",
        "127.0.0.1",
    ],
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tv.router, prefix="/tv", tags=["tv"])
app.include_router(movies.router, prefix="/movies", tags=["movies"])
app.include_router(person.router, prefix="/person", tags=["person"])
app.include_router(user.router, prefix="/user", tags=["user"])
app.include_router(watchlist.router, prefix="/watchlist", tags=["watchlist"])
app.include_router(watched.router, prefix="/watched", tags=["watched"])
app.include_router(
    watched_episode.router, prefix="/watched-episode", tags=["movie-episode"]
)
app.include_router(search.router, prefix="/search", tags=["search"])
app.include_router(friends.router, prefix="/friends", tags=["friends"])
app.include_router(
    currently_watching.router, prefix="/currently-watching", tags=["currently-watching"]
)
app.include_router(
    notifications.router, prefix="/notifications", tags=["notifications"]
)
app.include_router(ical.router, prefix="/ical", tags=["ical"])
app.include_router(favorites.router, prefix="/favorites", tags=["favorites"])
app.include_router(
    recommendations.router, prefix="/recommendations", tags=["recommendations"]
)
app.include_router(events.router, prefix="/events", tags=["events"])
app.include_router(reviews.router, prefix="/reviews", tags=["reviews"])
app.include_router(box_office.router, prefix="/box-office", tags=["box-office"])
app.include_router(collections.router, prefix="/collections", tags=["collections"])
app.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
app.include_router(shelf.router, prefix="/shelf", tags=["shelf"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])
app.include_router(billing.router, prefix="/billing", tags=["billing"])
app.include_router(news.router, prefix="/news", tags=["news"])
app.include_router(rewatch.router, prefix="/rewatch", tags=["rewatch"])
app.include_router(import_router.router, prefix="/import", tags=["import"])
app.include_router(moderation.router, prefix="/moderation", tags=["moderation"])
app.include_router(export_router.router, prefix="/export", tags=["export"])
app.include_router(streaming.router, prefix="/streaming", tags=["streaming"])
app.include_router(watch_status.router, prefix="/watch-status", tags=["watch-status"])
app.include_router(feedback.router, tags=["feedback"])
if settings.ENVIRONMENT != "production":
    app.include_router(dev.router, prefix="/dev", tags=["dev"])
