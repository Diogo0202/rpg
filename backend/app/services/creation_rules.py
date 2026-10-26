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


class GrantBand(BaseModel):
    """While the controlling number lies in [min, max], `add` joins the rule's base."""

    model_config = ConfigDict(extra="forbid")

    min: Annotated[int, Field(ge=-100, le=1000)]
    max: Annotated[int, Field(ge=-100, le=1000)]
    add: AddMap = Field(default_factory=dict, max_length=20)

    @model_validator(mode="after")
    def ordered(self) -> "GrantBand":
        if self.min > self.max:
            raise ValueError("a faixa precisa de mínimo até máximo")
        return self


class GrantBaseBy(BaseModel):
    """Base that follows a number field, such as V5 Blood Potency by generation; a value in no band is refused."""

    model_config = ConfigDict(extra="forbid")

    field: Annotated[str, Field(min_length=2, max_length=64)]
    bands: list[GrantBand] = Field(min_length=1, max_length=20)


class SelectGrants(BaseModel):
    """A select (clan, predator) grants dots and items; `fields` must equal base + grants at creation.

    Every select_grants rule is summed together, so a predator's discipline pick
    stacks on the clan's dots. Adds on fields no rule lists are not enforced.
    `base_by` adds the first band matching a number field to the base.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["select_grants"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    field: Annotated[str, Field(min_length=2, max_length=64)]
    fields: FieldIds = Field(min_length=1, max_length=100)
    base: AddMap = Field(default_factory=dict, max_length=100)
    base_by: GrantBaseBy | None = None
    cases: list[GrantCase] = Field(min_length=1, max_length=100)

    _ids = field_validator("fields")(_valid_ids)

    @model_validator(mode="after")
    def unique_cases(self) -> "SelectGrants":
        if len({item.equals for item in self.cases}) != len(self.cases):
            raise ValueError(f"{self.label}: cada caso precisa de um valor único")
        if self.base_by and any(field_id not in self.fields for band in self.base_by.bands for field_id in band.add):
            raise ValueError(f"{self.label}: as faixas só somam em campos da regra")
        return self


class CatalogEntry(BaseModel):
    """A mechanical name (no rules text) and the point values it may take."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, Field(min_length=1, max_length=80)]
    costs: list[Annotated[int, Field(ge=1, le=20)]] = Field(min_length=1, max_length=20)


