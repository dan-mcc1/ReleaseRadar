from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    TMDB_BEARER_TOKEN: str
    DATABASE_URL: str
    FRONTEND_URL: str = "https://watch-calendar.vercel.app"
    FIREBASE_CREDS_PATH: str = "/etc/secrets/firebase-service.json"
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_USE_TLS: bool = True
    ICAL_SECRET: str = "change-me-to-a-random-secret"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
