from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class Genre(Base):
    __tablename__ = "genre"

    id = Column(Integer, primary_key=True)  # TMDB genre id
    name = Column(String, nullable=False)

    shows = relationship("Show", secondary="show_genre", back_populates="genres")
    movies = relationship("Movie", secondary="movie_genre", back_populates="genres")


class ShowGenre(Base):
    __tablename__ = "show_genre"

    show_id = Column(
        Integer, ForeignKey("show.id", ondelete="CASCADE"), primary_key=True
    )
    genre_id = Column(
        Integer, ForeignKey("genre.id", ondelete="CASCADE"), primary_key=True
    )


class MovieGenre(Base):
    __tablename__ = "movie_genre"

    movie_id = Column(
        Integer, ForeignKey("movie.id", ondelete="CASCADE"), primary_key=True
    )
    genre_id = Column(
        Integer, ForeignKey("genre.id", ondelete="CASCADE"), primary_key=True
    )
