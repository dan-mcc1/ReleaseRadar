"""Review the first run of the cache prune before turning it on.

Usage (from backend/):
    python -m scripts.prune_review report               # read-only; writes CSVs
    python -m scripts.prune_review apply prune_review/to_delete.csv

`report` writes three files to prune_review/ (gitignored: they contain usernames):
    to_delete.csv        titles the first run would delete. Nobody has any data
                         on them. Change `decision` to `keep` for any to keep.
    now_protected.csv    per user, data the old tracking_count rule would have
                         deleted that the new rule keeps. Nothing to do.
    already_missing.csv  per user, entries whose show/movie row is already gone.

`apply` deletes the rows marked `delete` (re-checking each is still unused)
and resets the 90-day clock on rows marked `keep`. Afterwards set
CACHE_PRUNE_ENABLED=true and the nightly prune runs on its own.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from app.db.session import SessionLocal
from app.services.cache_prune_service import apply_review, build_review

_FILES = {
    "to_delete": ["decision", "content_type", "id", "title", "last_updated"],
    "now_protected": ["username", "user_id", "content_type", "content_id", "title", "data"],
    "already_missing": ["username", "user_id", "content_type", "content_id", "data"],
}


def _report(out_dir: Path) -> int:
    db = SessionLocal()
    try:
        review = build_review(db)
    finally:
        db.rollback()
        db.close()

    out_dir.mkdir(parents=True, exist_ok=True)
    for name, columns in _FILES.items():
        rows = getattr(review, name)
        with (out_dir / f"{name}.csv").open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        print(f"{name}.csv: {len(rows)} row(s)")
    print(f"Wrote {out_dir.resolve()}")
    return 0


def _apply(path: Path) -> int:
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    db = SessionLocal()
    try:
        result = apply_review(db, rows)
    finally:
        db.close()

    print(f"deleted {result['deleted']}, kept {result['kept']}")
    for kind, title_id in result["skipped"]:
        print(
            f"skipped {kind} {title_id}: now in use, recently updated, "
            "or the database refused the delete (see warnings above)"
        )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Review the first cache prune run.")
    sub = parser.add_subparsers(dest="command", required=True)
    report = sub.add_parser("report", help="Write the review CSVs (read-only).")
    report.add_argument("--out", type=Path, default=Path("prune_review"))
    apply = sub.add_parser("apply", help="Apply decisions from a reviewed to_delete.csv.")
    apply.add_argument("csv", type=Path)
    args = parser.parse_args(argv)

    if args.command == "report":
        return _report(args.out)
    return _apply(args.csv)


if __name__ == "__main__":
    sys.exit(main())
