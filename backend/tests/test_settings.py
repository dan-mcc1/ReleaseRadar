"""
app.config.Settings reads backend/.env, and pydantic-settings rejects any key
in that file it doesn't declare. A variable that only a library reads still
needs a field here, or the app fails to start.
"""

import pytest
from pydantic import ValidationError


def test_env_file_may_set_the_job_queue_url(tmp_path, monkeypatch):
    from app.config import Settings

    # load_dotenv() in app.db.session may already have exported a real one,
    # and the environment outranks the env file.
    monkeypatch.delenv("DURABLE_QUEUE_DATABASE_URL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("DURABLE_QUEUE_DATABASE_URL=postgresql://queue-direct\n")

    settings = Settings(_env_file=env_file)

    assert settings.DURABLE_QUEUE_DATABASE_URL == "postgresql://queue-direct"


_REQUIRED_IN_PROD = ["RESEND_API_KEY", "ICAL_SECRET", "UNSUBSCRIBE_SECRET"]


@pytest.mark.parametrize("name", _REQUIRED_IN_PROD)
@pytest.mark.parametrize("value", ["", "   "])
def test_production_rejects_empty_required_secret(name, value, monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv(name, value)

    with pytest.raises(ValidationError, match=name):
        Settings(_env_file=None)


@pytest.mark.parametrize("name", _REQUIRED_IN_PROD)
def test_non_production_accepts_empty_required_secret(name, monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv(name, "")

    assert getattr(Settings(_env_file=None), name) == ""


def test_production_accepts_filled_required_secrets(monkeypatch):
    from app.config import Settings

    monkeypatch.setenv("ENVIRONMENT", "production")

    assert Settings(_env_file=None).ENVIRONMENT == "production"
