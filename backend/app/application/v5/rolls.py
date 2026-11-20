"""Casos de uso de rolagem V5: probabilidades, rolagem guardada, Surto de Sangue e rerrolagem."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any
from uuid import UUID

from pydantic import ValidationError

from app.application.v5.models import (
    Curve,
    CurveSeries,
    ProbabilityComparison,
    RollProbabilities,
    StoredRoll,
    WillpowerReroll,
)
from app.application.v5.ports import BloodAction, RollActivityRecorder, Row, V5Store
from app.domain.errors import (
    Conflict,
    DomainError,
    Forbidden,
    InvalidInput,
    NotFound,
    UnexpectedUpstreamResponse,
)
from app.domain.modifiers import Effect, ModifierPreview, Tag, preview_modifiers
from app.domain.roll_activity import RollChronicleContext
from app.domain.v5_actions import DamageState, V5ActionRollRequest, build_v5_modifier_request
from app.domain.v5_blood import blood_state
from app.domain.v5_probability import estimate_curve, estimate_probabilities, recommend_reroll

MAX_SHEET_NUMBER = 30
MAX_HUNGER = 5
MAX_HUNGER_BEFORE_SURGE = 4
SURGE_BONUS_RANGE = range(1, 7)
EXCESS_STAINS_PENALTY = Effect(
    id="__v5_excess_stains", label="Comprometido por Manchas excedentes", delta=-2,
    source_note="Manchas acima dos espaços vazios de Humanidade",
)
UNEXPECTED_RESPONSE = "resposta inesperada do Supabase"
REROLL_MESSAGES: dict[type[DomainError], str] = {
    Forbidden: "só quem fez a rolagem pode rerrolar com Vontade",
    Conflict: "esta rolagem já foi rerrolada com Vontade",
    InvalidInput: "trilha de Vontade cheia ou dados inválidos para esta rolagem",
}


def reworded(error: DomainError, messages: dict[type[DomainError], str]) -> DomainError:
    """Troca a mensagem genérica do armazenamento por uma que faça sentido nesta ação."""
    for error_type, message in messages.items():
        if isinstance(error, error_type):
            return error_type(message)
    return error


# Regras puras ------------------------------------------------------------------------------


def sheet_integer(values: dict[str, Any], key: str, *, default: int | None = 0) -> int:
    value = values.get(key, default)
    if type(value) is not int or not 0 <= value <= MAX_SHEET_NUMBER:
        raise InvalidInput(f"campo {key} inválido na ficha")
    return value


def sheet_damage(values: dict[str, Any]) -> DamageState:
    health_max = min(MAX_SHEET_NUMBER, sheet_integer(values, "vigor") + 3)
    willpower_max = min(MAX_SHEET_NUMBER, sheet_integer(values, "autocontrole") + sheet_integer(values, "resolucao"))
    try:
        return DamageState(
            health_max=health_max,
            health_superficial=sheet_integer(values, "saude_superficial"),
            health_aggravated=sheet_integer(values, "saude_agravada"),
            willpower_max=willpower_max,
            willpower_superficial=sheet_integer(values, "vontade_superficial"),
            willpower_aggravated=sheet_integer(values, "vontade_agravada"),
        )
    except ValidationError as error:
        raise InvalidInput("trilha de dano inválida na ficha") from error


@dataclass(frozen=True)
class RollPreview:
    modifiers: ModifierPreview
    hunger_dice: int


def sheet_roll_preview(sheet: Row, pool: int, difficulty: int, context_tags: list[Tag]) -> RollPreview:
    """Parada ajustada e dados de Fome a partir da ficha gravada (Fome, efeitos e dano)."""
    values, effects = sheet.get("values"), sheet.get("effects")
    if not isinstance(values, dict) or not isinstance(effects, list):
        raise InvalidInput("dados da ficha inválidos")
    hunger = sheet_integer(values, "fome", default=None)
    if hunger > MAX_HUNGER:
        raise InvalidInput("Fome inválida na ficha")
    try:
        request = V5ActionRollRequest(
            pool=pool, hunger=hunger, difficulty=difficulty, effects=effects,
            context_tags=context_tags, damage=sheet_damage(values),
        )
        if blood_state(values)["excess_stains"]:
            request.effects.append(EXCESS_STAINS_PENALTY.model_copy())
        modifiers, _ = build_v5_modifier_request(request)
        preview = preview_modifiers(modifiers)
    except (ValidationError, ValueError) as error:
        raise InvalidInput("efeitos ou estado da ficha inválidos") from error
    return RollPreview(preview, min(hunger, preview.adjusted_pool))


def probability_comparison(preview: ModifierPreview, hunger_dice: int, difficulty: int, willpower_dice: int) -> ProbabilityComparison:
    result = estimate_probabilities(preview.adjusted_pool, hunger_dice, difficulty, willpower_dice)
    return ProbabilityComparison(
        without_reroll=RollProbabilities(**asdict(result.without_reroll)),
        with_reroll=RollProbabilities(**asdict(result.with_reroll)),
        reroll_limit=result.reroll_limit,
        modifier_preview=preview,
        hunger_dice=hunger_dice,
    )


def free_probabilities(request: V5ActionRollRequest, willpower_dice: int) -> ProbabilityComparison:
    """Probabilidades de uma parada informada pelo jogador, sem ficha."""
    try:
        modifiers, _ = build_v5_modifier_request(request)
        preview = preview_modifiers(modifiers)
        return probability_comparison(preview, min(request.hunger, preview.adjusted_pool), request.difficulty, willpower_dice)
    except ValueError as error:
        raise InvalidInput(str(error)) from error


def probability_curve(pools: list[int], hunger: int, difficulties: list[int], willpower_dice: int) -> Curve:
    """Várias paradas contra várias dificuldades, com Fome fixa e Vontade ótima."""
    try:
        series = estimate_curve(pools, hunger, difficulties, willpower_dice)
    except ValueError as error:
        raise InvalidInput(str(error)) from error
    return Curve(hunger=hunger, reroll_limit=willpower_dice, series=[CurveSeries(**asdict(item)) for item in series])


def stored_roll(row: Any) -> StoredRoll:
    if not isinstance(row, dict):
        raise UnexpectedUpstreamResponse(UNEXPECTED_RESPONSE)
    try:
        roll = StoredRoll.model_validate(row)
    except ValidationError as error:
        raise UnexpectedUpstreamResponse("rolagem guardada inválida") from error
    if roll.rerolled_at is None:
        try:
            roll.recommended_reroll = recommend_reroll(roll.normal_dice, roll.hunger_dice, roll.difficulty)
        except ValueError:
            roll.recommended_reroll = []
    return roll


# Casos de uso ------------------------------------------------------------------------------


@dataclass(frozen=True)
class RollOrder:
    sheet_id: UUID
    pool: int
    difficulty: int
    context_tags: list[Tag]
    surge_turn_key: str | None = None
    surge_operation_id: UUID | None = None
    chronicle: RollChronicleContext | None = None


@dataclass(frozen=True)
class RollOutcome:
    roll: StoredRoll
    chronicle_status: str | None


@dataclass(frozen=True)
class _Surge:
    outcome: dict[str, Any]
    bonus_dice: int


class V5RollService:
    def __init__(self, store: V5Store, activity: RollActivityRecorder) -> None:
        self._store = store
        self._activity = activity

    async def sheet_probabilities(
        self, sheet_id: UUID, pool: int, difficulty: int, willpower_dice: int, context_tags: list[Tag],
    ) -> ProbabilityComparison:
        preview = sheet_roll_preview(await self._sheet(sheet_id), pool, difficulty, context_tags)
        try:
            return probability_comparison(preview.modifiers, preview.hunger_dice, difficulty, willpower_dice)
        except ValueError as error:
            raise InvalidInput("efeitos ou estado da ficha inválidos") from error

    async def roll(self, order: RollOrder) -> RollOutcome:
        """Rola no banco (dados gerados pelo Postgres) e guarda no histórico da ficha."""
        if order.chronicle is not None and order.chronicle.sheet_id != order.sheet_id:
            raise InvalidInput("a atividade da crônica deve ser da mesma ficha")
        surge: _Surge | None = None
        if order.surge_turn_key is not None and order.surge_operation_id is not None:
            receipt = await self._store.surge_receipt(
                order.sheet_id, order.surge_operation_id, order.pool, order.difficulty,
                order.surge_turn_key, list(order.context_tags),
            )
            if receipt is not None:
                # Repetição do mesmo Surto: devolve os dados já gravados, sem recalcular a ficha alterada.
                return RollOutcome(stored_roll(receipt), None)
            surge = await self._blood_surge(order)
        pool = order.pool + (surge.bonus_dice if surge else 0)
        preview = sheet_roll_preview(await self._sheet(order.sheet_id), pool, order.difficulty, order.context_tags)
        hunger_dice = preview.hunger_dice if surge is None else _hunger_before_surge(surge, preview.modifiers)
        if preview.modifiers.adjusted_pool == 0:
            raise InvalidInput("A parada ficou com zero dados. Combine com a mesa como resolver a ação.")
        row = await self._store.record_roll(order.sheet_id, preview.modifiers.adjusted_pool, hunger_dice, order.difficulty, {
            "base_pool": order.pool,
            "blood_surge": surge.outcome if surge else None,
            "context_tags": list(order.context_tags),
            "modifier_preview": preview.modifiers.model_dump(mode="json"),
        })
        roll = stored_roll(row)
        activity = await self._activity.record(order.chronicle)
        return RollOutcome(roll, activity.status if activity else None)

    async def history(self, sheet_id: UUID, limit: int) -> list[StoredRoll]:
        rows = await self._store.roll_history(sheet_id, limit)
        if not isinstance(rows, list):
            raise UnexpectedUpstreamResponse(UNEXPECTED_RESPONSE)
        return [stored_roll(row) for row in rows]

    async def willpower_reroll(self, roll_id: UUID, normal_indices: list[int]) -> WillpowerReroll:
        """Rerrola até três dados comuns uma única vez e marca o gasto de Vontade."""
        try:
            result = await self._store.willpower_reroll(roll_id, normal_indices)
        except DomainError as error:
            raise reworded(error, REROLL_MESSAGES) from error
        if not isinstance(result, dict):
            raise UnexpectedUpstreamResponse(UNEXPECTED_RESPONSE)
        values = result.get("sheet_values")
        return WillpowerReroll(
            roll=stored_roll(result.get("roll")),
            willpower_spent=result.get("willpower_spent") is True,
            sheet_values=values if isinstance(values, dict) else None,
        )

    async def _sheet(self, sheet_id: UUID) -> Row:
        sheet = await self._store.roll_sheet(sheet_id)
        if sheet is None:
            raise NotFound("ficha não encontrada")
        return sheet

    async def _blood_surge(self, order: RollOrder) -> _Surge:
        assert order.surge_turn_key is not None and order.surge_operation_id is not None
        result = await self._store.blood_action(BloodAction.SURGE, order.sheet_id, order.surge_operation_id, {
            "turn_key": order.surge_turn_key, "base_pool": order.pool,
        })
        if not isinstance(result, dict) or not isinstance(result.get("outcome"), dict):
            raise UnexpectedUpstreamResponse("resposta inesperada do Surto de Sangue")
        event = result.get("event")
        canonical_operation = event.get("operation_id") if isinstance(event, dict) else None
        outcome = {**result["outcome"], "operation_id": canonical_operation or str(order.surge_operation_id)}
        bonus = outcome.get("bonus_dice")
        if type(bonus) is not int or bonus not in SURGE_BONUS_RANGE:
            raise UnexpectedUpstreamResponse("bônus do Surto de Sangue inválido")
        return _Surge(outcome, bonus)


def _hunger_before_surge(surge: _Surge, preview: ModifierPreview) -> int:
    """O Despertar do Surto afeta as ações seguintes, não a ação que recebe o bônus."""
    hunger_before = surge.outcome.get("hunger_before")
    if type(hunger_before) is not int or not 0 <= hunger_before <= MAX_HUNGER_BEFORE_SURGE:
        raise UnexpectedUpstreamResponse("Fome anterior do Surto de Sangue invalida")
    return min(hunger_before, preview.adjusted_pool)
