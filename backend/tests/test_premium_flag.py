"""One flag, one helper: OPEN_BETA and tier_has_premium drive every premium check."""
import pytest

from app.config.features import tier_has_premium
from app.dependencies.subscription import is_premium


def _add_user(db, tier):
    from app.models.user import User
    db.add(User(id="u1", username="u1", email="u1@t.com", subscription_tier=tier))
    db.commit()


class TestTierHasPremium:
    @pytest.mark.parametrize("tier", ["free", "premium", "admin", None])
    def test_open_beta_grants_every_tier(self, tier):
        assert tier_has_premium(tier) is True

    @pytest.mark.parametrize("tier, expected", [
        ("free", False), ("premium", True), ("admin", True), (None, False),
    ])
    def test_paywall_checks_the_stored_tier(self, tier, expected, paywall_on):
        assert tier_has_premium(tier) is expected


class TestIsPremium:
    def test_open_beta_grants_a_free_user(self, db):
        _add_user(db, "free")
        assert is_premium("u1", db) is True

    def test_open_beta_needs_no_user_row(self, db):
        assert is_premium("nobody", db) is True

    @pytest.mark.parametrize("tier, expected", [
        ("free", False), ("premium", True), ("admin", True),
    ])
    def test_paywall_checks_the_stored_tier(self, db, tier, expected, paywall_on):
        _add_user(db, tier)
        assert is_premium("u1", db) is expected

    def test_paywall_unknown_user_is_free(self, db, paywall_on):
        assert is_premium("nobody", db) is False
