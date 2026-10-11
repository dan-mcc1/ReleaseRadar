"""
app.config.Settings reads backend/.env, and pydantic-settings rejects any key
in that file it doesn't declare. A variable that only a library reads still
needs a field here, or the app fails to start.
"""


def test_env_file_may_set_the_job_queue_url(tmp_path, monkeypatch):
    from app.config import Settings

    # load_dotenv() in app.db.session may already have exported a real one,
    # and the environment outranks the env file.
    monkeypatch.delenv("DURABLE_QUEUE_DATABASE_URL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text("DURABLE_QUEUE_DATABASE_URL=postgresql://queue-direct\n")

    settings = Settings(_env_file=env_file)

    assert settings.DURABLE_QUEUE_DATABASE_URL == "postgresql://queue-direct"
