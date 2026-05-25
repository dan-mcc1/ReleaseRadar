from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
import json


class Settings(BaseSettings):
    CORS_ORIGINS: list[str]
    ENVIRONMENT: str = "production"

    @field_validator("CORS_ORIGINS", mode="before")
    def parse_json(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                return [origin.strip() for origin in v.split(",")]
        return v

    TMDB_BEARER_TOKEN: str
    DATABASE_URL: str
    FRONTEND_URL: str
    FIREBASE_CREDS_PATH: str
    RESEND_API_KEY: str
    EMAIL_FROM: str
    UNSUBSCRIBE_SECRET: str
    ICAL_SECRET: str
    OMDB_API_KEY: str = (
        ""  # Free key from https://www.omdbapi.com/ (for RT/Metacritic scores)
    )
    NEWS_API_KEY: str = ""  # Free key from https://newsapi.org/

    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_PREMIUM_MONTHLY_PRICE_ID: str = ""
    STRIPE_PREMIUM_YEARLY_PRICE_ID: str = ""

    SENTRY_DSN: str = ""
    SENTRY_TRACES_SAMPLE_RATE: float = 0.1

    # Warn if a single request issues more than this many DB queries — useful
    # for catching N+1 patterns in real traffic. Set to 0 to disable.
    QUERY_COUNT_WARN_THRESHOLD: int = 25

    # Whether this process should run the background scheduler loops (daily
    # digest, episode refresh, trailer/streaming notifications, etc.). Set to
    # false on every replica except one when scaling out horizontally, or the
    # loops will fire N times in parallel.
    RUN_SCHEDULERS: bool = True

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
