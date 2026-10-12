from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
import json


class Settings(BaseSettings):
    CORS_ORIGINS: list[str]
    ENVIRONMENT: str = "production"

    # Peers whose X-Real-IP / X-Forwarded-For headers are trusted for rate
    # limiting: loopback (nginx on the same host) and private networks (a
    # platform load balancer). Requests from anywhere else are keyed by the
    # connecting address. Set as a JSON list.
    TRUSTED_PROXY_CIDRS: list[str] = [
        "127.0.0.0/8",
        "::1/128",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "fc00::/7",
    ]

    # Per-client budgets (limits syntax) for unauthenticated routes that call
    # TMDb. Search gets its own, tighter one: each search is four TMDb calls.
    PUBLIC_RATE_LIMIT: str = "300/minute"
    SEARCH_RATE_LIMIT: str = "60/minute"

    @field_validator("CORS_ORIGINS", "TRUSTED_PROXY_CIDRS", mode="before")
    def parse_json(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return [origin.strip() for origin in v.split(",")]
        return v

    TMDB_BEARER_TOKEN: str
    DATABASE_URL: str
    # The job queue's database: the direct (non-pooler) Neon endpoint of the
    # same database. durable-queue reads it from the environment itself,
    # falling back to DATABASE_URL; declared so .env may set it.
    DURABLE_QUEUE_DATABASE_URL: str = ""
    FRONTEND_URL: str
    # Public base URL of this API (e.g. https://api.releaseradar.co). Emails
    # use it for the one-click List-Unsubscribe header; unset = no header.
    API_PUBLIC_URL: str = ""
    FIREBASE_CREDS_PATH: str
    RESEND_API_KEY: str
    EMAIL_FROM: str
    UNSUBSCRIBE_SECRET: str
    ICAL_SECRET: str
    OMDB_API_KEY: str = (
        ""  # Free key from https://www.omdbapi.com/ (for RT/Metacritic scores)
    )
    NEWS_API_KEY: str = ""  # Free key from https://newsapi.org/

    # Upstream API base URLs. Only overridden by the load-test harness, which
    # points them at a local record/replay proxy (see loadtest/README.md).
    TMDB_BASE_URL: str = "https://api.themoviedb.org/3"
    OMDB_BASE_URL: str = "https://www.omdbapi.com"
    NEWSAPI_BASE_URL: str = "https://newsapi.org/v2"
    TVMAZE_BASE_URL: str = "https://api.tvmaze.com"

    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PREMIUM_MONTHLY_PRICE_ID: str = ""
    STRIPE_PREMIUM_YEARLY_PRICE_ID: str = ""

    SENTRY_DSN: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1

    # Warn if a single request issues more than this many DB queries — useful
    # for catching N+1 patterns in real traffic. Set to 0 to disable.
    QUERY_COUNT_WARN_THRESHOLD: int = 25

    # Whether this process runs durable-queue's worker and scheduler (app/jobs).
    # Safe on every replica, since jobs and schedules are claimed under row
    # locks. Set false to stop background jobs here, locally or as a back-out.
    RUN_JOB_QUEUE: bool = True

    # Nightly deletion of cached shows/movies nobody references. Off until the
    # first run has been reviewed with scripts/prune_review.py.
    CACHE_PRUNE_ENABLED: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
