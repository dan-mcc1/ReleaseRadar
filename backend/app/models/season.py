from sqlalchemy import Column, Integer, String, Text, Date, Float, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class Season(Base):
    __tablename__ = "season"

    id = Column(Integer, primary_key=True)  # TMDB season id
    show_id = Column(
        Integer, ForeignKey("show.id", ondelete="CASCADE"), nullable=False, index=True
    )
    season_number = Column(Integer, nullable=False)
    name = Column(String)
    overview = Column(Text)
    air_date = Column(Date, nullable=True)
    episode_count = Column(Integer)
    poster_path = Column(String)
    vote_average = Column(Float)

    show = relationship("Show", back_populates="seasons")
