"""Tests for app.services.provider_utils — canonical provider mapping."""

import pytest


class TestCanonicalProviderId:
    def test_variant_maps_to_canonical(self):
        from app.services.provider_utils import canonical_provider_id
        assert canonical_provider_id(175) == 8       # Netflix Kids
        assert canonical_provider_id(1796) == 8      # Netflix basic with ads
        assert canonical_provider_id(10) == 9        # Amazon Video
        assert canonical_provider_id(2) == 350       # Apple TV Store
        assert canonical_provider_id(508) == 337     # DisneyNOW

    def test_unknown_id_returned_as_is(self):
        from app.services.provider_utils import canonical_provider_id
        assert canonical_provider_id(99999) == 99999

    def test_canonical_id_returns_self(self):
        from app.services.provider_utils import canonical_provider_id
        # 8 (Netflix) is canonical so it isn't in CANONICAL_PROVIDER_MAP keys
        assert canonical_provider_id(8) == 8


class TestCanonicalProviderName:
    def test_returns_override_for_canonical(self):
        from app.services.provider_utils import canonical_provider_name
        assert canonical_provider_name(8, "bogus") == "Netflix"
        assert canonical_provider_name(2616, "Paramount Plus Essential") == "Paramount+"
        # Variant ID resolves to canonical and uses override name
        assert canonical_provider_name(531, "ignored") == "Paramount+"

    def test_returns_fallback_when_no_override(self):
        from app.services.provider_utils import canonical_provider_name
        # 337 (Disney Plus) has no entry in CANONICAL_PROVIDER_NAMES
        assert canonical_provider_name(337, "Disney Plus") == "Disney Plus"
        # unknown id
        assert canonical_provider_name(99999, "Custom") == "Custom"


class TestIsCanonical:
    def test_returns_true_for_canonical_id(self):
        from app.services.provider_utils import is_canonical
        assert is_canonical(8) is True
        assert is_canonical(337) is True

    def test_returns_false_for_variant_id(self):
        from app.services.provider_utils import is_canonical
        assert is_canonical(175) is False
        assert is_canonical(1796) is False


class TestAllIdsForService:
    def test_includes_canonical_and_variants(self):
        from app.services.provider_utils import all_ids_for_service
        # Netflix canonical is 8, with variants {175, 1796}
        ids = all_ids_for_service(8)
        assert ids == {8, 175, 1796}

    def test_works_when_starting_from_variant(self):
        from app.services.provider_utils import all_ids_for_service
        ids = all_ids_for_service(175)
        assert ids == {8, 175, 1796}

    def test_id_with_no_variants(self):
        from app.services.provider_utils import all_ids_for_service
        # 337 (Disney+) is canonical and has one variant: 508
        ids = all_ids_for_service(337)
        assert ids == {337, 508}

    def test_unknown_id_returns_just_itself(self):
        from app.services.provider_utils import all_ids_for_service
        ids = all_ids_for_service(99999)
        assert ids == {99999}


class TestNormalizeTmdbWatchProviders:
    def test_no_relevant_sections_returns_unchanged(self):
        from app.services.provider_utils import normalize_tmdb_watch_providers
        raw = {"link": "x"}
        assert normalize_tmdb_watch_providers(raw) == {"link": "x"}

    def test_empty_section_left_alone(self):
        from app.services.provider_utils import normalize_tmdb_watch_providers
        raw = {"flatrate": []}
        out = normalize_tmdb_watch_providers(raw)
        assert out["flatrate"] == []

    def test_deduplicates_variants_to_canonical(self):
        from app.services.provider_utils import normalize_tmdb_watch_providers
        raw = {
            "flatrate": [
                {"provider_id": 175, "provider_name": "Netflix Kids", "logo_path": "/a.jpg"},
                {"provider_id": 1796, "provider_name": "Netflix Ads", "logo_path": "/b.jpg"},
            ]
        }
        out = normalize_tmdb_watch_providers(raw)
        assert len(out["flatrate"]) == 1
        entry = out["flatrate"][0]
        assert entry["provider_id"] == 8
        assert entry["provider_name"] == "Netflix"

    def test_canonical_entry_takes_precedence_over_variant(self):
        from app.services.provider_utils import normalize_tmdb_watch_providers
        raw = {
            "flatrate": [
                {"provider_id": 175, "provider_name": "Netflix Kids", "logo_path": "/k.jpg"},
                {"provider_id": 8, "provider_name": "Netflix", "logo_path": "/n.jpg"},
            ]
        }
        out = normalize_tmdb_watch_providers(raw)
        # When canonical pid arrives, it overwrites the variant entry
        assert out["flatrate"][0]["logo_path"] == "/n.jpg"
        assert out["flatrate"][0]["provider_id"] == 8

    def test_entries_without_provider_id_are_skipped(self):
        from app.services.provider_utils import normalize_tmdb_watch_providers
        raw = {
            "rent": [
                {"provider_name": "no-id"},
                {"provider_id": 9, "provider_name": "Amazon Prime"},
            ]
        }
        out = normalize_tmdb_watch_providers(raw)
        assert len(out["rent"]) == 1
        assert out["rent"][0]["provider_id"] == 9

    def test_handles_all_section_types(self):
        from app.services.provider_utils import normalize_tmdb_watch_providers
        raw = {
            "flatrate": [{"provider_id": 8, "provider_name": "Netflix"}],
            "rent":     [{"provider_id": 10, "provider_name": "Amazon Video"}],
            "buy":      [{"provider_id": 2,  "provider_name": "Apple TV Store"}],
            "free":     [{"provider_id": 538, "provider_name": "Plex"}],
            "ads":      [{"provider_id": 386, "provider_name": "Peacock"}],
        }
        out = normalize_tmdb_watch_providers(raw)
        assert out["flatrate"][0]["provider_id"] == 8
        assert out["rent"][0]["provider_id"] == 9
        assert out["rent"][0]["provider_name"] == "Amazon Prime Video"
        assert out["buy"][0]["provider_id"] == 350
        assert out["buy"][0]["provider_name"] == "Apple TV+"
        assert out["free"][0]["provider_id"] == 538
        assert out["ads"][0]["provider_id"] == 386

    def test_preserves_unknown_provider_name(self):
        from app.services.provider_utils import normalize_tmdb_watch_providers
        raw = {
            "flatrate": [
                {"provider_id": 99999, "provider_name": "Unknown Service"},
            ]
        }
        out = normalize_tmdb_watch_providers(raw)
        assert out["flatrate"][0]["provider_name"] == "Unknown Service"
        assert out["flatrate"][0]["provider_id"] == 99999


