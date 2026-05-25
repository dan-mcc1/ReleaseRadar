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

    # BritBox
    197: 151,   # BritBox Amazon Channel → BritBox

    # Carnegie Hall+  (no bare DB row; 2042 is the canonical anchor)
    2071: 2042, # Carnegie Hall+ Amazon Channel → Carnegie Hall+

    # Cineverse
    2704: 1957, # Cineverse Amazon Channel → Cineverse

    # CuriosityStream  (no bare DB row; 603 is the canonical anchor)
    2060: 603,  # CuriosityStream Apple TV Channel → CuriosityStream

    # Fandor
    199: 25,    # Fandor Amazon Channel → Fandor

    # Film Movement Plus
    2395: 579,  # Film Movement Plus Amazon Channel → Film Movement Plus

    # Hallmark+  (no bare DB row; 290 is the canonical anchor)
    2058: 290,  # Hallmark+ Apple TV Channel → Hallmark+

    # Here TV
    2406: 417,  # Here TV Amazon Channel → Here TV

    # Hi-YAH
    2403: 503,  # Hi-YAH Amazon Channel → Hi-YAH

    # HiDive
    2390: 430,  # Hidive Amazon Channel → HiDive

    # History Vault
    2057: 268,  # HISTORY Vault Apple TV Channel → History Vault
    2073: 268,  # HISTORY Vault Amazon Channel → History Vault

    # Lifetime Movie Club
    2055: 284,  # Lifetime Movie Club Apple TV Channel → Lifetime Movie Club
    2089: 284,  # Lifetime Movie Club Amazon Channel → Lifetime Movie Club

    # Midnight Pulp
    2367: 1960, # Midnight Pulp Amazon Channel → Midnight Pulp

    # MUBI
    201: 11,    # MUBI Amazon Channel → MUBI

    # Peacock (extending existing group)
    2553: 386,  # Peacock Premium Plus Amazon Channel → Peacock

    # Retrocrush
    295: 446,   # RetroCrush Amazon Channel → Retrocrush

    # Revry
    2435: 473,  # Revry Amazon Channel → Revry

    # ScreenPix  (no bare DB row; 2050 is the canonical anchor)
    2069: 2050, # ScreenPix Amazon Channel → ScreenPix

    # Shudder
    204: 99,    # Shudder Amazon Channel → Shudder
    2049: 99,   # Shudder Apple TV Channel → Shudder

    # UP Faith & Family  (no bare DB row; 2045 is the canonical anchor)
    2066: 2045, # UP Faith & Family Amazon Channel → UP Faith & Family

    # VIX
    1866: 457,  # ViX Premium Amazon Channel → VIX

    # ALLBLK
    2036: 251,  # ALLBLK Apple TV channel → ALLBLK
    2064: 251,  # ALLBLK Amazon channel → ALLBLK

    # BET+
    2040: 343,  # BET+ Apple TV channel → BET+

    # Hallmark — fold the linear-channel-via-Prime entry into Hallmark+
    1746: 290,  # Hallmark TV Amazon Channel → Hallmark+

    # PBS — collapse the three Prime sub-channels into one PBS entry
    294: 293,   # PBS Masterpiece Amazon Channel → PBS
    2430: 293,  # PBS Documentaries Amazon Channel → PBS

    # Shout! Factory
    600: 439,   # Shout! Factory Amazon Channel → Shout! Factory TV

    # BroadwayHD  (channel-variant name has a stray space: "Broadway HD")
    2326: 554,  # Broadway HD Amazon Channel → BroadwayHD
}

# Override display names for canonical providers to ensure clean names are shown
# even when the canonical DB row has a variant name (e.g. "Paramount Plus Essential").
CANONICAL_PROVIDER_NAMES: dict[int, str] = {
    8: "Netflix",
    9: "Amazon Prime Video",
    289: "Cinemax",
    290: "Hallmark+",
    293: "PBS",
    343: "BET+",
    350: "Apple TV+",
    384: "Max",
    386: "Peacock",
    439: "Shout! Factory",
    457: "VIX",
    526: "AMC+",
    538: "Plex",
    603: "CuriosityStream",
    2042: "Carnegie Hall+",
    2045: "UP Faith & Family",
    2050: "ScreenPix",
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


def normalize_tmdb_watch_providers(raw_providers: dict, db=None) -> dict:
    """
    Deduplicate and normalize the 'watch/providers' dict returned directly from TMDB.
    Operates on the US region only. Mutates and returns the dict.

    TMDB structure: {"link": "...", "flatrate": [...], "rent": [...], "buy": [...]}
    Each provider entry: {"provider_id": int, "provider_name": str, "logo_path": str, ...}

    When ``db`` is provided, canonical IDs that only appear via a variant (e.g.
    "HBO Max Amazon Channel") have their logo_path swapped for the canonical
    Provider row's logo — variants ship branded "X on Prime Video" logos.
    """
    variant_only_cpids: set[int] = set()
    for section in ("flatrate", "rent", "buy", "free", "ads"):
        entries = raw_providers.get(section)
        if not entries:
            continue
        seen: dict[int, dict] = {}
        canonical_seen: set[int] = set()
        for entry in entries:
            pid = entry.get("provider_id")
            if pid is None:
                continue
            cpid = canonical_provider_id(pid)
            if pid == cpid:
                canonical_seen.add(cpid)
            if cpid not in seen or pid == cpid:
                seen[cpid] = {
                    **entry,
                    "provider_id": cpid,
                    "provider_name": CANONICAL_PROVIDER_NAMES.get(cpid, entry.get("provider_name", "")),
                }
        for cpid in seen:
            if cpid not in canonical_seen:
                variant_only_cpids.add(cpid)
        raw_providers[section] = list(seen.values())

    if db is not None and variant_only_cpids:
        from app.models.provider import Provider
        rows = db.query(Provider).filter(Provider.id.in_(variant_only_cpids)).all()
        logo_overrides = {p.id: p.logo_path for p in rows if p.logo_path}
        if logo_overrides:
            for section in ("flatrate", "rent", "buy", "free", "ads"):
                for entry in raw_providers.get(section) or []:
                    pid = entry.get("provider_id")
                    if pid in logo_overrides:
                        entry["logo_path"] = logo_overrides[pid]
    return raw_providers
