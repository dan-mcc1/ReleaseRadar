"""Verified Firebase tokens are cached to skip re-verification, but never past
the token's own expiry: a flat one-hour TTL kept accepting a token for up to
an hour after it expired."""

import time

from app.core import firebase as firebase_module


def _verifier(exp_offset: float, calls: list):
    def verify(token, check_revoked=False):
        calls.append(token)
        return {"uid": "u1", "exp": time.time() + exp_offset}

    return verify


def test_token_past_its_expiry_is_verified_again(monkeypatch):
    calls = []
    monkeypatch.setattr(firebase_module.auth, "verify_id_token", _verifier(-1, calls))

    firebase_module.verify_token("tok-just-expired")
    firebase_module.verify_token("tok-just-expired")

    assert calls == ["tok-just-expired", "tok-just-expired"]


def test_live_token_is_verified_once(monkeypatch):
    calls = []
    monkeypatch.setattr(firebase_module.auth, "verify_id_token", _verifier(600, calls))

    first = firebase_module.verify_token("tok-live")
    second = firebase_module.verify_token("tok-live")

    assert calls == ["tok-live"]
    assert first["uid"] == second["uid"] == "u1"
