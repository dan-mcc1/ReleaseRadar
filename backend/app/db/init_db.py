# src/db/init_db.py
from app.db.base import Base
from app.db.session import engine

# Import all models here so they are registered with Base
from app.models.user import User
from app.models.show import Show
from app.models.movie import Movie
from app.models.watchlist import Watchlist
from app.models.episode import Episode
from app.models.episode_watched import EpisodeWatched
from app.models.watched import Watched
from app.models.genre import Genre, ShowGenre, MovieGenre
from app.models.provider import Provider, ShowProvider, MovieProvider
from app.models.season import Season
from app.models.friendship import Friendship

# add others as needed


def init_db():
    Base.metadata.create_all(bind=engine)
    print("Database tables created!")


if __name__ == "__main__":
    init_db()