class TestRecentlyAddedCanonicalMappings:
    """Spot-check the Amazon/Apple TV Channel variants added in the 2026 audit."""

    @pytest.mark.parametrize("variant_id,canonical_id", [
        # Variants that fold into a bare-name canonical row
        (197, 151),    # BritBox Amazon Channel → BritBox
        (2704, 1957),  # Cineverse Amazon Channel → Cineverse
        (199, 25),     # Fandor Amazon Channel → Fandor
        (2395, 579),   # Film Movement Plus Amazon Channel → Film Movement Plus
        (2406, 417),   # Here TV Amazon Channel → Here TV
        (2403, 503),   # Hi-YAH Amazon Channel → Hi-YAH
        (2390, 430),   # HiDive Amazon Channel → HiDive
        (2057, 268),   # HISTORY Vault Apple TV Channel → History Vault
        (2073, 268),   # HISTORY Vault Amazon Channel → History Vault
        (2055, 284),   # Lifetime Movie Club Apple TV Channel
        (2089, 284),   # Lifetime Movie Club Amazon Channel
        (2367, 1960),  # Midnight Pulp Amazon Channel
        (201, 11),     # MUBI Amazon Channel → MUBI
        (2553, 386),   # Peacock Premium Plus Amazon Channel → Peacock
        (295, 446),    # RetroCrush Amazon Channel → Retrocrush
        (2435, 473),   # Revry Amazon Channel → Revry
        (204, 99),     # Shudder Amazon Channel → Shudder
        (2049, 99),    # Shudder Apple TV Channel → Shudder
        (1866, 457),   # ViX Premium Amazon Channel → VIX
        # No-bare-row services (anchor is lowest-id variant)
        (2071, 2042),  # Carnegie Hall+ Amazon Channel → Carnegie Hall+ (anchor)
        (2060, 603),   # CuriosityStream Apple TV Channel → CuriosityStream (anchor)
        (2058, 290),   # Hallmark+ Apple TV Channel → Hallmark+ (anchor)
        (2069, 2050),  # ScreenPix Amazon Channel → ScreenPix (anchor)
        (2066, 2045),  # UP Faith & Family Amazon Channel → UP Faith & Family (anchor)
        # Second-pass dedupe batch
        (2036, 251),   # ALLBLK Apple TV channel → ALLBLK
        (2064, 251),   # ALLBLK Amazon channel → ALLBLK
        (2040, 343),   # BET+ Apple TV channel → BET+
        (1746, 290),   # Hallmark TV Amazon Channel → Hallmark+
        (294, 293),    # PBS Masterpiece Amazon Channel → PBS
        (2430, 293),   # PBS Documentaries Amazon Channel → PBS
        (600, 439),    # Shout! Factory Amazon Channel → Shout! Factory
        (2326, 554),   # Broadway HD Amazon Channel → BroadwayHD
    ])
    def test_variant_folds_to_canonical(self, variant_id, canonical_id):
        from app.services.provider_utils import canonical_provider_id
        assert canonical_provider_id(variant_id) == canonical_id

    @pytest.mark.parametrize("canonical_id,display_name", [
        (290, "Hallmark+"),
        (293, "PBS"),
        (343, "BET+"),
        (439, "Shout! Factory"),
        (457, "VIX"),           # source row has trailing space
        (603, "CuriosityStream"),
        (2042, "Carnegie Hall+"),
        (2045, "UP Faith & Family"),
        (2050, "ScreenPix"),
    ])
    def test_anchor_display_name_overrides_messy_stored_name(
        self, canonical_id, display_name
    ):
        from app.services.provider_utils import canonical_provider_name
        # Even when given a messy fallback, the override wins
        assert canonical_provider_name(canonical_id, "messy stored name") == display_name

    def test_variant_resolves_to_clean_display_name(self):
        """Variant id → canonical name override (not the variant's stored name)."""
        from app.services.provider_utils import canonical_provider_name
        # Hallmark+ Apple TV Channel (2058) → "Hallmark+"
        assert canonical_provider_name(2058, "Hallmark+ Apple TV Channel") == "Hallmark+"
        # Peacock Premium Plus Amazon Channel (2553) → "Peacock"
        assert canonical_provider_name(2553, "Peacock Premium Plus Amazon Channel") == "Peacock"
