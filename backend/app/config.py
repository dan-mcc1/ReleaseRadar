from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator
import json


class Settings(BaseSettings):
    CORS_ORIGINS: list[str]
    ENVIRONMENT: str = "production"

    @field_validator("CORS_ORIGINS", mode="before")
    def parse_json(cls, v):
        if isinstance(v, str):
            return json.loads(v)
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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
