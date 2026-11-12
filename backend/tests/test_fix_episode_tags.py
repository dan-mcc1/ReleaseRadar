"""scripts/fix_episode_tags: corrects tags stored by the old tagging rules."""

from datetime import date


def _seed(db):
    from app.models.episode import Episode
    from app.models.season import Season
    from app.models.show import Show

    db.add(Show(id=4200, name="Ended", status="Ended", in_production=False,
                number_of_seasons=2, first_air_date=date(2015, 1, 1)))
    db.flush()
    db.add_all([
        Season(id=42000, show_id=4200, season_number=0, episode_count=1),
        Season(id=42001, show_id=4200, season_number=1, episode_count=2),
        Season(id=42002, show_id=4200, season_number=2, episode_count=2),
    ])
    db.add_all([
        Episode(id=42100, show_id=4200, season_number=0, episode_number=1,
                name="Special", episode_type="season_premiere"),
        Episode(id=42111, show_id=4200, season_number=1, episode_number=1,
                name="Pilot", episode_type="show_premiere"),
        Episode(id=42112, show_id=4200, season_number=1, episode_number=2,
                name="S1 finale", episode_type="series_finale"),
        Episode(id=42122, show_id=4200, season_number=2, episode_number=2,
                name="The end", episode_type="series_finale"),
    ])
    db.commit()


def test_report_then_apply(db):
    from app.models.episode import Episode
    from scripts.fix_episode_tags import apply_fixes, find_wrong_tags

    _seed(db)
    early_finales, tagged_specials = find_wrong_tags(db)
    assert [e.id for e in early_finales] == [42112]
    assert [e.id for e in tagged_specials] == [42100]

    apply_fixes(db, early_finales, tagged_specials)
    db.expire_all()
    types = {e.id: e.episode_type for e in db.query(Episode).filter_by(show_id=4200)}
    assert types == {
        42100: None,
        42111: "show_premiere",
        42112: "season_finale",
        42122: "series_finale",  # the real last finale is left alone
    }

    # Running again finds nothing.
    assert find_wrong_tags(db) == ([], [])
