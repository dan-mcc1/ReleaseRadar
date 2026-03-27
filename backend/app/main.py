import asyncio
from contextlib import asynccontextmanager
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
)
from fastapi.middleware.cors import CORSMiddleware
from app.db.session import SessionLocal
from app.services.activity_service import delete_old_activity


async def _activity_cleanup_loop():
    """Delete activity older than 7 days, runs every hour."""
    while True:
        try:
            db = SessionLocal()
            deleted = delete_old_activity(db)
            if deleted:
                print(f"[activity cleanup] Removed {deleted} old activity entries")
        except Exception as e:
            print(f"[activity cleanup] Error: {e}")
        finally:
            db.close()
        await asyncio.sleep(3600)  # 1 hour


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_activity_cleanup_loop())
    yield
    task.cancel()


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
app.include_router(currently_watching.router, prefix="/currently-watching", tags=["currently-watching"])
app.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
