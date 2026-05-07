from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class Provider(Base):
    __tablename__ = "provider"

    id = Column(Integer, primary_key=True)  # TMDB provider_id
    name = Column(String, nullable=False)
    logo_path = Column(String)

    show_providers = relationship("ShowProvider", back_populates="provider")
    movie_providers = relationship("MovieProvider", back_populates="provider")


class ShowProvider(Base):
    __tablename__ = "show_provider"

    show_id = Column(
        Integer, ForeignKey("show.id", ondelete="CASCADE"), primary_key=True
    )
    provider_id = Column(
        Integer, ForeignKey("provider.id", ondelete="CASCADE"), primary_key=True
    )
    flatrate = Column(Boolean, default=False)
    rent = Column(Boolean, default=False)
    buy = Column(Boolean, default=False)

    show = relationship("Show", back_populates="show_providers")
    provider = relationship("Provider", back_populates="show_providers")


class MovieProvider(Base):
    __tablename__ = "movie_provider"

    movie_id = Column(
        Integer, ForeignKey("movie.id", ondelete="CASCADE"), primary_key=True
    )
    provider_id = Column(
        Integer, ForeignKey("provider.id", ondelete="CASCADE"), primary_key=True
    )
    flatrate = Column(Boolean, default=False)
    rent = Column(Boolean, default=False)
    buy = Column(Boolean, default=False)

    movie = relationship("Movie", back_populates="movie_providers")
    provider = relationship("Provider", back_populates="movie_providers")
