import asyncio
import logging
import time

import httpx
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.core.limiter import limiter, rate_limit
from app.core.logging import (
    setup_logging,
    install_query_counter,
    request_elapsed_ms,
    request_query_count,
)
from app.config import settings

if settings.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        integrations=[
            FastApiIntegration(),
            StarletteIntegration(),
            SqlalchemyIntegration(),
        ],
    )
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
    season_rating,
    box_office,
    collections,
    community,
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
from app.db.session import engine
from app.jobs import start_job_queue, stop_job_queue

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Alembic is the single source of truth for the production schema —
    # `alembic upgrade head` runs on every deploy. We deliberately don't call
    # Base.metadata.create_all here: it would silently create new tables for
    # any model added without a matching migration, leaving prod out of sync
    # with the migration history. Tests still call create_all in conftest.py.
    import app.models  # noqa: F401 — registers all models with Base.metadata

    runner = None
    if settings.RUN_JOB_QUEUE:
        # A connect and a few statements, before any request is served.
        # Raises if the queue's database is unreachable, failing startup.
        runner = start_job_queue()
    else:
        logger.info("RUN_JOB_QUEUE=false — job queue disabled on this replica")

    yield
    if runner is not None:
        await asyncio.to_thread(stop_job_queue, runner)


app = FastAPI(title="ReleaseRadar API", lifespan=lifespan, redirect_slashes=True)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(httpx.HTTPStatusError)
async def upstream_status_error(request: Request, exc: httpx.HTTPStatusError):
    """An upstream API (TMDb, OMDb, ...) answered with an error status. A
    missing title is a plain 404, not a server bug for Sentry."""
    status = exc.response.status_code
    if status == 404:
        return JSONResponse({"detail": "Not found."}, status_code=404)
    # Path only: OMDb carries its API key in the query string.
    logger.warning(
        "upstream %s%s returned %s (for %s)",
        exc.request.url.host, exc.request.url.path, status, request.url.path,
    )
    if status == 429:
        return JSONResponse(
            {"detail": "Too many requests. Please try again shortly."},
            status_code=503,
            headers={"Retry-After": "30"},
        )
    return JSONResponse({"detail": "Upstream service error."}, status_code=502)


@app.exception_handler(httpx.TransportError)
async def upstream_unreachable(request: Request, exc: httpx.TransportError):
    logger.warning("upstream unreachable (%s) for %s", type(exc).__name__, request.url.path)
    return JSONResponse({"detail": "Upstream service unavailable."}, status_code=502)

setup_logging()


install_query_counter(engine)


_IS_PROD = settings.ENVIRONMENT == "production"


# Order matters: each @app.middleware("http") prepends to the user middleware
# stack, so the LAST decorator becomes the OUTERMOST middleware. log_request_time
# must be outermost — Starlette's BaseHTTPMiddleware runs inner middleware in a
# separate anyio task, and ContextVar writes (request_elapsed_ms) don't
# propagate from the inner task back to the outer task where uvicorn fires the
# access log.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )
    if _IS_PROD:
        response.headers["Strict-Transport-Security"] = (
            "max-age=63072000; includeSubDomains; preload"
        )
    return response


@app.middleware("http")
async def log_request_time(request: Request, call_next):
    start = time.perf_counter()
    request_query_count.set(0)
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    queries = request_query_count.get()
    request_elapsed_ms.set(elapsed_ms)

    threshold = settings.QUERY_COUNT_WARN_THRESHOLD
    if threshold and queries > threshold:
        logger.warning(
            "high query count: %s %s issued %d queries (%.0fms)",
            request.method,
            request.url.path,
            queries,
            elapsed_ms,
        )
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

# Unauthenticated routers that proxy TMDb share one per-client budget.
PUBLIC_RATE_LIMIT = [Depends(rate_limit("public", "PUBLIC_RATE_LIMIT"))]

app.include_router(tv.router, prefix="/tv", tags=["tv"], dependencies=PUBLIC_RATE_LIMIT)
app.include_router(
    movies.router, prefix="/movies", tags=["movies"], dependencies=PUBLIC_RATE_LIMIT
)
app.include_router(
    person.router, prefix="/person", tags=["person"], dependencies=PUBLIC_RATE_LIMIT
)
app.include_router(user.router, prefix="/user", tags=["user"])
app.include_router(watchlist.router, prefix="/watchlist", tags=["watchlist"])
app.include_router(watched.router, prefix="/watched", tags=["watched"])
app.include_router(
    watched_episode.router, prefix="/watched-episode", tags=["movie-episode"]
)
app.include_router(
    search.router, prefix="/search", tags=["search"], dependencies=PUBLIC_RATE_LIMIT
)
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
app.include_router(season_rating.router, prefix="/season-rating", tags=["season-rating"])
app.include_router(
    box_office.router,
    prefix="/box-office",
    tags=["box-office"],
    dependencies=PUBLIC_RATE_LIMIT,
)
app.include_router(
    collections.router,
    prefix="/collections",
    tags=["collections"],
    dependencies=PUBLIC_RATE_LIMIT,
)
app.include_router(community.router, prefix="/communities", tags=["communities"])
app.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
app.include_router(shelf.router, prefix="/shelf", tags=["shelf"])
app.include_router(admin.router, prefix="/admin", tags=["admin"])
app.include_router(billing.router, prefix="/billing", tags=["billing"])
app.include_router(
    news.router, prefix="/news", tags=["news"], dependencies=PUBLIC_RATE_LIMIT
)
app.include_router(rewatch.router, prefix="/rewatch", tags=["rewatch"])
app.include_router(import_router.router, prefix="/import", tags=["import"])
app.include_router(moderation.router, prefix="/moderation", tags=["moderation"])
app.include_router(export_router.router, prefix="/export", tags=["export"])
app.include_router(streaming.router, prefix="/streaming", tags=["streaming"])
app.include_router(watch_status.router, prefix="/watch-status", tags=["watch-status"])
app.include_router(feedback.router, tags=["feedback"])
if settings.ENVIRONMENT != "production":
    app.include_router(dev.router, prefix="/dev", tags=["dev"])
