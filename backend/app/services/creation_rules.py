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


AddMap = dict[Annotated[str, Field(min_length=2, max_length=64)], Annotated[int, Field(ge=-100, le=100)]]
ItemMap = dict[Annotated[str, Field(min_length=2, max_length=64)], list[Annotated[str, Field(min_length=1, max_length=160)]]]


class GrantChoiceOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: Annotated[str, Field(min_length=1, max_length=160)]
    add: AddMap = Field(default_factory=dict, max_length=50)
    items: ItemMap = Field(default_factory=dict, max_length=10)
    # {"field": select id, "in": [allowed values]}; a dict because "in" is a Python keyword.
    requires: dict[str, Any] | None = None

    @field_validator("requires")
    @classmethod
    def requirement_shape(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return value
        allowed = value.get("in")
        if set(value) != {"field", "in"} or not isinstance(value["field"], str) or not isinstance(allowed, list) \
                or not allowed or len(allowed) > 100 or not all(isinstance(item, str) for item in allowed):
            raise ValueError("requisito da opção precisa de field e in")
        return value


class GrantChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    options: list[GrantChoiceOption] = Field(min_length=1, max_length=100)


class GrantCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    equals: Annotated[str, Field(min_length=1, max_length=160)]
    add: AddMap = Field(default_factory=dict, max_length=50)
    items: ItemMap = Field(default_factory=dict, max_length=10)
    choices: list[GrantChoice] = Field(default_factory=list, max_length=10)
    homebrew: bool = False


class SelectGrants(BaseModel):
    """A select (clan, predator) grants dots and items; `fields` must equal base + grants at creation.

    Every select_grants rule is summed together, so a predator's discipline pick
    stacks on the clan's dots. Adds on fields no rule lists are not enforced.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["select_grants"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    field: Annotated[str, Field(min_length=2, max_length=64)]
    fields: FieldIds = Field(min_length=1, max_length=100)
    base: AddMap = Field(default_factory=dict, max_length=100)
    cases: list[GrantCase] = Field(min_length=1, max_length=100)

    _ids = field_validator("fields")(_valid_ids)

    @model_validator(mode="after")
    def unique_cases(self) -> "SelectGrants":
        if len({item.equals for item in self.cases}) != len(self.cases):
            raise ValueError(f"{self.label}: cada caso precisa de um valor único")
        return self


class PowerEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=80)]
    level: Annotated[int, Field(ge=1, le=10)]
    requires: dict[str, Any] | None = None

    @field_validator("requires")
    @classmethod
    def requirement_shape(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return value
        if set(value) != {"field", "min"} or not isinstance(value["field"], str) or isinstance(value["min"], bool) \
                or not isinstance(value["min"], int):
            raise ValueError("requisito de poder precisa de field e min")
        return value


class PowerSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=60, pattern=r"^[^:]+$")]
    powers: list[PowerEntry] = Field(default_factory=list, max_length=200)
    count: Literal["dots"] | Annotated[int, Field(ge=0, le=20)] = "dots"
    max_level: Literal["dots"] | Annotated[int, Field(ge=0, le=10)] = "dots"


class PowerPicks(BaseModel):
    """A collection holds "<source label>: <power>" picks from locked lists, `count` per source."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["power_picks"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    collection: Annotated[str, Field(min_length=2, max_length=64)]
    fields: FieldIds = Field(min_length=1, max_length=100)
    sources: list[PowerSource] = Field(min_length=1, max_length=50)

    _ids = field_validator("fields")(_valid_ids)

    @model_validator(mode="after")
    def sources_in_fields(self) -> "PowerPicks":
        labels = [source.label for source in self.sources]
        if len(labels) != len(set(labels)):
            raise ValueError(f"{self.label}: cada fonte de poderes precisa de um rótulo único")
        missing = [source.field for source in self.sources if source.field not in self.fields]
        if missing:
            raise ValueError(f"{self.label}: fontes fora da lista de campos: {', '.join(missing)}")
        return self


class PriorityGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: Annotated[str, Field(min_length=1, max_length=80)]
    fields: FieldIds = Field(min_length=1, max_length=100)

    _ids = field_validator("fields")(_valid_ids)


class PriorityAllowed(BaseModel):
    """Only the listed fields may rise above their base for the value a select holds; the rest stay at base."""

    model_config = ConfigDict(extra="forbid")

    field: Annotated[str, Field(min_length=2, max_length=64)]
    cases: dict[Annotated[str, Field(min_length=1, max_length=160)], FieldIds] = Field(min_length=1, max_length=100)


class PriorityPool(BaseModel):
    """Points spent above `base` (plus the sum of `base_from`) per group; `budgets[i]` is a group's free allotment."""

    model_config = ConfigDict(extra="forbid")

    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    base: Annotated[int, Field(ge=-100, le=100)] = 0
    base_from: FieldIds = Field(default_factory=list, max_length=10)
    base_from_highest: FieldIds = Field(default_factory=list, max_length=10)
    highest_count: Annotated[int, Field(ge=0, le=10)] = 0
    cost: Annotated[int, Field(ge=0, le=100)]
    budgets: list[Annotated[int, Field(ge=0, le=1000)]] = Field(min_length=1, max_length=4)
    groups: list[PriorityGroup] = Field(min_length=1, max_length=4)
    allowed: PriorityAllowed | None = None

    _ids = field_validator("base_from", "base_from_highest")(_valid_ids)

    @model_validator(mode="after")
    def shape(self) -> "PriorityPool":
        if self.highest_count > len(self.base_from_highest):
            raise ValueError(f"{self.label}: highest_count excede os campos de origem")
        if bool(self.base_from_highest) != bool(self.highest_count):
            raise ValueError(f"{self.label}: base_from_highest pede highest_count")
        if len(self.budgets) != len(self.groups):
            raise ValueError(f"{self.label}: cada grupo precisa de um orçamento")
        listed = [field_id for group in self.groups for field_id in group.fields]
        if len(listed) != len(set(listed)):
            raise ValueError(f"{self.label}: um campo aparece em mais de um grupo")
        if self.allowed and any(field_id not in listed for fields in self.allowed.cases.values() for field_id in fields):
            raise ValueError(f"{self.label}: a lista de permitidos cita campos fora dos grupos")
        return self


class PriorityPoints(BaseModel):
    """Priority-based creation: each pool's groups get free budgets (any order) and the rest is bought with freebies.

    Total freebies spent = sum over pools of (points spent - sum of budgets) x cost, which does not depend on how
    budgets are matched to groups; a match exists when the groups' spending, sorted, covers the sorted budgets.
    `fields` is derived (every pool field and base_from field) so the generic rule plumbing keeps working.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["priority_points"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    freebies: Annotated[int, Field(ge=0, le=1000)]
    exact: bool = True
    pools: list[PriorityPool] = Field(min_length=1, max_length=10)
    fields: FieldIds = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def derive_fields(self) -> "PriorityPoints":
        pool_ids = [pool.id for pool in self.pools]
        if len(pool_ids) != len(set(pool_ids)):
            raise ValueError(f"{self.label}: cada pool precisa de um id único")
        listed = [field_id for pool in self.pools for group in pool.groups for field_id in group.fields]
        if len(listed) != len(set(listed)):
            raise ValueError(f"{self.label}: um campo aparece em mais de um pool")
        every = list(dict.fromkeys([*listed, *(field_id for pool in self.pools for field_id in [*pool.base_from, *pool.base_from_highest])]))
        if len(every) > 100:
            raise ValueError(f"{self.label}: a regra cita campos demais")
        self.fields = every
        return self


CreationRule = Annotated[Union[GroupDistribution, GroupSum, PointsBudget, SelectGrants, PowerPicks, PriorityPoints], Field(discriminator="type")]


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


def _strings(value: Any) -> list[str]:
    return [item for item in value if isinstance(item, str)] if isinstance(value, list) else []


def _allowed(option: GrantChoiceOption, values: dict[str, Any]) -> bool:
    return option.requires is None or values.get(option.requires["field"]) in option.requires["in"]


def _grant_violations(rules: list[SelectGrants], values: dict[str, Any], labels: dict[str, str]) -> list[Violation]:
    """All select_grants rules together: enforced fields equal base plus every active grant."""
    expected: Counter[str] = Counter()
    problems: dict[str, list[str]] = {}
    for rule in rules:
        for field_id in rule.fields:
            expected[field_id] += rule.base.get(field_id, 0)
    for rule in rules:
        selected = values.get(rule.field)
        case = next((item for item in rule.cases if item.equals == selected), None)
        if case is None:
            continue
        grants: list[GrantCase | GrantChoiceOption] = [case]
        for choice in case.choices:
            option = next((item for item in choice.options if item.label == values.get(choice.field)), None)
            if option is None or not _allowed(option, values):
                problems.setdefault(rule.id, []).append(f"escolha {choice.label.lower()}")
                continue
            grants.append(option)
        for grant in grants:
            for field_id, amount in grant.add.items():
                expected[field_id] += amount
            for collection, items in grant.items.items():
                present = _strings(values.get(collection))
                for item in items:
                    if item not in present:
                        problems.setdefault(rule.id, []).append(f"falta {item} em {labels.get(collection, collection)}")
    for rule in rules:
        for field_id in rule.fields:
            actual = _number(values, field_id)
            if actual is None or actual != expected[field_id]:
                problems.setdefault(rule.id, []).append(f"{labels.get(field_id, field_id)} deve ser {expected[field_id]}")
    by_id = {rule.id: rule for rule in rules}
    return [
        Violation(rule_id=rule_id, label=by_id[rule_id].label, fields=[by_id[rule_id].field, *by_id[rule_id].fields],
                  message=f"{by_id[rule_id].label}: {'; '.join(dict.fromkeys(messages))}")
        for rule_id, messages in problems.items()
    ]


def _power_limit(value: Literal["dots"] | int, dots: int | float) -> int | float:
    return dots if value == "dots" else (value if dots > 0 else 0)


def _power_violation(rule: PowerPicks, values: dict[str, Any]) -> str | None:
    raw = values.get(rule.collection, [])
    if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
        return "a lista precisa conter textos"
    if len(raw) != len(set(raw)):
        return "há poderes repetidos"
    counts: Counter[str] = Counter()
    for item in raw:
        source = next((candidate for candidate in rule.sources if item.startswith(f"{candidate.label}: ")), None)
        name = item[len(source.label) + 2:] if source else None
        power = next((candidate for candidate in source.powers if candidate.name == name), None) if source else None
        if source is None or power is None:
            return f"{item} não está na lista do modelo"
        dots = _number(values, source.field) or 0
        if power.level > _power_limit(source.max_level, dots):
            return f"{item} pede nível {power.level}"
        if power.requires and (_number(values, power.requires["field"]) or 0) < power.requires["min"]:
            return f"{item} pede outra disciplina"
        counts[source.label] += 1
    for source in rule.sources:
        allowed = _power_limit(source.count, _number(values, source.field) or 0)
        if counts[source.label] != allowed:
            return f"{source.label} pede {allowed} {'escolha' if allowed == 1 else 'escolhas'}, há {counts[source.label]}"
    return None


def _priority_problems(rule: PriorityPoints, values: dict[str, Any], labels: dict[str, str]) -> list[str]:
    problems: list[str] = []
    bonus = 0
    for pool in rule.pools:
        highest = sorted((_number(values, field_id) or 0 for field_id in pool.base_from_highest), reverse=True)
        base = pool.base + sum(_number(values, field_id) or 0 for field_id in pool.base_from) + sum(highest[:pool.highest_count])
        permitted: set[str] | None = None
        if pool.allowed:
            selected = values.get(pool.allowed.field)
            permitted = set(pool.allowed.cases.get(selected, [])) if isinstance(selected, str) else set()
        spent: list[int | float] = []
        for group in pool.groups:
            total = 0
            for field_id in group.fields:
                value = _number(values, field_id) or 0
                if value != int(value):
                    problems.append(f"{labels.get(field_id, field_id)} precisa ser inteiro")
                    continue
                if value < base:
                    problems.append(f"{labels.get(field_id, field_id)} fica abaixo de {base}")
                elif permitted is not None and field_id not in permitted and value != base:
                    problems.append(f"{labels.get(field_id, field_id)} não está disponível para esta escolha")
                total += value - base
            spent.append(total)
        # Clamped for readable messages: a pool short of its budgets has bought nothing, and the shortfall is
        # reported on its own. A valid sheet has no shortfall, so this equals the unclamped sum the database uses.
        bonus += max(0, sum(spent) - sum(pool.budgets)) * pool.cost
        # A match of budgets to groups exists exactly when the sorted spending covers the sorted budgets.
        shortfalls = sum(max(0, need - have) for have, need in zip(sorted(spent, reverse=True), sorted(pool.budgets, reverse=True)))
        if shortfalls:
            problems.append(f"{pool.label}: faltam {shortfalls} {'ponto' if shortfalls == 1 else 'pontos'} da distribuição inicial")
    if rule.exact and bonus != rule.freebies:
        problems.append(f"bônus gastos {bonus} de {rule.freebies}" + (f" (restam {rule.freebies - bonus})" if bonus < rule.freebies else ""))
    elif not rule.exact and bonus > rule.freebies:
        problems.append(f"bônus gastos {bonus}, o limite é {rule.freebies}")
    return list(dict.fromkeys(problems))


def evaluate_creation_rules(rules: list[CreationRule], values: dict[str, Any], labels: dict[str, str] | None = None) -> list[Violation]:
    """Returns every violated rule; an empty list means the sheet may be created."""
    labels = labels or {}
    violations: list[Violation] = _grant_violations([rule for rule in rules if isinstance(rule, SelectGrants)], values, labels)
    for rule in rules:
        if isinstance(rule, SelectGrants):
            continue
        if isinstance(rule, PowerPicks):
            problem = _power_violation(rule, values)
            if problem:
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=[rule.collection], message=f"{rule.label}: {problem}"))
            continue
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
        elif isinstance(rule, PriorityPoints):
            problems = _priority_problems(rule, values, labels)
            if problems:
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=rule.fields,
                                            message=f"{rule.label}: {'; '.join(problems)}"))
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
