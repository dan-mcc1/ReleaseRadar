"""Bounded, expiring, thread-safe memoization for TMDb/OMDb responses.

Use this instead of functools.lru_cache, which never expires. Size caches for
what an entry weighs once parsed: a full movie payload with credits/images is
~0.5 MB in Python (up to ~1.2 MB), a show or season ~0.15–0.3 MB.

Cached values are shared between requests and threads. Callers that modify a
result must copy it first.
"""

import threading

from cachetools import TTLCache, cached

TTL_SHORT = 1_800   # 30 min — trending / popular lists
TTL_STD = 3_600     # 1 h — title details, search results
TTL_LONG = 86_400   # 24 h — rarely-changing data (genre lists, external ids)

# Full title / person / season payloads. 128 movie details ≈ 70–110 MB.
DETAIL_MAXSIZE = 128
# Query-keyed result lists (~20 items each).
LIST_MAXSIZE = 256


def ttl_cached(maxsize: int, ttl: int):
    return cached(cache=TTLCache(maxsize=maxsize, ttl=ttl), lock=threading.RLock())
