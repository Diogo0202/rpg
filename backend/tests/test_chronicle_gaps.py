from datetime import date

import pytest
from pydantic import ValidationError

from app.services.chronicle_gaps import (
    ActivityRecord,
    ChronicleCharacter,
    ChronicleGapRequest,
    Goal,
    GoalPolarity,
    SheetNote,
    SheetTrait,
    Supporter,
    Touchstone,
    TraitCategory,
)


@pytest.mark.parametrize(
    ("record_field", "character_field", "entry"),
    [
        ("used_ambition_ids", "ambitions", Goal(id="a1", statement="A", target_id="t", target_label="Alvo", polarity=GoalPolarity.pursues)),
        ("used_desire_ids", "desires", Goal(id="d1", statement="D", target_id="t", target_label="Alvo", polarity=GoalPolarity.pursues)),
        ("used_touchstone_ids", "touchstones", Touchstone(id="ts1", label="Âncora")),
        ("used_defect_ids", "defects", SheetNote(id="df1", text="Complicação")),
        ("threatened_supporter_ids", "supporters", Supporter(id="sp1", name="Apoio")),
    ],
)
def test_activity_references_must_belong_to_its_character(record_field, character_field, entry) -> None:
    character = ChronicleCharacter(id="c1", name="Personagem", **{character_field: [entry]})
    record = ActivityRecord(
        id="r1", occurred_on=date(2026, 10, 1), character_id="c1", **{record_field: [entry.id]}
    )
    request = ChronicleGapRequest(characters=[character], activity=[record], as_of=date(2026, 10, 2))
    report = __import__("app.services.chronicle_gaps", fromlist=["analyze_chronicle_gaps"]).analyze_chronicle_gaps(request)
    assert report.activity_record_count == 1


def test_rejects_activity_reference_to_another_character_trait() -> None:
    first = ChronicleCharacter(id="c1", name="Um")
    second = ChronicleCharacter(id="c2", name="Dois", traits=[SheetTrait(id="tr1", name="Furtividade", category=TraitCategory.skill)])
    record = ActivityRecord(
        id="r1", occurred_on=date(2026, 10, 1), character_id="c1", used_trait_ids=["tr1"]
    )
    with pytest.raises(ValidationError, match="inexistentes"):
        ChronicleGapRequest(characters=[first, second], activity=[record], as_of=date(2026, 10, 2))


def test_rejects_nonexistent_goal_reference() -> None:
    character = ChronicleCharacter(id="c1", name="Personagem")
    record = ActivityRecord(
        id="r1", occurred_on=date(2026, 10, 1), character_id="c1", used_ambition_ids=["missing"]
    )
    with pytest.raises(ValidationError, match="ambições inexistentes"):
        ChronicleGapRequest(characters=[character], activity=[record], as_of=date(2026, 10, 2))
