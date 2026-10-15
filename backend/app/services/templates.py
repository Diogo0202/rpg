from __future__ import annotations

import re

from app.models import TemplateDraft


ALLOWED_FORMULA = re.compile(r"^[a-z0-9_ +\-*/().d]+$", re.IGNORECASE)


def validate_template(draft: TemplateDraft) -> TemplateDraft:
    field_ids = {field.id for field in draft.fields}
    for field in draft.fields:
        if not field.expression:
            continue
        if not ALLOWED_FORMULA.fullmatch(field.expression):
            raise ValueError(f"expressão de {field.id} contém caracteres não permitidos")
        # Dice literals such as 2d6 are syntax, not field identifiers. Remove
        # them before extracting references so a die with 20 sides is not read
        # as a nonexistent field named "d20".
        expression_without_dice = re.sub(
            r"\b[1-9][0-9]*d[1-9][0-9]*\b", "", field.expression.lower()
        )
        references = set(re.findall(r"\b[a-z][a-z0-9_]*\b", expression_without_dice))
        unknown = references - field_ids
        if unknown:
            raise ValueError(f"expressão de {field.id} referencia campos inexistentes: {', '.join(sorted(unknown))}")
    return draft
