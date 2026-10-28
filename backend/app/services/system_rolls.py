from __future__ import annotations

import secrets
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator

from app.services import hunter_traits as hunter_traits_service
from app.services import one_ring
from app.services.session_roll_activity import RollChronicleContext


# Hunter: regras de dados consultadas no infográfico oficial de mecânicas básicas
# (Paradox Interactive, sem paginação):
# https://www.paradoxinteractive.com/games/world-of-darkness/news/hunter-the-reckoning-basic-mechanics
# O dado de Desespero é adicional e opcional quando o teste corresponde ao Credo.
# O 1 em Desespero conduz a Despair ou Overreach conforme sucesso e escolha da mesa.
# Outros efeitos do manual completo ficam pendentes de consulta à fonte primária.
class HunterRollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_pool: StrictInt = Field(ge=1, le=30)
    difficulty: StrictInt = Field(ge=1, le=69)
    desperation: StrictInt = Field(default=0, ge=0, le=5)
    use_desperation: StrictBool = False
    chronicle: RollChronicleContext | None = None


class HunterRollResponse(BaseModel):
    base_pool: int
    total_pool: int
    normal_dice: list[int]
    desperation_dice: list[int]
    desperation_ones: int
    successes: int
    difficulty: int
    success: bool
    critical_pairs: int
    critical: bool
    desperation_consequence: str | None
    verdict: str


def roll_hunter(payload: HunterRollRequest) -> HunterRollResponse:
    desperation_count = payload.desperation if payload.use_desperation else 0
    normal_dice = [secrets.randbelow(10) + 1 for _ in range(payload.base_pool)]
    desperation_dice = [secrets.randbelow(10) + 1 for _ in range(desperation_count)]
    all_dice = [*normal_dice, *desperation_dice]
    tens = all_dice.count(10)
    critical_pairs = tens // 2
    successes = sum(value >= 6 for value in all_dice) + 2 * critical_pairs
    success = successes >= payload.difficulty
    desperation_ones = desperation_dice.count(1)
    consequence = "despair" if desperation_ones and not success else "table_choice" if desperation_ones else None
    critical = success and critical_pairs > 0
    verdict = "Crítico" if critical else "Êxito" if success else "Falha"
    return HunterRollResponse(
        base_pool=payload.base_pool,
        total_pool=payload.base_pool + desperation_count,
        normal_dice=normal_dice,
        desperation_dice=desperation_dice,
        desperation_ones=desperation_ones,
        successes=successes,
        difficulty=payload.difficulty,
        success=success,
        critical_pairs=critical_pairs,
        critical=critical,
        desperation_consequence=consequence,
        verdict=verdict,
    )


# O Um Anel 2ª edição. A errata oficial confirma a Runa de Gandalf no resultado 12:
# https://freeleaguepublishing.com/wp-content/uploads/2023/09/TOR_Core_Rules_Errata_2204.pdf
# Mecânica aplicada (números e estados marcados para conferência no Core Rules,
# listados em docs/UM_ANEL_FICHA.md):
# - Dado de Feito d12: 1 a 10 somam o valor; 11 é o Olho de Sauron e vale 0; 12 é a Runa
#   de Gandalf e dá sucesso automático. Favorecido rola dois e fica com o melhor;
#   desfavorecido, com o pior (Runa é o melhor, Olho o pior).
# - Dados de Sucesso d6, um por nível de perícia; cada 6 é um ícone, contado só no sucesso.
# - Cansado: Vigor atual <= Carga (já somado o Cansaço). Dados de Sucesso 1 a 3 valem 0.
# - Miserável: Sombra + Cicatrizes >= Esperança atual. O Olho de Sauron no dado de Feito é
#   falha automática, mesmo que o total alcance o TN. Fora desse estado o Olho só vale 0.
# - Ferido: não muda os dados; a resposta lembra que outro ferimento deixa o herói morrendo.
class OneRingRollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: StrictInt = Field(ge=1, le=99)
    skill_dice: StrictInt = Field(ge=0, le=6)
    endurance: StrictInt = Field(ge=0, le=40)
    load: StrictInt = Field(ge=0, le=80)
    favored: StrictBool = False
    ill_favored: StrictBool = False
    miserable: StrictBool = False
    wounded: StrictBool = False
    # When both come from the sheet, Miserable is also derived: shadow (points + scars) >= hope.
    hope: StrictInt | None = Field(default=None, ge=0, le=40)
    shadow: StrictInt | None = Field(default=None, ge=0, le=40)
    chronicle: RollChronicleContext | None = None

    @model_validator(mode="after")
    def validate_favor(self) -> OneRingRollRequest:
        if self.favored and self.ill_favored:
            raise ValueError("uma rolagem não pode ser favorecida e desfavorecida ao mesmo tempo")
        return self

    def is_miserable(self) -> bool:
        return self.miserable or (self.hope is not None and self.shadow is not None and self.shadow >= self.hope)


