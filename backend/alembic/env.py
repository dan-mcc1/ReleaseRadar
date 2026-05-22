import os
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

from alembic import context

load_dotenv()

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url from the environment so credentials never live in alembic.ini.
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

# Import Base and every model so autogenerate can see the full schema.
from app.db.base import Base  # noqa: E402
import app.models.user  # noqa: F401, E402
import app.models.show  # noqa: F401, E402
import app.models.movie  # noqa: F401, E402
import app.models.episode  # noqa: F401, E402
import app.models.season  # noqa: F401, E402
import app.models.watchlist  # noqa: F401, E402
import app.models.watched  # noqa: F401, E402
import app.models.currently_watching  # noqa: F401, E402
import app.models.episode_watched  # noqa: F401, E402
import app.models.activity  # noqa: F401, E402
import app.models.friendship  # noqa: F401, E402
import app.models.genre  # noqa: F401, E402
import app.models.provider  # noqa: F401, E402
import app.models.review  # noqa: F401, E402
import app.models.report  # noqa: F401, E402
import app.models.appeal  # noqa: F401, E402
import app.models.block  # noqa: F401, E402
import app.models.recommendation  # noqa: F401, E402
import app.models.favorite  # noqa: F401, E402
import app.models.shelf  # noqa: F401, E402
import app.models.shelf_item  # noqa: F401, E402
import app.models.banned_email  # noqa: F401, E402
import app.models.finish_by_goal  # noqa: F401, E402
import app.models.movie_video  # noqa: F401, E402
import app.models.show_video  # noqa: F401, E402
import app.models.user_streaming_service  # noqa: F401, E402
import app.models.feedback  # noqa: F401, E402

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
