from sqlalchemy import JSON, Column, DateTime, Float, Index, Integer, String
from sqlalchemy.sql import func

from app.db.base import Base


class TitleRecs(Base):
    """The titles recommended alongside one movie or show, best first.

    One row per title per origin, shared by every user who tracks it. For You
    reads these instead of asking TMDb on each visit.
    """

    __tablename__ = "title_recs"

    content_type = Column(String, primary_key=True)  # 'movie' or 'tv'
    content_id = Column(Integer, primary_key=True)
    # Where the list came from. Only 'tmdb' today; the column leaves room for
    # lists built from what people here watch.
    origin = Column(String, primary_key=True, default="tmdb", server_default="tmdb")
    # [[content_type, content_id], ...]; empty when the source has none.
    recs = Column(JSON, nullable=False)
    fetched_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (Index("ix_title_recs_fetched_at", "fetched_at"),)


class RecCandidate(Base):
    """What For You needs to show a recommended title. Most are tracked by
    nobody, so they aren't in the movie/show cache."""

    __tablename__ = "rec_candidate"

    content_type = Column(String, primary_key=True)
    content_id = Column(Integer, primary_key=True)
    title = Column(String, nullable=False)
    poster_path = Column(String)
    backdrop_path = Column(String)
    # ISO date as TMDb sends it: release date for a movie, first air date for a show.
    release_date = Column(String)
    vote_average = Column(Float)
    popularity = Column(Float)
    genre_ids = Column(JSON)
    # Last time a fetched list included this title; old rows are pruned by it.
    seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
