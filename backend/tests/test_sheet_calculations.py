"""FIC-04: resultados e casos de erro das fórmulas de ficha (sheet_calculations)."""

from __future__ import annotations

from typing import Any

import pytest

from app.models import TemplateDraft
from app.services.sheet_calculations import MAX_ABS_RESULT, MAX_POWER, calculate_sheet


def draft(*formulas: tuple[str, str], numbers: tuple[str, ...] = ("forca", "destreza", "vigor"), extra: list[dict[str, Any]] | None = None) -> TemplateDraft:
    fields: list[dict[str, Any]] = [{"id": field_id, "label": field_id, "kind": "number"} for field_id in numbers]
    fields += [{"id": field_id, "label": field_id, "kind": "formula", "expression": expression} for field_id, expression in formulas]
    fields += extra or []
    return TemplateDraft(name="Teste de fórmulas", fields=fields)


# Resultados


def test_simple_formula_keeps_inputs_and_adds_result() -> None:
    values = {"forca": 3, "destreza": 2, "vigor": 1}
    result = calculate_sheet(draft(("ataque", "forca + destreza")), values)
    assert result == {"forca": 3, "destreza": 2, "vigor": 1, "ataque": 5}
    assert values == {"forca": 3, "destreza": 2, "vigor": 1}, "the input dict is not mutated"


def test_chained_dependencies_resolve_in_dependency_order() -> None:
    # Declared in reverse order: total depends on dobro, which depends on base.
    template = draft(("total", "dobro + vigor"), ("dobro", "base * 2"), ("base", "forca + 1"))
    result = calculate_sheet(template, {"forca": 2, "destreza": 0, "vigor": 4})
    assert (result["base"], result["dobro"], result["total"]) == (3, 6, 10)


def test_diamond_dependencies_evaluate_each_formula_once() -> None:
    template = draft(("topo", "esquerda + direita"), ("esquerda", "raiz + 1"), ("direita", "raiz * 3"), ("raiz", "forca"))
    assert calculate_sheet(template, {"forca": 2, "destreza": 0, "vigor": 0})["topo"] == 9


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("forca + destreza * vigor", 3 + 2 * 4),
        ("(forca + destreza) * vigor", (3 + 2) * 4),
        ("forca - destreza - vigor", 3 - 2 - 4),
        ("forca / destreza", 1.5),
        ("forca // destreza", 1),
        ("forca % destreza", 1),
        ("destreza ** vigor", 16),
        ("-forca + +destreza", -1),
        ("(forca + vigor) // 2", 3),
        ("vigor ** -1", 0.25),
        ("forca * 1.5", 4.5),
    ],
)
def test_arithmetic_operators(expression: str, expected: float) -> None:
    result = calculate_sheet(draft(("valor", expression)), {"forca": 3, "destreza": 2, "vigor": 4})
    assert result["valor"] == pytest.approx(expected)


def test_constants_only_formula() -> None:
    assert calculate_sheet(draft(("fixo", "10 - 3")), {})["fixo"] == 7


def test_template_without_formulas_returns_copy_of_values() -> None:
    values = {"forca": 1}
    result = calculate_sheet(draft(), values)
    assert result == values and result is not values


def test_result_exactly_at_limit_is_allowed() -> None:
    template = draft(("teto", f"10 ** {MAX_POWER}"))
    assert calculate_sheet(template, {})["teto"] == MAX_ABS_RESULT


def test_negative_base_with_integer_exponent_is_allowed() -> None:
    assert calculate_sheet(draft(("cubo", "forca ** 3")), {"forca": -2})["cubo"] == -8


# Erros de estrutura do modelo


def test_direct_cycle_is_rejected() -> None:
    with pytest.raises(ValueError, match="dependência circular"):
        calculate_sheet(draft(("alfa", "beta + 1"), ("beta", "alfa + 1")), {})


def test_self_reference_is_rejected() -> None:
    with pytest.raises(ValueError, match="dependência circular"):
        calculate_sheet(draft(("alfa", "alfa + 1")), {})


def test_long_cycle_is_rejected() -> None:
    with pytest.raises(ValueError, match="dependência circular"):
        calculate_sheet(draft(("alfa", "beta"), ("beta", "gama"), ("gama", "forca + alfa")), {"forca": 1})


def test_reference_to_missing_field_is_rejected() -> None:
    with pytest.raises(ValueError, match="referencia campos inexistentes: carisma"):
        calculate_sheet(draft(("total", "forca + carisma")), {"forca": 1})


def test_builtins_are_unknown_names_not_code() -> None:
    with pytest.raises(ValueError, match="campos inexistentes: __import__"):
        calculate_sheet(draft(("hack", "__import__")), {})


def test_syntax_error_names_the_field() -> None:
    with pytest.raises(ValueError, match="expressão inválida em quebrado"):
        calculate_sheet(draft(("quebrado", "forca +")), {"forca": 1})