class OneRingRollResponse(BaseModel):
    target: int
    feat_dice: list[int]
    feat_die: int
    success_dice: list[int]
    counted_success_dice: list[int]
    total: int
    weary: bool
    miserable: bool = False
    wounded: bool = False
    automatic_success: bool
    automatic_failure: bool = False
    eye_of_sauron: bool
    success_icons: int
    success: bool
    notes: list[str] = Field(default_factory=list)


def _feat_rank(value: int) -> int:
    # TOR 2e: Gandalf rune (12) is best, Eye of Sauron (11) is worst.
    return 13 if value == 12 else 0 if value == 11 else value


def _feat_roll(favored: bool, ill_favored: bool) -> tuple[list[int], int]:
    feat_dice = [secrets.randbelow(12) + 1 for _ in range(2 if favored or ill_favored else 1)]
    if favored:
        return feat_dice, max(feat_dice, key=_feat_rank)
    if ill_favored:
        return feat_dice, min(feat_dice, key=_feat_rank)
    return feat_dice, feat_dice[0]


def roll_one_ring(payload: OneRingRollRequest) -> OneRingRollResponse:
    feat_dice, feat_die = _feat_roll(bool(payload.favored), bool(payload.ill_favored))
    success_dice = [secrets.randbelow(6) + 1 for _ in range(payload.skill_dice)]
    weary = payload.endurance <= payload.load
    miserable = payload.is_miserable()
    counted_dice = [0 if weary and value <= 3 else value for value in success_dice]
    automatic_success = feat_die == 12
    eye_of_sauron = feat_die == 11
    automatic_failure = eye_of_sauron and miserable
    feat_value = 0 if eye_of_sauron or automatic_success else feat_die
    total = feat_value + sum(counted_dice)
    success = automatic_success or (not automatic_failure and total >= payload.target)
    notes: list[str] = []
    if weary:
        notes.append("Cansado: dados de Sucesso de 1 a 3 valem 0")
    if automatic_failure:
        notes.append("Miserável: o Olho de Sauron é falha automática")
    elif miserable:
        notes.append("Miserável: um Olho de Sauron seria falha automática")
    if payload.wounded:
        notes.append("Ferido: outro ferimento deixa o herói morrendo")
    return OneRingRollResponse(
        target=payload.target,
        feat_dice=feat_dice,
        feat_die=feat_die,
        success_dice=success_dice,
        counted_success_dice=counted_dice,
        total=total,
        weary=weary,
        miserable=miserable,
        wounded=payload.wounded,
        automatic_success=automatic_success,
        automatic_failure=automatic_failure,
        eye_of_sauron=eye_of_sauron,
        success_icons=sum(1 for die in counted_dice if die == 6) if success else 0,
        success=success,
        notes=notes,
    )


# Teste de Sombra: Pavor usa Valor; Ganância e Feitiçaria usam Sabedoria (conferir). O TN vem
# da mesa. Sucesso evita os pontos; falha soma todos à Sombra (recorte marcado para conferência).
class OneRingShadowTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal["pavor", "ganancia", "feiticaria"]
    points: StrictInt = Field(ge=1, le=10)
    target: StrictInt = Field(ge=1, le=99)
    rating: StrictInt = Field(ge=0, le=6)
    endurance: StrictInt = Field(ge=0, le=40)
    load: StrictInt = Field(ge=0, le=80)
    hope: StrictInt = Field(ge=0, le=40)
    shadow: StrictInt = Field(ge=0, le=40)
    favored: StrictBool = False
    ill_favored: StrictBool = False

    @model_validator(mode="after")
    def validate_favor(self) -> OneRingShadowTestRequest:
        if self.favored and self.ill_favored:
            raise ValueError("uma rolagem não pode ser favorecida e desfavorecida ao mesmo tempo")
        return self