class CollectionPoints(BaseModel):
    """Points in a collection's own items plus listed number fields must equal (or not exceed) `points`.

    An item is worth its "•" marks, or a trailing number such as "Aliados (2)". Items an
    active select_grants case or option grants (a predator's advantages) are extra and
    not counted. Used for V5's 7 points of Advantages and 2 of Flaws. With a `catalog`,
    each own item must name a listed entry ("Nome ••", "Nome: detalhe (2)") at one of its
    costs, unless the narrator sets `allow_homebrew` on the template.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["collection_points"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    collection: Annotated[str, Field(min_length=2, max_length=64)]
    fields: FieldIds = Field(default_factory=list, max_length=20)
    points: Annotated[int, Field(ge=0, le=100)]
    exact: bool = True
    catalog: list[CatalogEntry] = Field(default_factory=list, max_length=200)
    allow_homebrew: bool = False

    _ids = field_validator("fields")(_valid_ids)

    @model_validator(mode="after")
    def unique_catalog(self) -> "CollectionPoints":
        names = [item_name_key(entry.name) for entry in self.catalog]
        if len(names) != len(set(names)):
            raise ValueError(f"{self.label}: o catálogo repete um nome")
        return self


class RangeLimit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: Annotated[int, Field(ge=-1000, le=1000)]
    max: Annotated[int, Field(ge=-1000, le=1000)]

    @model_validator(mode="after")
    def ordered(self) -> "RangeLimit":
        if self.min > self.max:
            raise ValueError("o intervalo precisa de mínimo até máximo")
        return self


ExcludeMap = dict[Annotated[str, Field(min_length=2, max_length=64)], list[Annotated[str, Field(min_length=1, max_length=160)]]]


class SelectRangeDefault(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ranges: dict[Annotated[str, Field(min_length=2, max_length=64)], RangeLimit] = Field(default_factory=dict, max_length=20)
    exclude: ExcludeMap = Field(default_factory=dict, max_length=10)


class SelectRangeCase(SelectRangeDefault):
    equals: list[Annotated[str, Field(min_length=1, max_length=160)]] = Field(min_length=1, max_length=100)


class SelectRanges(BaseModel):
    """While a select holds a value, number fields stay in a range and other selects avoid listed values.

    The first case whose `equals` lists the value applies; any other non-empty value uses
    `default`. V5: thin-blooded only at 14th-16th generation, every other clan (homebrew
    included) in the starting generations the template allows. `fields` stays empty: the
    rule names its fields in `ranges`, so step filters keyed on `fields` leave it to the
    wizards' own checks.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["select_ranges"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    field: Annotated[str, Field(min_length=2, max_length=64)]
    fields: list[str] = Field(default_factory=list, max_length=0)
    cases: list[SelectRangeCase] = Field(default_factory=list, max_length=100)
    default: SelectRangeDefault | None = None

    @model_validator(mode="after")
    def unique_values(self) -> "SelectRanges":
        listed = [value for case in self.cases for value in case.equals]
        if len(listed) != len(set(listed)):
            raise ValueError(f"{self.label}: um valor aparece em mais de um caso")
        for case in self.all_cases():
            _valid_ids(list(case.ranges))
        return self

    def all_cases(self) -> list[SelectRangeDefault]:
        return [*self.cases, *([self.default] if self.default else [])]


class SpecialtySkill(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]


