from sqlalchemy import Column, Float, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.db.base import Base


class Collection(Base):
    __tablename__ = "collection"

    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False, index=True)
    poster_path = Column(String, nullable=True)
    backdrop_path = Column(String, nullable=True)
    overview = Column(Text, nullable=True)
    # Denormalized aggregates over the collection's parts, refreshed at ingest
    # time so /collections/browse can paginate from a single SELECT with no
    # joins. NULL when the collection hasn't been ingested yet.
    size = Column(Integer, nullable=True, index=True)
    avg_rating = Column(Float, nullable=True, index=True)
    # Average of TMDb's `popularity` across the collection's parts at ingest
    # time. We don't persist popularity on Movie (it decays daily and would
    # bloat refresh churn) — only the per-collection aggregate.
    popularity = Column(Float, nullable=True, index=True)
    min_year = Column(Integer, nullable=True)
    max_year = Column(Integer, nullable=True)
    details_refreshed_at = Column(DateTime(timezone=True), nullable=True)
    index_refreshed_at = Column(DateTime(timezone=True), nullable=True)

    parts = relationship(
        "CollectionMovie",
        back_populates="collection",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="CollectionMovie.sort_order",
    )


class CollectionMovie(Base):
    """Unused right now — parts come from TMDb on demand. Kept in case we
    decide to cache parts locally later."""

    __tablename__ = "collection_movie"

    collection_id = Column(
        Integer,
        ForeignKey("collection.id", ondelete="CASCADE"),
        primary_key=True,
    )
    movie_id = Column(Integer, primary_key=True)
    sort_order = Column(Integer, nullable=False, default=0)

    collection = relationship("Collection", back_populates="parts")
