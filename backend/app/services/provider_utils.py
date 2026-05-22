# Maps non-canonical provider_ids to their canonical (preferred) provider_id.
# Groups together: different tiers, legacy IDs, and "X Amazon/Apple/Roku Channel" variants
# for the same underlying service.
CANONICAL_PROVIDER_MAP: dict[int, int] = {
    # Netflix
    175: 8,     # Netflix Kids → Netflix
    1796: 8,    # Netflix basic with ads → Netflix

    # Amazon Prime Video
    10: 9,      # Amazon Video → Amazon Prime Video
    2100: 9,    # Amazon Prime Video with Ads → Amazon Prime Video

    # Apple TV+
    2: 350,     # Apple TV Store → Apple TV+
    2243: 350,  # Apple TV Amazon Channel → Apple TV+

    # AMC+  (AMC cable channel id=80 stays separate)
    528: 526,   # AMC+ Amazon Channel → AMC+
    635: 526,   # AMC+ Roku Premium Channel → AMC+
    1854: 526,  # AMC Plus Apple TV Channel → AMC+

    # BritBox
    1852: 151,  # BritBox Apple TV Channel → BritBox

    # Cinemax  (no bare "Cinemax" entry in DB; 289 is the lowest available ID)
    2061: 289,  # Cinemax Apple TV Channel → Cinemax Amazon Channel

    # Crunchyroll
    1968: 283,  # Crunchyroll Amazon Channel → Crunchyroll

    # Disney+
    508: 337,   # DisneyNOW → Disney Plus

    # Max (formerly HBO Max)
    1285: 384,  # HBO Max (legacy) → Max
    1899: 384,  # HBO Max (legacy) → Max
    1825: 384,  # HBO Max Amazon Channel → Max

    # MGM Plus
    583: 34,    # MGM+ Amazon Channel → MGM Plus
    636: 34,    # MGM Plus Roku Premium Channel → MGM Plus

    # Paramount+  (531 "Paramount+" is not in DB; 2616 "Paramount Plus Essential" is canonical)
    531: 2616,  # Paramount+ → Paramount Plus Essential
    551: 2616,  # Paramount+ with Showtime → Paramount Plus Essential
    582: 2616,  # Paramount+ Amazon Channel → Paramount Plus Essential
    633: 2616,  # Paramount+ Roku Premium Channel → Paramount Plus Essential
    1853: 2616, # Paramount Plus Apple TV Channel → Paramount Plus Essential
    2303: 2616, # Paramount Plus Premium → Paramount Plus Essential

    # Peacock
    143: 386,   # Peacock Premium (alternate ID) → Peacock
    387: 386,   # Peacock Premium → Peacock
    613: 386,   # Peacock Premium Plus → Peacock

    # Plex  (444 "Plex" is not in DB; 538 "Plex" is canonical)
    444: 538,   # Plex (alternate ID) → Plex
    584: 538,   # Plex Player → Plex

    # Starz
    1794: 43,   # Starz Amazon Channel → Starz
    1855: 43,   # Starz Apple TV Channel → Starz
    634: 43,    # Starz Roku Premium Channel → Starz
}

# Override display names for canonical providers to ensure clean names are shown
# even when the canonical DB row has a variant name (e.g. "Paramount Plus Essential").
CANONICAL_PROVIDER_NAMES: dict[int, str] = {
    8: "Netflix",
    9: "Amazon Prime Video",
    289: "Cinemax",
    350: "Apple TV+",
    384: "Max",
    386: "Peacock",
    526: "AMC+",
    538: "Plex",
    2616: "Paramount+",
}

# All IDs that belong to each canonical group, used for bulk cleanup of legacy stored IDs.
def _build_variants_map() -> dict[int, set[int]]:
    result: dict[int, set[int]] = {}
    for variant_id, canonical_id in CANONICAL_PROVIDER_MAP.items():
        result.setdefault(canonical_id, set()).add(variant_id)
    return result

_VARIANTS_MAP = _build_variants_map()


def canonical_provider_id(provider_id: int) -> int:
    """Return the canonical provider ID, collapsing tiers/variants to a single entry."""
    return CANONICAL_PROVIDER_MAP.get(provider_id, provider_id)


def canonical_provider_name(provider_id: int, fallback_name: str) -> str:
    """Return the display name for a provider, using the canonical name override if set."""
    cpid = canonical_provider_id(provider_id)
    return CANONICAL_PROVIDER_NAMES.get(cpid, fallback_name)


def is_canonical(provider_id: int) -> bool:
    """Return True if this provider_id is the canonical form (not a variant)."""
    return provider_id not in CANONICAL_PROVIDER_MAP


def all_ids_for_service(provider_id: int) -> set[int]:
    """Return the canonical ID plus all known variant IDs for the same service."""
    cpid = canonical_provider_id(provider_id)
    return {cpid} | _VARIANTS_MAP.get(cpid, set())


def normalize_tmdb_watch_providers(raw_providers: dict) -> dict:
    """
    Deduplicate and normalize the 'watch/providers' dict returned directly from TMDB.
    Operates on the US region only. Mutates and returns the dict.

    TMDB structure: {"link": "...", "flatrate": [...], "rent": [...], "buy": [...]}
    Each provider entry: {"provider_id": int, "provider_name": str, "logo_path": str, ...}
    """
    for section in ("flatrate", "rent", "buy", "free", "ads"):
        entries = raw_providers.get(section)
        if not entries:
            continue
        seen: dict[int, dict] = {}
        for entry in entries:
            pid = entry.get("provider_id")
            if pid is None:
                continue
            cpid = canonical_provider_id(pid)
            if cpid not in seen or pid == cpid:
                seen[cpid] = {
                    **entry,
                    "provider_id": cpid,
                    "provider_name": CANONICAL_PROVIDER_NAMES.get(cpid, entry.get("provider_name", "")),
                }
        raw_providers[section] = list(seen.values())
    return raw_providers
