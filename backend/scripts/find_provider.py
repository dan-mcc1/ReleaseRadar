"""Quick lookup: find all provider rows whose name contains any of the given substrings."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.session import SessionLocal
from app.models.provider import Provider
from app.services.provider_utils import canonical_provider_id

TARGETS = ["bh", " hd", "blu", "documentaries", " channel"]

db = SessionLocal()
try:
    rows = db.query(Provider).all()
    for target in TARGETS:
        hits = [p for p in rows if target.lower() in p.name.lower()]
        print(f"\n== matching {target!r} ({len(hits)} rows) ==")
        for p in sorted(hits, key=lambda x: x.id):
            canon = canonical_provider_id(p.id)
            marker = " (canonical)" if canon == p.id else f"  -> already maps to {canon}"
            print(f"   id={p.id:<6} name={p.name!r}{marker}")
finally:
    db.close()
