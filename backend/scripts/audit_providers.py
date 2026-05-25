"""
One-off audit: find provider rows that look like undeduped variants of the same
streaming service.

Usage (from backend/):
    venv/Scripts/python.exe scripts/audit_providers.py
"""
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

# Allow running as a script
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.models.provider import Provider
from app.services.provider_utils import (
    CANONICAL_PROVIDER_MAP,
    canonical_provider_id,
)


# Suffixes that mark a tier/variant of the same service
SUFFIX_PATTERNS = [
    r"\s+Amazon Channel$",
    r"\s+Apple TV Channel$",
    r"\s+Roku Premium Channel$",
    r"\s+Roku Channel$",
    r"\s+TV$",                # "Shout! Factory TV" vs "Shout! Factory Amazon Channel"
    r"\s+with Ads$",
    r"\s+Basic with Ads$",
    r"\s+Premium$",
    r"\s+Premium Plus$",
    r"\s+Essential$",
    r"\s+Plus$",
    r"\s+\(legacy\)$",
    r"\s+Kids$",
]
# re.IGNORECASE catches "Apple TV channel" / "Amazon channel" lowercase variants.
SUFFIX_RE = re.compile("|".join(SUFFIX_PATTERNS), re.IGNORECASE)


def normalize(name: str) -> str:
    """Strip known tier/variant suffixes and lowercase for grouping."""
    prev = None
    # Collapse any internal double-spaces ("BET+  Apple TV channel") before suffix-stripping.
    n = re.sub(r"\s+", " ", name).strip()
    # Strip repeatedly (e.g. "Foo Amazon Channel Premium")
    while prev != n:
        prev = n
        n = SUFFIX_RE.sub("", n).strip()
    # Collapse +/Plus spelling variations
    n = re.sub(r"\bPlus\b", "+", n)
    n = n.replace(" +", "+")
    # Strip ALL spaces so "Broadway HD" and "BroadwayHD" collide in the same bucket.
    return re.sub(r"\s+", "", n).lower()


def main():
    db = SessionLocal()
    try:
        providers = db.query(Provider).all()
        print(f"Total providers in DB: {len(providers)}\n")

        groups: dict[str, list[Provider]] = defaultdict(list)
        for p in providers:
            groups[normalize(p.name)].append(p)

        # Filter to groups with >1 row AND where some rows are NOT yet collapsed
        # by CANONICAL_PROVIDER_MAP.
        candidates: list[tuple[str, list[Provider]]] = []
        for norm_name, members in groups.items():
            if len(members) < 2:
                continue
            canonical_targets = {canonical_provider_id(p.id) for p in members}
            if len(canonical_targets) <= 1:
                continue  # already collapsed
            candidates.append((norm_name, members))

        candidates.sort(key=lambda x: x[0])

        print(f"Found {len(candidates)} groups with possible undeduped variants:\n")
        for norm_name, members in candidates:
            print(f"== {norm_name!r} ==")
            for p in sorted(members, key=lambda x: x.id):
                canon = canonical_provider_id(p.id)
                marker = " (canonical)" if canon == p.id else f"  -> already maps to {canon}"
                print(f"   id={p.id:<6} name={p.name!r}{marker}")
            print()
    finally:
        db.close()


if __name__ == "__main__":
    main()
