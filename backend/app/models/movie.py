from sqlalchemy import Column, Integer, String, Text, Date, Float
from sqlalchemy.orm import relationship
from app.db.base import Base


class Movie(Base):
    __tablename__ = "movie"

    id = Column(Integer, primary_key=True)
    imdb_id = Column(String)
    backdrop_path = Column(String)
    logo_path = Column(String)
    budget = Column(Float)
    homepage = Column(String)
    overview = Column(Text)
    tagline = Column(String)
    poster_path = Column(String)
    release_date = Column(Date)
    revenue = Column(Float)
    runtime = Column(Integer)
    status = Column(String)
    title = Column(String)
    tracking_count = Column(Integer)

    genres = relationship("Genre", secondary="movie_genre", back_populates="movies", passive_deletes=True)
    movie_providers = relationship("MovieProvider", back_populates="movie", cascade="all, delete-orphan", passive_deletes=True)