class SpecialtyPicks(BaseModel):
    """Free specialties "Habilidade (especialização)" in skills with dots.

    One for each `required` skill that has dots, plus `free` more in any skill with dots.
    Items an active select_grants case grants (the predator's specialty) are extra.
    `fields` stays empty for the same reason as in SelectRanges; the skills are in `skills`.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["specialty_picks"]
    id: Annotated[str, Field(min_length=2, max_length=64)]
    label: Annotated[str, Field(min_length=1, max_length=80)]
    collection: Annotated[str, Field(min_length=2, max_length=64)]
    skills: list[SpecialtySkill] = Field(min_length=1, max_length=100)
    required: FieldIds = Field(default_factory=list, max_length=100)
    free: Annotated[int, Field(ge=0, le=20)] = 1
    fields: list[str] = Field(default_factory=list, max_length=0)

    @model_validator(mode="after")
    def skills_listed(self) -> "SpecialtyPicks":
        ids = [skill.field for skill in self.skills]
        _valid_ids(ids)
        if len({skill.label.lower() for skill in self.skills}) != len(self.skills):
            raise ValueError(f"{self.label}: cada habilidade precisa de um rótulo único")
        if any(field_id not in ids for field_id in self.required):
            raise ValueError(f"{self.label}: as habilidades obrigatórias precisam estar na lista")
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


CreationRule = Annotated[Union[GroupDistribution, GroupSum, PointsBudget, SelectGrants, PowerPicks, PriorityPoints, CollectionPoints,
                               SelectRanges, SpecialtyPicks],
                         Field(discriminator="type")]


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


def _band(base_by: GrantBaseBy, values: dict[str, Any]) -> GrantBand | None:
    value = _number(values, base_by.field)
    return None if value is None else next((band for band in base_by.bands if band.min <= value <= band.max), None)


def _granted_items(rules: list[SelectGrants], values: dict[str, Any]) -> dict[str, set[str]]:
    """Items the selected cases and their allowed chosen options put in each collection."""
    granted: dict[str, set[str]] = {}
    for rule in rules:
        case = next((item for item in rule.cases if item.equals == values.get(rule.field)), None)
        if case is None:
            continue
        grants: list[GrantCase | GrantChoiceOption] = [case]
        for choice in case.choices:
            option = next((item for item in choice.options if item.label == values.get(choice.field)), None)
            if option is not None and _allowed(option, values):
                grants.append(option)
        for grant in grants:
            for collection, items in grant.items.items():
                granted.setdefault(collection, set()).update(items)
    return granted


# Same pattern in frontend/mobile creation-grants.ts and in SQL (20261026180000_v5_creation_points.sql).
_TRAILING_POINTS = re.compile(r"(?:^|[ (])([0-9]{1,2})\)? *$")


def item_points(item: str) -> int:
    """Worth of an item: "Aliados ••", "Aliados (2)" and "Aliados 2" are 2; an item with neither is 0."""
    dots = item.count("•")
    if dots:
        return dots
    match = _TRAILING_POINTS.search(item)
    return int(match.group(1)) if match else 0


# Same steps in frontend/mobile creation-checks.ts and private.creation_item_name (20261027150000_v5_creation_catalog.sql).
_DETAIL = re.compile(r"^(.+?) *\([^()]*\)$")
_SPACES = re.compile(r"\s+")


def item_name(item: str) -> str:
    """Name without points or detail: "Aliados: polícia ••", "Aliados (polícia) (2)" and "Aliados 2" are "Aliados"."""
    text = item.replace("•", "") if "•" in item else _TRAILING_POINTS.sub("", item)
    text = _SPACES.sub(" ", text).strip().split(":", 1)[0].strip()
    match = _DETAIL.match(text)
    return match.group(1).strip() if match else text


def item_name_key(item: str) -> str:
    return item_name(item).lower()


def _catalog_problem(rule: CollectionPoints, own: list[str]) -> str | None:
    if not rule.catalog:
        return None
    entries = {item_name_key(entry.name): entry for entry in rule.catalog}
    outside: list[str] = []
    for item in own:
        entry = entries.get(item_name_key(item))
        if entry is None:
            if not rule.allow_homebrew:
                outside.append(item)
            continue
        if item_points(item) not in entry.costs:
            allowed = ", ".join(str(cost) for cost in entry.costs)
            return f"{item} vale {item_points(item)}; {entry.name} aceita {allowed} {'ponto' if entry.costs == [1] else 'pontos'}"
    if outside:
        return f"{', '.join(outside)} fora do catálogo do modelo (o narrador pode liberar itens da casa no modelo)"
    return None


def _range_violation(rule: SelectRanges, values: dict[str, Any], labels: dict[str, str]) -> str | None:
    selected = values.get(rule.field)
    if not isinstance(selected, str) or not selected:
        return None
    case: SelectRangeDefault | None = next((item for item in rule.cases if selected in item.equals), None) or rule.default
    if case is None:
        return None
    problems: list[str] = []
    for field_id, limit in case.ranges.items():
        value = _number(values, field_id)
        if value is None or not limit.min <= value <= limit.max:
            problems.append(f"{labels.get(field_id, field_id)} deve ficar entre {limit.min} e {limit.max} para {selected}")
    for field_id, refused in case.exclude.items():
        other = values.get(field_id)
        if isinstance(other, str) and other in refused:
            problems.append(f"{labels.get(field_id, field_id)} {other} não combina com {selected}")
    return "; ".join(problems) or None


def _specialty_skill(rule: SpecialtyPicks, item: str) -> SpecialtySkill | None:
    text = item.strip()
    lowered = text.lower()
    for skill in rule.skills:
        prefix = f"{skill.label.lower()} ("
        if lowered.startswith(prefix) and text.endswith(")") and text[len(prefix):-1].strip():
            return skill
    return None


def _specialty_problem(rule: SpecialtyPicks, values: dict[str, Any], granted: dict[str, set[str]]) -> str | None:
    raw = values.get(rule.collection, [])
    if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
        return "a lista precisa conter textos"
    extra = granted.get(rule.collection, set())
    own = [item for item in raw if item not in extra]
    if len({item.strip().lower() for item in own}) != len(own):
        return "há especializações repetidas"
    picked: Counter[str] = Counter()
    for item in own:
        skill = _specialty_skill(rule, item)
        if skill is None:
            return f"{item} precisa seguir o formato Habilidade (especialização) com uma habilidade da lista"
        if (_number(values, skill.field) or 0) < 1:
            return f"{item} pede ao menos 1 ponto em {skill.label}"
        picked[skill.field] += 1
    labels = {skill.field: skill.label for skill in rule.skills}
    due = [field_id for field_id in rule.required if (_number(values, field_id) or 0) >= 1]
    missing = [labels[field_id] for field_id in due if not picked[field_id]]
    if missing:
        return f"falta especialização em {', '.join(missing)}"
    expected = len(due) + rule.free
    if len(own) != expected:
        return f"{len(own)} {'especialização' if len(own) == 1 else 'especializações'}, o esperado é {expected}"
    return None


def _collection_problem(rule: CollectionPoints, values: dict[str, Any], granted: dict[str, set[str]], labels: dict[str, str]) -> str | None:
    raw = values.get(rule.collection, [])
    if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
        return "a lista precisa conter textos"
    extra = granted.get(rule.collection, set())
    own = [item for item in raw if item not in extra]
    unpriced = [item for item in own if item_points(item) == 0]
    if unpriced:
        return f"indique os pontos de {', '.join(unpriced)} (•• ou (2))"
    catalog = _catalog_problem(rule, own)
    if catalog:
        return catalog
    numbers = [_number(values, field_id) for field_id in rule.fields]
    if any(number is None for number in numbers):
        return "preencha os campos numéricos"
    spent = sum(item_points(item) for item in own) + sum(number for number in numbers if number is not None)
    if (rule.exact and spent != rule.points) or spent > rule.points:
        counted = ", ".join(labels.get(field_id, field_id) for field_id in rule.fields)
        return f"{spent} de {rule.points} pontos" + (f" (inclui {counted})" if counted else "")
    return None


def _grant_violations(rules: list[SelectGrants], values: dict[str, Any], labels: dict[str, str]) -> list[Violation]:
    """All select_grants rules together: enforced fields equal base plus every active grant."""
    expected: Counter[str] = Counter()
    problems: dict[str, list[str]] = {}
    for rule in rules:
        for field_id in rule.fields:
            expected[field_id] += rule.base.get(field_id, 0)
        if rule.base_by:
            band = _band(rule.base_by, values)
            if band is None:
                bounds = f"{min(item.min for item in rule.base_by.bands)} a {max(item.max for item in rule.base_by.bands)}"
                problems.setdefault(rule.id, []).append(f"{labels.get(rule.base_by.field, rule.base_by.field)} fora das faixas de criação ({bounds})")
            else:
                for field_id, amount in band.add.items():
                    expected[field_id] += amount
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
    grant_rules = [rule for rule in rules if isinstance(rule, SelectGrants)]
    violations: list[Violation] = _grant_violations(grant_rules, values, labels)
    granted = _granted_items(grant_rules, values)
    for rule in rules:
        if isinstance(rule, SelectGrants):
            continue
        if isinstance(rule, CollectionPoints):
            problem = _collection_problem(rule, values, granted, labels)
            if problem:
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=[rule.collection, *rule.fields], message=f"{rule.label}: {problem}"))
            continue
        if isinstance(rule, PowerPicks):
            problem = _power_violation(rule, values)
            if problem:
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=[rule.collection], message=f"{rule.label}: {problem}"))
            continue
        if isinstance(rule, SelectRanges):
            problem = _range_violation(rule, values, labels)
            if problem:
                ranged = list(dict.fromkeys(field_id for case in rule.all_cases() for field_id in case.ranges))
                violations.append(Violation(rule_id=rule.id, label=rule.label, fields=[rule.field, *ranged], message=f"{rule.label}: {problem}"))
            continue
        if isinstance(rule, SpecialtyPicks):
            problem = _specialty_problem(rule, values, granted)
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
