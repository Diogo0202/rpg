from __future__ import annotations

import secrets

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, model_validator


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


# O Um Anel: recorte de Atlas compartilhado em shared/rules-engine.ts e
# pages/OneRingSheet.tsx. Referência bibliográfica da regra completa pendente;
# conferir Core Rules da 2ª edição antes de afirmar favorecimento e Cansado.
# A errata oficial confirma apenas a Runa de Gandalf no resultado 12:
# https://freeleaguepublishing.com/wp-content/uploads/2023/09/TOR_Core_Rules_Errata_2204.pdf
# A regra do Olho como zero permite sucesso pelo total dos dados de Sucesso;
# falha automática por Miserável não entra neste recorte porque o estado não existe.
class OneRingRollRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: StrictInt = Field(ge=1, le=99)
    skill_dice: StrictInt = Field(ge=0, le=6)
    endurance: StrictInt = Field(ge=0, le=40)
    load: StrictInt = Field(ge=0, le=40)
    favored: StrictBool = False
    ill_favored: StrictBool = False

    @model_validator(mode="after")
    def validate_favor(self) -> OneRingRollRequest:
        if self.favored and self.ill_favored:
            raise ValueError("uma rolagem não pode ser favorecida e desfavorecida ao mesmo tempo")
        return self


class OneRingRollResponse(BaseModel):
    target: int
    feat_dice: list[int]
    feat_die: int
    success_dice: list[int]
    counted_success_dice: list[int]
    total: int
    weary: bool
    automatic_success: bool
    eye_of_sauron: bool
    success_icons: int
    success: bool


def _feat_rank(value: int) -> int:
    # TOR 2e: Gandalf rune (12) is best, Eye of Sauron (11) is worst.
    return 13 if value == 12 else 0 if value == 11 else value


def roll_one_ring(payload: OneRingRollRequest) -> OneRingRollResponse:
    favored = bool(payload.favored)
    ill_favored = bool(payload.ill_favored)
    feat_count = 2 if favored or ill_favored else 1
    feat_dice = [secrets.randbelow(12) + 1 for _ in range(feat_count)]
    if favored:
        feat_die = max(feat_dice, key=_feat_rank)
    elif ill_favored:
        feat_die = min(feat_dice, key=_feat_rank)
    else:
        feat_die = feat_dice[0]
    success_dice = [secrets.randbelow(6) + 1 for _ in range(payload.skill_dice)]
    weary = payload.endurance <= payload.load
    counted_dice = [0 if weary and value <= 3 else value for value in success_dice]
    automatic_success = feat_die == 12
    eye_of_sauron = feat_die == 11
    feat_value = 0 if eye_of_sauron or automatic_success else feat_die
    total = feat_value + sum(counted_dice)
    success = automatic_success or total >= payload.target
    return OneRingRollResponse(
        target=payload.target,
        feat_dice=feat_dice,
        feat_die=feat_die,
        success_dice=success_dice,
        counted_success_dice=counted_dice,
        total=total,
        weary=weary,
        automatic_success=automatic_success,
        eye_of_sauron=eye_of_sauron,
        success_icons=sum(1 for die in counted_dice if die == 6) if success else 0,
        success=success,
    )
