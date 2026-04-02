from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    TMDB_BEARER_TOKEN: str
    DATABASE_URL: str
    FRONTEND_URL: str = ""
    FIREBASE_CREDS_PATH: str = "/etc/secrets/firebase-service.json"
    RESEND_API_KEY: str = ""
    EMAIL_FROM: str = "Release Radar <noreply@contact.releaseradar.co>"
    UNSUBSCRIBE_SECRET: str = "change-me-to-a-random-secret"
    ICAL_SECRET: str = "change-me-to-a-random-secret"
    OMDB_API_KEY: str = (
        ""  # Free key from https://www.omdbapi.com/ (for RT/Metacritic scores)
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
