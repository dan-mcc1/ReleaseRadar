"""Fetch TMDb recommendations for every tracked title that has none stored.

The hourly refresh_title_recommendations job does the same a batch at a time;
this clears the whole backlog in one go, e.g. right after the title_recs
migration. One TMDb request per title. Safe to stop and run again.

Usage (from backend/):
    python -m scripts.backfill_title_recs              # everything due
    python -m scripts.backfill_title_recs --limit 100  # at most 100 titles
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from app.db.session import SessionLocal
from app.services.title_recs_service import refresh_title_recs


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill stored recommendations for tracked titles.")
    parser.add_argument("--limit", type=int, default=None, help="Cap the number of titles fetched in this run.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    started = time.monotonic()
    db = SessionLocal()
    try:
        result = refresh_title_recs(db, limit=args.limit)
    finally:
        db.close()
    print(
        f"{result['due']} due, {result['stored']} stored, {result['pruned']} pruned "
        f"in {time.monotonic() - started:.1f}s"
    )
    # Titles TMDb couldn't serve are still due; a second run retries them.
    return 0 if result["stored"] == result["due"] else 1


if __name__ == "__main__":
    sys.exit(main())
