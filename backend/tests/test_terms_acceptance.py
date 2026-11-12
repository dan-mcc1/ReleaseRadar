"""Sign-up records which Terms version the account agreed to, once."""
from app.config.legal import TERMS_VERSION
from app.models.user import User


def _row(db, uid="test-uid-1"):
    db.expire_all()
    return db.query(User).filter_by(id=uid).one()


def test_sign_up_records_terms_acceptance(client, db):
    r = client.post("/user/create", json={"username": "alice", "accepted_terms": True})

    assert r.status_code == 200
    row = _row(db)
    assert row.terms_version == TERMS_VERSION
    assert row.terms_accepted_at is not None


def test_oauth_first_step_records_it_without_a_username(client, db):
    client.post("/user/create", json={"accepted_terms": True})

    row = _row(db)
    assert row.username is None
    assert row.terms_version == TERMS_VERSION


def test_nothing_recorded_without_acceptance(client, db):
    client.post("/user/create", json={"username": "bob"})

    row = _row(db)
    assert row.terms_version is None
    assert row.terms_accepted_at is None


def test_existing_account_keeps_its_record(client, db):
    client.post("/user/create", json={"accepted_terms": True})
    first = _row(db).terms_accepted_at
    row = _row(db)
    row.terms_version = "2020-01-01"
    db.commit()

    # Every OAuth sign-in calls /user/create again.
    client.post("/user/create", json={"accepted_terms": True})

    row = _row(db)
    assert row.terms_version == "2020-01-01"
    assert row.terms_accepted_at == first