class OneRingShadowTestResponse(BaseModel):
    source: str
    trait: str
    roll: OneRingRollResponse
    shadow_gained: int
    shadow_after: int
    miserable_after: bool


def roll_one_ring_shadow_test(payload: OneRingShadowTestRequest) -> OneRingShadowTestResponse:
    roll = roll_one_ring(OneRingRollRequest(
        target=payload.target, skill_dice=payload.rating, endurance=payload.endurance, load=payload.load,
        favored=payload.favored, ill_favored=payload.ill_favored, hope=payload.hope, shadow=payload.shadow,
    ))
    gained = 0 if roll.success else payload.points
    after = payload.shadow + gained
    return OneRingShadowTestResponse(
        source=payload.source,
        trait="valor" if payload.source == "pavor" else "sabedoria",
        roll=roll,
        shadow_gained=gained,
        shadow_after=after,
        miserable_after=after >= payload.hope,
    )


# Eventos de jornada: o dado de Feito escolhe o tipo de evento (Fronteira favorecido, Selvagem
# normal, Sombria desfavorecido) e um d6 escolhe o papel testado. Cansaço, consequências e a
# tabela de papéis são um resumo próprio, sem texto do livro, e ficam marcados para conferência.
JourneyRegion = Literal["fronteira", "selvagem", "sombria"]
_JOURNEY_EVENTS: list[tuple[range, str, str, int, str, str]] = [
    (range(0, 1), "infortunio_terrivel", "Infortúnio terrível", 3, "Evita o ferimento", "O alvo fica Ferido"),
    (range(1, 2), "desespero", "Desespero", 2, "Sem efeito extra", "+2 pontos de Sombra (Pavor)"),
    (range(2, 4), "mas_escolhas", "Más escolhas", 2, "Sem efeito extra", "+1 ponto de Sombra"),
    (range(4, 8), "contratempo", "Contratempo", 2, "Sem efeito extra", "+1 dia de viagem e +1 de Cansaço"),
    (range(8, 10), "atalho", "Atalho", 1, "-1 dia de viagem", "Sem efeito extra"),
    (range(10, 11), "encontro_casual", "Encontro casual", 1, "Não ganha o Cansaço deste evento", "Sem efeito extra"),
    (range(13, 14), "visao_alegre", "Visão alegre", 0, "+1 de Esperança", "Sem efeito extra"),
]
_JOURNEY_ROLES = {1: ("guia", "Guia", "travel"), 2: ("guia", "Guia", "travel"), 3: ("batedor", "Batedor", "explore"),
                  4: ("cacador", "Caçador", "hunting"), 5: ("vigia", "Vigia", "awareness"), 6: ("vigia", "Vigia", "awareness")}


class JourneyEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    region: JourneyRegion


class JourneyEventResponse(BaseModel):
    region: str
    favored: bool
    ill_favored: bool
    feat_dice: list[int]
    feat_die: int
    role_die: int
    event: str
    label: str
    fatigue: int
    role: str
    role_label: str
    skill: str
    on_success: str
    on_failure: str


def roll_journey_event(payload: JourneyEventRequest) -> JourneyEventResponse:
    favored = payload.region == "fronteira"
    ill_favored = payload.region == "sombria"
    feat_dice, feat_die = _feat_roll(favored, ill_favored)
    rank = _feat_rank(feat_die)
    _, key, label, fatigue, on_success, on_failure = next(item for item in _JOURNEY_EVENTS if rank in item[0])
    role_die = secrets.randbelow(6) + 1
    role, role_label, skill = _JOURNEY_ROLES[role_die]
    return JourneyEventResponse(
        region=payload.region, favored=favored, ill_favored=ill_favored, feat_dice=feat_dice, feat_die=feat_die,
        role_die=role_die, event=key, label=label, fatigue=fatigue, role=role, role_label=role_label, skill=skill,
        on_success=on_success, on_failure=on_failure,
    )


