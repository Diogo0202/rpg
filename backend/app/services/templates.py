from __future__ import annotations

import ast
import math
import re

from app.models import TemplateDraft


ALLOWED_FORMULA = re.compile(r"^[a-z0-9_ +\-*/().d]+$", re.IGNORECASE)


def validate_template(draft: TemplateDraft) -> TemplateDraft:
    if draft.inventory_schema:
        if any(field.kind.value in {"formula", "roll"} or field.depends_on is not None or field.private for field in draft.inventory_schema):
            raise ValueError("campos de inventário aceitam valores simples, sem fórmulas, dependências ou segredos")
        validate_template(TemplateDraft(name=draft.name, fields=draft.inventory_schema))
    field_ids = {field.id for field in draft.fields}
    numeric_ids = {field.id for field in draft.fields if field.kind.value in {"number", "formula"}}
    formulas = {}
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
        if field.kind.value == "formula":
            try:
                tree = ast.parse(field.expression, mode="eval")
            except SyntaxError as error:
                raise ValueError(f"fórmula inválida em {field.id}") from error
            allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Name, ast.Load, ast.Constant,
                       ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow, ast.UAdd, ast.USub)
            for node in ast.walk(tree):
                if not isinstance(node, allowed):
                    raise ValueError(f"sintaxe não permitida em {field.id}")
                if isinstance(node, ast.Constant) and (type(node.value) not in (int, float) or not math.isfinite(node.value) or abs(node.value) > 1_000_000_000_000):
                    raise ValueError(f"constante inválida em {field.id}")
            names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
            if names - numeric_ids:
                raise ValueError(f"fórmula de {field.id} deve referenciar campos numéricos")
            formulas[field.id] = names
    visiting, visited = set(), set()

    def visit(field_id: str) -> None:
        if field_id in visiting:
            raise ValueError("dependência circular entre campos calculados")
        if field_id in visited:
            return
        visiting.add(field_id)
        for dependency in formulas[field_id] & formulas.keys():
            visit(dependency)
        visiting.remove(field_id)
        visited.add(field_id)

    for field_id in formulas:
        visit(field_id)
    return draft
