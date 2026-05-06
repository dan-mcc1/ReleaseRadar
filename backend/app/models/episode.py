# app/models/episode.py
from sqlalchemy import Column, Integer, String, Date, Text, Float, ForeignKey, UniqueConstraint, Index
from app.db.base import Base


class Episode(Base):
    __tablename__ = "episode"

    id = Column(Integer, primary_key=True)  # TMDB episode ID
    show_id = Column(Integer, ForeignKey("show.id", ondelete="CASCADE"), nullable=False)
    season_number = Column(Integer, nullable=False)
    episode_number = Column(Integer, nullable=False)
    name = Column(String)
    overview = Column(Text)
    air_date = Column(Date, nullable=True)
    runtime = Column(Integer, nullable=True)
    still_path = Column(String, nullable=True)
    vote_average = Column(Float, nullable=True)
    episode_type = Column(String, nullable=True)  # "standard", "finale", "mid_season"

    __table_args__ = (
        UniqueConstraint("show_id", "season_number", "episode_number", name="uq_show_season_episode"),
        Index("ix_episode_show_air_date", "show_id", "air_date"),
        Index("ix_episode_air_date", "air_date"),
    )
