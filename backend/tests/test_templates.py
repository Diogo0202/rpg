import pytest

from app.models import FieldKind, TemplateDraft, TemplateField
from app.services.templates import validate_template


def test_validates_formula_references() -> None:
    draft = TemplateDraft(
        name="Teste",
        fields=[
            TemplateField(id="forca", label="Força", kind=FieldKind.number),
            TemplateField(id="ataque", label="Ataque", kind=FieldKind.roll, expression="1d20+forca"),
        ],
    )
    assert validate_template(draft) == draft


def test_rejects_unknown_formula_field() -> None:
    draft = TemplateDraft(
        name="Teste",
        fields=[TemplateField(id="ataque", label="Ataque", kind=FieldKind.roll, expression="1d20+segredo")],
    )
    with pytest.raises(ValueError, match="inexistentes"):
        validate_template(draft)
