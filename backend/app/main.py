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
)
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Show Tracker API")

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
