import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from fastapi import FastAPI
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
)
from fastapi.middleware.cors import CORSMiddleware
from app.db.session import SessionLocal, engine
from app.db.base import Base
from app.services.activity_service import delete_old_activity
from app.services.recommendation_service import delete_old_recommendations
from app.routers.notifications import send_daily_digest_to_all


async def _activity_cleanup_loop():
    """Delete activity and old recommendations, runs every hour."""
    while True:
        try:
            db = SessionLocal()
            deleted_activity = delete_old_activity(db)
            if deleted_activity:
                print(f"[activity cleanup] Removed {deleted_activity} old activity entries")
            deleted_recs = delete_old_recommendations(db)
            if deleted_recs:
                print(f"[activity cleanup] Removed {deleted_recs} expired recommendations")
        except Exception as e:
            print(f"[activity cleanup] Error: {e}")
        finally:
            db.close()
        await asyncio.sleep(3600)  # 1 hour


async def _daily_digest_loop():
    """Send daily email digest at 9am every day."""
    while True:
        now = datetime.now()
        next_run = now.replace(hour=9, minute=0, second=0, microsecond=0)
        if now >= next_run:
            next_run += timedelta(days=1)
        wait_seconds = (next_run - now).total_seconds()
        await asyncio.sleep(wait_seconds)
        print("[daily digest] Firing now...")
        try:
            db = SessionLocal()
            send_daily_digest_to_all(db)
            print("[daily digest] Done — emails sent")
        except Exception as e:
            print(f"[daily digest] Error: {e}")
        finally:
            db.close()
        await asyncio.sleep(86400)  # sleep 24h before recalculating


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Import all models so SQLAlchemy Base.metadata is populated before create_all
    import app.models.user  # noqa: F401
    import app.models.watched  # noqa: F401
    import app.models.watchlist  # noqa: F401
    import app.models.episode_watched  # noqa: F401
    import app.models.currently_watching  # noqa: F401
    import app.models.friendship  # noqa: F401
    import app.models.favorite  # noqa: F401
    import app.models.recommendation  # noqa: F401
    import app.models.show  # noqa: F401
    import app.models.movie  # noqa: F401
    import app.models.episode  # noqa: F401
    import app.models.activity  # noqa: F401
    import app.models.review  # noqa: F401
    Base.metadata.create_all(engine)
    task = asyncio.create_task(_activity_cleanup_loop())
    digest_task = asyncio.create_task(_daily_digest_loop())
    yield
    task.cancel()
    digest_task.cancel()


app = FastAPI(title="Show Tracker API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
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
app.include_router(recommendations.router, prefix="/recommendations", tags=["recommendations"])
app.include_router(events.router, prefix="/events", tags=["events"])
app.include_router(reviews.router, prefix="/reviews", tags=["reviews"])
app.include_router(box_office.router, prefix="/box-office", tags=["box-office"])