SheetValues = dict[Annotated[str, Field(min_length=1, max_length=64)], Any]


class SheetValuesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    values: SheetValues = Field(max_length=200)
    migrate: StrictBool = False


class OneRingSheetResponse(BaseModel):
    values: dict[str, Any]
    derived: dict[str, int]
    states: dict[str, bool]
    problems: list[str]
    warnings: list[str]


def one_ring_sheet(payload: SheetValuesRequest) -> OneRingSheetResponse:
    values, warnings = one_ring.migrate_one_ring(payload.values) if payload.migrate else (dict(payload.values), [])
    return OneRingSheetResponse(values=values, derived=one_ring.derived(values), states=one_ring.states(values),
                                problems=one_ring.problems(values), warnings=warnings)


class HunterTraitsResponse(BaseModel):
    values: dict[str, Any]
    problems: list[str]
    warnings: list[str]


def hunter_traits(payload: SheetValuesRequest) -> HunterTraitsResponse:
    values, warnings = hunter_traits_service.migrate_hunter_traits(payload.values) if payload.migrate \
        else (dict(payload.values), [])
    return HunterTraitsResponse(values=values, problems=hunter_traits_service.hunter_trait_problems(values), warnings=warnings)


# Shadow of the Demon Lord: resumo de regras da campanha Trench Crusade
# (D:\megabrain\Atlas_RPG\historias\Trench_Crusade\manual_de_regras_shadow_of_the_demon_lord_*.md).
# d20 + (atributo - 10) contra 10 ou a Defesa; dádivas e perdições se anulam 1 a 1 e as que
# sobram rolam d6, valendo só o maior. O crítico (total 20+ e 5 acima do alvo) e o teste de
# destino seguem o livro e ficam marcados para conferência em docs/SOTDL_CRIACAO_GUIADA.md.
class SotdlRollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attribute: StrictInt = Field(ge=1, le=20)
    boons: StrictInt = Field(default=0, ge=0, le=10)
    banes: StrictInt = Field(default=0, ge=0, le=10)
    target: StrictInt = Field(default=10, ge=1, le=40)
    chronicle: RollChronicleContext | None = None


class SotdlRollResponse(BaseModel):
    attribute: int
    modifier: int
    d20: int
    net_boons: int
    boon_dice: list[int]
    boon_value: int
    total: int
    target: int
    success: bool
    critical: bool
    verdict: str


def roll_sotdl(payload: SotdlRollRequest) -> SotdlRollResponse:
    modifier = payload.attribute - 10
    net = payload.boons - payload.banes
    d20 = secrets.randbelow(20) + 1
    boon_dice = [secrets.randbelow(6) + 1 for _ in range(abs(net))]
    boon_value = (max(boon_dice) if boon_dice else 0) * (1 if net >= 0 else -1)
    total = d20 + modifier + boon_value
    success = total >= payload.target
    critical = success and total >= 20 and total - payload.target >= 5
    verdict = "Crítico" if critical else "Sucesso" if success else "Falha"
    return SotdlRollResponse(
        attribute=payload.attribute,
        modifier=modifier,
        d20=d20,
        net_boons=net,
        boon_dice=boon_dice,
        boon_value=boon_value,
        total=total,
        target=payload.target,
        success=success,
        critical=critical,
        verdict=verdict,
    )


class SotdlFateResponse(BaseModel):
    die: int
    outcome: str
    verdict: str


_FATE = {1: ("dying", "Morrendo"), 6: ("recovers", "Recupera 1 de dano")}


def roll_sotdl_fate() -> SotdlFateResponse:
    die = secrets.randbelow(6) + 1
    outcome, verdict = _FATE.get(die, ("stable", "Estável"))
    return SotdlFateResponse(die=die, outcome=outcome, verdict=verdict)


# Vampiro V3 (Revisado): the rules live in app/services/v3_vampire.py (marked for checking in the book);
# re-exported here so every system roller is reachable from one module.
from app.services.v3_vampire import (  # noqa: E402
    V3RollRequest,
    V3RollResponse,
    V3SheetResponse,
    roll_v3,
    v3_outcome,
    v3_sheet,
)
