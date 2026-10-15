from __future__ import annotations

import ast
import math
import operator
from typing import Any

from app.models import FieldKind, TemplateDraft


MAX_ABS_RESULT = 1_000_000_000_000
MAX_POWER = 12

_BINARY_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPERATORS = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def calculate_sheet(draft: TemplateDraft, values: dict[str, Any]) -> dict[str, Any]:
    fields = {field.id: field for field in draft.fields}
    formulas = {
        field_id: field.expression
        for field_id, field in fields.items()
        if field.kind == FieldKind.formula and field.expression
    }

    unknown_values = set(values) - fields.keys()
    if unknown_values:
        raise ValueError(f"valores para campos inexistentes: {', '.join(sorted(unknown_values))}")
    overridden_formulas = set(values) & formulas.keys()
    if overridden_formulas:
        raise ValueError(f"campos calculados não aceitam valor manual: {', '.join(sorted(overridden_formulas))}")

    parsed: dict[str, ast.Expression] = {}
    dependencies: dict[str, set[str]] = {}
    for field_id, expression in formulas.items():
        try:
            tree = ast.parse(expression, mode="eval")
        except SyntaxError as error:
            raise ValueError(f"expressão inválida em {field_id}") from error
        names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        unknown_names = names - fields.keys()
        if unknown_names:
            raise ValueError(f"expressão de {field_id} referencia campos inexistentes: {', '.join(sorted(unknown_names))}")
        parsed[field_id] = tree
        dependencies[field_id] = names & formulas.keys()

    order: list[str] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(field_id: str) -> None:
        if field_id in visiting:
            raise ValueError("dependência circular entre campos calculados")
        if field_id in visited:
            return
        visiting.add(field_id)
        for dependency in sorted(dependencies[field_id]):
            visit(dependency)
        visiting.remove(field_id)
        visited.add(field_id)
        order.append(field_id)

    for field_id in formulas:
        visit(field_id)

    result = dict(values)
    for field_id in order:
        result[field_id] = _evaluate(parsed[field_id].body, result)
    return result


def _evaluate(node: ast.AST, values: dict[str, Any]) -> int | float:
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return _bounded_number(node.value)
    if isinstance(node, ast.Name):
        if node.id not in values:
            raise ValueError(f"campo {node.id} precisa de um valor numérico")
        value = values[node.id]
        if type(value) not in (int, float):
            raise ValueError(f"campo {node.id} precisa de um valor numérico")
        return _bounded_number(value)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPERATORS:
        return _bounded_number(_UNARY_OPERATORS[type(node.op)](_evaluate(node.operand, values)))
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
        left = _evaluate(node.left, values)
        right = _evaluate(node.right, values)
        if isinstance(node.op, ast.Pow) and abs(right) > MAX_POWER:
            raise ValueError(f"expoente acima do limite de {MAX_POWER}")
        if isinstance(node.op, ast.Pow) and left < 0 and not float(right).is_integer():
            raise ValueError("expoente fracionário de base negativa não é permitido")
        try:
            value = _BINARY_OPERATORS[type(node.op)](left, right)
        except ZeroDivisionError as error:
            raise ValueError("divisão por zero") from error
        except (OverflowError, ValueError) as error:
            raise ValueError("operação aritmética inválida") from error
        return _bounded_number(value)
    raise ValueError("expressão contém sintaxe não permitida")


def _bounded_number(value: int | float) -> int | float:
    if type(value) not in (int, float):
        raise ValueError("operação aritmética inválida")
    if isinstance(value, int):
        if abs(value) > MAX_ABS_RESULT:
            raise ValueError("resultado numérico fora do limite permitido")
        return value
    if not math.isfinite(value) or abs(value) > MAX_ABS_RESULT:
        raise ValueError("resultado numérico fora do limite permitido")
    return value
