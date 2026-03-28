from sqlalchemy import Column, Integer, String, Boolean, Date, Text
from sqlalchemy.orm import relationship
from app.db.base import Base


class Show(Base):
    __tablename__ = "show"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    backdrop_path = Column(String)
    logo_path = Column(String)
    first_air_date = Column(Date)
    last_air_date = Column(Date)
    homepage = Column(String)
    in_production = Column(Boolean, default=False)
    number_of_seasons = Column(Integer)
    number_of_episodes = Column(Integer)
    overview = Column(Text)
    poster_path = Column(String)
    status = Column(String)
    tagline = Column(String)
    type = Column(String)
    tracking_count = Column(Integer)
    air_time = Column(String, nullable=True)
    air_timezone = Column(String, nullable=True)

    genres = relationship("Genre", secondary="show_genre", back_populates="shows", passive_deletes=True)
    show_providers = relationship("ShowProvider", back_populates="show", cascade="all, delete-orphan", passive_deletes=True)
    seasons = relationship("Season", back_populates="show", cascade="all, delete-orphan", passive_deletes=True, order_by="Season.season_number")
