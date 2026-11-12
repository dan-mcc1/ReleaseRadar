"""Correct episode tags stored before the series-finale fix.

The old tagging called every season's finale of an ended show the "series
finale", and gave a special (season 0) episode 1 a "season premiere" tag. New
and refreshed episodes are tagged correctly now, but the nightly refresh only
covers in-production shows, so ended shows keep the old tags until this runs.

Reports what it would change; nothing is written without --apply. Safe to run
again: a second --apply finds nothing.

Usage (from backend/):
    python -m scripts.fix_episode_tags           # report only
    python -m scripts.fix_episode_tags --apply   # write the changes
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.episode import Episode
from app.models.season import Season


def find_wrong_tags(db: Session) -> tuple[list[Episode], list[Episode]]:
    """(series finales outside the show's last season, tagged specials)."""
    last_season = (
        select(Season.show_id, func.max(Season.season_number).label("top"))
        .where(Season.season_number > 0)
        .group_by(Season.show_id)
        .subquery()
    )
    early_finales = (
        db.query(Episode)
        .join(last_season, last_season.c.show_id == Episode.show_id)
        .filter(
            Episode.episode_type == "series_finale",
            Episode.season_number < last_season.c.top,
        )
        .order_by(Episode.show_id, Episode.season_number)
        .all()
    )
    tagged_specials = (
        db.query(Episode)
        .filter(Episode.season_number == 0, Episode.episode_type.isnot(None))
        .order_by(Episode.show_id, Episode.episode_number)
        .all()
    )
    return early_finales, tagged_specials


def apply_fixes(db: Session, early_finales: list[Episode], tagged_specials: list[Episode]) -> None:
    for ep in early_finales:
        ep.episode_type = "season_finale"
    for ep in tagged_specials:
        ep.episode_type = None
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Correct stored episode tags.")
    parser.add_argument("--apply", action="store_true", help="Write the changes (default: report only).")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        early_finales, tagged_specials = find_wrong_tags(db)
        print(f"{len(early_finales)} series finales outside a show's last season -> season_finale")
        for ep in early_finales[:20]:
            print(f"  show {ep.show_id} S{ep.season_number}E{ep.episode_number} {ep.name!r}")
        print(f"{len(tagged_specials)} tagged specials -> no tag")
        for ep in tagged_specials[:20]:
            print(f"  show {ep.show_id} S0E{ep.episode_number} {ep.episode_type} {ep.name!r}")

        if not args.apply:
            print("Report only. Run with --apply to write these changes.")
            return 0
        apply_fixes(db, early_finales, tagged_specials)
        print("Applied.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