@pytest.mark.parametrize(
    "expression",
    [
        "abs(forca)",
        "forca.real",
        "forca > destreza",
        "forca if destreza else vigor",
        "'texto'",
        "True",
        "[forca]",
        "forca and destreza",
        "lambda: forca",
        "forca[0]",
    ],
)
def test_disallowed_syntax_is_rejected(expression: str) -> None:
    with pytest.raises(ValueError):
        calculate_sheet(draft(("valor", expression)), {"forca": 1, "destreza": 1, "vigor": 1})


# Erros de valores


def test_value_for_unknown_field_is_rejected() -> None:
    with pytest.raises(ValueError, match="campos inexistentes: fantasma"):
        calculate_sheet(draft(("total", "forca")), {"forca": 1, "fantasma": 2})


def test_manual_value_for_formula_is_rejected() -> None:
    with pytest.raises(ValueError, match="não aceitam valor manual: total"):
        calculate_sheet(draft(("total", "forca")), {"forca": 1, "total": 99})


def test_missing_input_value_is_rejected() -> None:
    with pytest.raises(ValueError, match="campo destreza precisa de um valor numérico"):
        calculate_sheet(draft(("total", "forca + destreza")), {"forca": 1})


@pytest.mark.parametrize("bad", ["3", True, None, [1], {"a": 1}])
def test_non_numeric_input_is_rejected(bad: Any) -> None:
    with pytest.raises(ValueError, match="precisa de um valor numérico"):
        calculate_sheet(draft(("total", "forca + 1")), {"forca": bad})


def test_missing_value_propagates_through_chain() -> None:
    with pytest.raises(ValueError, match="campo vigor precisa"):
        calculate_sheet(draft(("topo", "meio + 1"), ("meio", "vigor * 2")), {})


# Erros aritméticos e limites


@pytest.mark.parametrize("expression", ["forca / destreza", "forca // destreza", "forca % destreza", "forca / (vigor - vigor)"])
def test_division_by_zero_is_rejected(expression: str) -> None:
    with pytest.raises(ValueError, match="divisão por zero"):
        calculate_sheet(draft(("valor", expression)), {"forca": 3, "destreza": 0, "vigor": 2})


def test_zero_to_negative_power_is_division_by_zero() -> None:
    with pytest.raises(ValueError, match="divisão por zero"):
        calculate_sheet(draft(("valor", "destreza ** -1")), {"destreza": 0})


def test_exponent_above_limit_is_rejected() -> None:
    with pytest.raises(ValueError, match=f"expoente acima do limite de {MAX_POWER}"):
        calculate_sheet(draft(("valor", f"2 ** {MAX_POWER + 1}")), {})


def test_negative_exponent_beyond_limit_is_rejected() -> None:
    with pytest.raises(ValueError, match="expoente acima do limite"):
        calculate_sheet(draft(("valor", f"2 ** -{MAX_POWER + 1}")), {})


def test_fractional_exponent_of_negative_base_is_rejected() -> None:
    with pytest.raises(ValueError, match="expoente fracionário"):
        calculate_sheet(draft(("valor", "forca ** 0.5")), {"forca": -4})


@pytest.mark.parametrize("expression", [f"10 ** {MAX_POWER} + 1", f"10 ** {MAX_POWER} * 10", f"-(10 ** {MAX_POWER}) - 1"])
def test_result_beyond_limit_is_rejected(expression: str) -> None:
    with pytest.raises(ValueError, match="fora do limite permitido"):
        calculate_sheet(draft(("valor", expression)), {})


def test_huge_constant_is_rejected() -> None:
    with pytest.raises(ValueError, match="fora do limite permitido"):
        calculate_sheet(draft(("valor", str(MAX_ABS_RESULT + 1))), {})


@pytest.mark.parametrize("bad", [float("inf"), float("-inf"), float("nan"), float(MAX_ABS_RESULT * 10)])
def test_non_finite_or_huge_inputs_are_rejected(bad: float) -> None:
    with pytest.raises(ValueError, match="fora do limite permitido"):
        calculate_sheet(draft(("valor", "forca + 1")), {"forca": bad})


def test_chained_growth_hits_the_limit() -> None:
    template = draft(("um", "forca ** 12"), ("dois", "um * um"))
    with pytest.raises(ValueError, match="fora do limite permitido"):
        calculate_sheet(template, {"forca": 10})


def test_non_formula_fields_are_ignored_by_the_evaluator() -> None:
    template = draft(
        ("total", "forca * 2"),
        extra=[
            {"id": "nome", "label": "Nome", "kind": "text"},
            {"id": "teste", "label": "Teste", "kind": "roll", "expression": "2d6+1"},
        ],
    )
    result = calculate_sheet(template, {"forca": 2, "nome": "Lia"})
    assert result == {"forca": 2, "nome": "Lia", "total": 4}
