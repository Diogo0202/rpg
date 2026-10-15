from __future__ import annotations

import secrets
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

from app.services.modifiers import Effect, ModifierPreview, ModifierRequest, Tag, preview_modifiers


class DamageState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    health_max: StrictInt = Field(ge=0, le=30)
    health_superficial: StrictInt = Field(ge=0, le=30)
    health_aggravated: StrictInt = Field(ge=0, le=30)
    willpower_max: StrictInt = Field(ge=0, le=30)
    willpower_superficial: StrictInt = Field(ge=0, le=30)
    willpower_aggravated: StrictInt = Field(ge=0, le=30)

    @model_validator(mode="after")
    def damage_fits_tracks(self) -> DamageState:
        if self.health_superficial + self.health_aggravated > self.health_max:
            raise ValueError("dano excede a trilha de Saúde")
        if self.willpower_superficial + self.willpower_aggravated > self.willpower_max:
            raise ValueError("dano excede a trilha de Força de Vontade")
        return self


class V5ActionRollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pool: StrictInt = Field(ge=0, le=30)
    hunger: StrictInt = Field(ge=0, le=5)
    difficulty: StrictInt = Field(ge=1, le=100)
    effects: list[Effect] = Field(default_factory=list, max_length=30)
    context_tags: list[Tag] = Field(default_factory=list, max_length=20)
    damage: DamageState | None = None

    @model_validator(mode="after")
    def reserve_server_damage_effect_ids(self) -> V5ActionRollRequest:
        reserved = {"__damage_health_full", "__damage_willpower_full"}
        if any(effect.id in reserved for effect in self.effects):
            raise ValueError("ids de efeitos de dano são reservados pelo servidor")
        return self


class V5ActionRollResponse(BaseModel):
    normal_dice: list[int]
    hunger_dice: list[int]
    hunger_count: int
    successes: int
    difficulty: int
    success: bool
    critical_pairs: int
    clean_critical: bool
    messy_critical: bool
    bestial_failure: bool
    modifier_preview: ModifierPreview
    damage_penalties: list[Literal["health", "willpower"]]


def roll_v5_action(payload: V5ActionRollRequest) -> V5ActionRollResponse:
    modifiers, damage_penalties = build_v5_modifier_request(payload)
    preview = preview_modifiers(modifiers)
    if preview.adjusted_pool == 0:
        raise ValueError("A parada ficou com zero dados. Combine com a mesa como resolver a ação.")

    hunger_count = min(payload.hunger, preview.adjusted_pool)
    normal_count = preview.adjusted_pool - hunger_count
    normal_dice = [secrets.randbelow(10) + 1 for _ in range(normal_count)]
    hunger_dice = [secrets.randbelow(10) + 1 for _ in range(hunger_count)]

    tens = normal_dice.count(10) + hunger_dice.count(10)
    critical_pairs = tens // 2
    successes = sum(value >= 6 for value in (*normal_dice, *hunger_dice)) + 2 * critical_pairs
    success = successes >= payload.difficulty
    has_critical = critical_pairs > 0
    messy_critical = success and has_critical and 10 in hunger_dice
    clean_critical = success and has_critical and 10 not in hunger_dice
    bestial_failure = not success and 1 in hunger_dice

    return V5ActionRollResponse(
        normal_dice=normal_dice,
        hunger_dice=hunger_dice,
        hunger_count=hunger_count,
        successes=successes,
        difficulty=payload.difficulty,
        success=success,
        critical_pairs=critical_pairs,
        clean_critical=clean_critical,
        messy_critical=messy_critical,
        bestial_failure=bestial_failure,
        modifier_preview=preview,
        damage_penalties=damage_penalties,
    )


def build_v5_modifier_request(
    payload: V5ActionRollRequest,
) -> tuple[ModifierRequest, list[Literal["health", "willpower"]]]:
    # Validate the user's own bounded request before adding trusted server effects.
    user_modifiers = ModifierRequest(
        base_pool=payload.pool,
        context_tags=payload.context_tags,
        effects=payload.effects,
    )
    derived_effects: list[Effect] = []
    damage_penalties: list[Literal["health", "willpower"]] = []
    context = set(user_modifiers.context_tags)
    damage = payload.damage

    if damage and "fisico" in context and damage.health_max > 0:
        if damage.health_superficial + damage.health_aggravated == damage.health_max:
            derived_effects.append(Effect(
                id="__damage_health_full",
                label="Penalidade por Saúde cheia",
                delta=-2,
                applies_to_tags=["fisico"],
                source_note="Trilha de Saúde cheia",
            ))
            damage_penalties.append("health")

    if damage and "mental" in context and damage.willpower_max > 0:
        if damage.willpower_superficial + damage.willpower_aggravated == damage.willpower_max:
            derived_effects.append(Effect(
                id="__damage_willpower_full",
                label="Penalidade por Força de Vontade cheia",
                delta=-2,
                applies_to_tags=["mental"],
                source_note="Trilha de Força de Vontade cheia",
            ))
            damage_penalties.append("willpower")

    trusted_modifiers = user_modifiers.model_copy(
        update={"effects": [*user_modifiers.effects, *derived_effects]},
    )
    return trusted_modifiers, damage_penalties
