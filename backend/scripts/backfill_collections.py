"""Run the collection mirror backfill.

Usage (from backend/):
    python -m scripts.backfill_collections           # full run, skip already-done
    python -m scripts.backfill_collections --limit 50      # process at most 50
    python -m scripts.backfill_collections --force         # re-process all, even completed
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from app.db.session import SessionLocal
from app.services.collection_ingest_service import backfill_collections


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill TMDb collections + parts.")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Cap the number of collections processed in this run.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-process every collection, even ones that already have details.",
    )
    parser.add_argument(
        "--skip-dump",
        action="store_true",
        help="Skip the daily index sync at the start.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only log warnings and errors.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.WARNING if args.quiet else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )

    db = SessionLocal()
    started = time.perf_counter()
    try:
        result = backfill_collections(
            db,
            only_missing_details=not args.force,
            limit=args.limit,
            skip_dump=args.skip_dump,
        )
    finally:
        db.close()

    elapsed = time.perf_counter() - started
    print()
    print(f"Done in {elapsed/60:.1f} min.")
    print(f"  Collections succeeded : {result['succeeded']:,}")
    print(f"  Collections failed    : {result['failed']:,}")
    return 0 if result["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
