"""Declarative character-creation rules.

Templates describe creation constraints as numbers only (no rules text), so
any system can be expressed: V5 attribute and skill distributions, a D&D
point-buy, a sum cap. The same rules run in private.validate_creation_rules
for writes that bypass this API (PostgREST, mobile sync).
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Same shape as app.models.FIELD_ID; kept here so models can import these rules.
FIELD_ID = re.compile(r"^[a-z][a-z0-9_]{1,63}$")

FieldIds = list[Annotated[str, Field(min_length=2, max_length=64)]]


def _valid_ids(value: list[str]) -> list[str]:
    if len(value) != len(set(value)):
        raise ValueError("a regra repete um campo")
    for field_id in value:
        if not FIELD_ID.fullmatch(field_id):
            raise ValueError(f"campo inválido na regra: {field_id}")
    return value


class Distribution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: Annotated[str, Field(min_length=1, max_length=80)]
    # Value -> how many fields must hold exactly that value; every other field holds `rest`.
    counts: dict[str, Annotated[int, Field(ge=0, le=200)]] = Field(min_length=1, max_length=20)
    rest: Annotated[int, Field(ge=-100, le=100)] = 0

    @field_validator("counts")
    @classmethod
    def integer_keys(cls, value: dict[str, int]) -> dict[str, int]:
        for key in value:
            try:
                int(key)
            except ValueError as error:
                raise ValueError("as chaves da distribuição precisam ser números inteiros") from error
        return value


class GroupDistribution(BaseModel):
    """The fields must match one of the listed distributions exactly."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["group_distribution"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    fields: FieldIds = Field(min_length=1, max_length=100)
    options: list[Distribution] = Field(min_length=1, max_length=10)

    _ids = field_validator("fields")(_valid_ids)

    @model_validator(mode="after")
    def fits(self) -> "GroupDistribution":
        for option in self.options:
            if sum(option.counts.values()) > len(self.fields):
                raise ValueError(f"a distribuição {option.label} pede mais campos do que o grupo tem")
        return self


class GroupSum(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["group_sum"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    fields: FieldIds = Field(min_length=1, max_length=100)
    min: int | None = None
    max: int | None = None

    _ids = field_validator("fields")(_valid_ids)

    @model_validator(mode="after")
    def bounded(self) -> "GroupSum":
        if self.min is None and self.max is None:
            raise ValueError("a soma precisa de mínimo ou máximo")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("o mínimo da soma passa do máximo")
        return self


class PointsBudget(BaseModel):
    """Each field value has a cost; the total must equal (or not exceed) the budget."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["points_budget"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    fields: FieldIds = Field(min_length=1, max_length=100)
    costs: dict[str, Annotated[int, Field(ge=0, le=1000)]] = Field(min_length=1, max_length=50)
    budget: Annotated[int, Field(ge=0, le=10000)]
    exact: bool = True

    _ids = field_validator("fields")(_valid_ids)

    @field_validator("costs")
    @classmethod
    def integer_keys(cls, value: dict[str, int]) -> dict[str, int]:
        return Distribution.integer_keys(value)


CreationRule = Annotated[Union[GroupDistribution, GroupSum, PointsBudget], Field(discriminator="type")]


class Violation(BaseModel):
    rule_id: str
    label: str
    message: str
    fields: list[str]


def _number(values: dict[str, Any], field_id: str, rest: int = 0) -> int | float | None:
    value = values.get(field_id, rest)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _distribution_matches(values: list[int | float], option: Distribution) -> bool:
    expected: Counter[int] = Counter()
    for key, count in option.counts.items():
        expected[int(key)] += count
    listed = sum(expected.values())
    expected[option.rest] += len(values) - listed
    return Counter(values) == expected


def _describe(option: Distribution) -> str:
    parts = [f"{count}× {value}" for value, count in sorted(option.counts.items(), key=lambda item: -int(item[0])) if count]
    return f"{option.label}: {', '.join(parts)}; demais em {option.rest}"


def evaluate_creation_rules(rules: list[CreationRule], values: dict[str, Any]) -> list[Violation]:
    """Returns every violated rule; an empty list means the sheet may be created."""
    violations: list[Violation] = []
    for rule in rules:
        numbers = [_number(values, field_id) for field_id in rule.fields]
        if any(number is None for number in numbers):
            violations.append(Violation(rule_id=rule.id, label=rule.label, fields=rule.fields,
                                        message=f"{rule.label}: preencha todos os campos com números"))
            continue
        present = [number for number in numbers if number is not None]
        if isinstance(rule, GroupDistribution):
            if not any(_distribution_matches(present, option) for option in rule.options):
                expected = " ou ".join(_describe(option) for option in rule.options)
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=rule.fields,
                                            message=f"{rule.label} não segue a distribuição ({expected})"))
        elif isinstance(rule, GroupSum):
            total = sum(present)
            if (rule.min is not None and total < rule.min) or (rule.max is not None and total > rule.max):
                bounds = f"entre {rule.min} e {rule.max}" if rule.min is not None and rule.max is not None \
                    else f"no mínimo {rule.min}" if rule.min is not None else f"no máximo {rule.max}"
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=rule.fields,
                                            message=f"{rule.label}: soma {total}, precisa ser {bounds}"))
        else:
            costs = {int(key): cost for key, cost in rule.costs.items()}
            outside = [field_id for field_id, number in zip(rule.fields, present) if int(number) != number or int(number) not in costs]
            if outside:
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=outside,
                                            message=f"{rule.label}: valor fora da tabela de custos em {', '.join(outside)}"))
                continue
            spent = sum(costs[int(number)] for number in present)
            if (rule.exact and spent != rule.budget) or spent > rule.budget:
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=rule.fields,
                                            message=f"{rule.label}: {spent} de {rule.budget} pontos gastos"))
    return violations
