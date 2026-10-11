from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session


def insert_if_absent(db: Session, model, values: dict, conflict_cols) -> int | None:
    """INSERT ... ON CONFLICT DO NOTHING RETURNING id.

    Returns the new row's id, or None when a row with the same conflict key
    already exists — including one a concurrent request committed after the
    caller's own existence check. (SQLite, used by the tests, accepts the
    same ON CONFLICT / RETURNING syntax.)
    """
    stmt = (
        pg_insert(model)
        .values(**values)
        .on_conflict_do_nothing(index_elements=list(conflict_cols))
        .returning(model.id)
    )
    return db.execute(stmt).scalar()
