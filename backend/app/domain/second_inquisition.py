"""Motor puro de alerta da SI para cenarios de jogo.

Este modulo processa eventos verificados (``VerifiedEvent``) para determinar o nivel de ameaca
de uma campanha e gerar respostas apropriadas.

Pressupostos:
- A camada de API (chamadora) eh responsavel por autenticar, validar permissao e
  corroborar qualquer relato de evento antes de converte-lo em ``VerifiedEvent``.
- Nao ha persistencia neste modulo; o estado deve ser reconstruido a cada calculo
  a partir de uma lista completa de eventos verificados da campanha.
- As funcoes sao deterministas: a mesma lista de eventos e configuracao produzira
  sempre o mesmo resultado.

Limitacoes:
- Nao correlaciona eventos entre campanhas distintas.
- As respostas geradas sao abstratas e baseadas em regras pre-definidas de nivel
  de ameaca, nao havendo simulacao complexa de mundo.
- Nao realiza validacao de identidade ou seguranca em tempo de execucao (isso eh
  dever da camada de API).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class EventKind(StrEnum):
    PUBLIC_DISCIPLINE = "public_discipline"
    MASQUERADE_BREACH = "masquerade_breach"
    DIGITAL_TRACE = "digital_trace"


class VerificationBasis(StrEnum):
    SERVER_RECORD = "server_record"
    NARRATOR_CONFIRMATION = "narrator_confirmation"


class ClientEventReport(BaseModel):
    """Formato validavel para um relato recebido do cliente; nao deve ser confiado."""

    model_config = ConfigDict(extra="forbid", strict=True)

    report_id: Annotated[str, Field(min_length=1, max_length=100)]
    campaign_id: Annotated[str, Field(min_length=1, max_length=100)]
    reporter_id: Annotated[str, Field(min_length=1, max_length=100)]
    event_kind: EventKind
    occurred_at: datetime
    area_id: Annotated[str, Field(min_length=1, max_length=100)]
    public_visibility: Literal[True]

    @field_validator("occurred_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("occurred_at precisa informar o fuso horario")
        return value


class VerifiedEvent(BaseModel):
    """Evento confirmado, validado e imutavel para fins de calculo de ameaca."""

    model_config = ConfigDict(extra="forbid", strict=True)

    event_id: Annotated[str, Field(min_length=1, max_length=100)]
    campaign_id: Annotated[str, Field(min_length=1, max_length=100)]
    event_kind: EventKind
    occurred_at: datetime
    area_id: Annotated[str, Field(min_length=1, max_length=100)]
    verification_basis: VerificationBasis
    verified_at: datetime

    @field_validator("occurred_at", "verified_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("datas precisam informar o fuso horario")
        return value


class ThreatLevel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    level: Annotated[int, Field(ge=1, le=5)]
    name: Annotated[str, Field(min_length=1, max_length=60)]
    minimum_score: Annotated[int, Field(ge=1)]


class ThreatConfig(BaseModel):
    """Pesos e limiares de ameaca deterministas por campanha."""

    model_config = ConfigDict(extra="forbid", strict=True)

    event_weights: dict[EventKind, Annotated[int, Field(ge=0, le=1000)]] = Field(
        default_factory=lambda: {
            EventKind.PUBLIC_DISCIPLINE: 10,
            EventKind.MASQUERADE_BREACH: 20,
            EventKind.DIGITAL_TRACE: 8,
        }
    )
    levels: list[ThreatLevel] = Field(
        default_factory=lambda: [
            ThreatLevel(level=1, name="Observacao", minimum_score=20),
            ThreatLevel(level=2, name="Investigacao", minimum_score=45),
            ThreatLevel(level=3, name="Operacao", minimum_score=75),
        ]
    )

    @model_validator(mode="after")
    def validate_levels(self) -> ThreatConfig:
        numbers = [level.level for level in self.levels]
        scores = [level.minimum_score for level in self.levels]
        if numbers != sorted(set(numbers)) or numbers != list(range(1, len(numbers) + 1)):
            raise ValueError("niveis devem ser unicos e numerados em sequencia desde 1")
        if scores != sorted(set(scores)):
            raise ValueError("limiares devem crescer sem repeticao")
        if not self.event_weights:
            raise ValueError("configure ao menos um peso de evento")
        return self


class ResponseKind(StrEnum):
    CONTAINMENT = "containment_team"
    WIRETAP = "wiretap"
    FINANCIAL_BLOCK = "financial_block"


class GeneratedResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: ResponseKind
    title: str
    triggered_at_level: int
    stats: dict[str, int | str | bool]


class ThreatAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    campaign_id: str
    score: int
    level: int
    level_name: str
    verified_event_count: int
    score_by_event_kind: dict[EventKind, int]
    responses: list[GeneratedResponse]
    assessment_at: datetime


def assess_threat(
    campaign_id: str,
    events: list[VerifiedEvent],
    config: ThreatConfig | None = None,
    assessment_at: datetime | None = None,
) -> ThreatAssessment:
    """Calcula ameaca de forma deterministica a partir de eventos confirmados."""
    selected = config or ThreatConfig()

    if not campaign_id:
        raise ValueError("campaign_id precisa ser informado")
    if any(event.campaign_id != campaign_id for event in events):
        raise ValueError("eventos de outra campanha não podem compor esta avaliação")

    # Ordena por data e id para preservar determinismo mesmo em empates.
    campaign_events = sorted(events, key=lambda e: (e.verified_at, e.event_id))

    # Verificacao de integridade dos dados de entrada
    event_ids = [event.event_id for event in campaign_events]
    if len(event_ids) != len(set(event_ids)):
        raise ValueError("integridade falhou: eventos confirmados duplicados detectados")

    breakdown = {kind: 0 for kind in sorted(EventKind, key=lambda e: e.value)}
    for event in campaign_events:
        breakdown[event.event_kind] += selected.event_weights.get(event.event_kind, 0)

    score = sum(breakdown.values())

    # Determina o nivel com base nos limiares ordenados
    reached = [level for level in sorted(selected.levels, key=lambda l: l.minimum_score) if score >= level.minimum_score]
    level = reached[-1] if reached else None

    current_level = level.level if level else 0
    responses = _generate_responses(current_level)

    return ThreatAssessment(
        campaign_id=campaign_id,
        score=score,
        level=current_level,
        level_name=level.name if level else "Sem alerta",
        verified_event_count=len(campaign_events),
        score_by_event_kind=breakdown,
        responses=responses,
        assessment_at=assessment_at or datetime.now(timezone.utc),
    )



def _generate_responses(level: int) -> list[GeneratedResponse]:
    """Geracao deterministica de respostas baseada no nivel de ameaca."""
    responses: list[GeneratedResponse] = []
    if level >= 1:
        responses.append(
            GeneratedResponse(
                kind=ResponseKind.WIRETAP,
                title="Monitoramento de comunicacoes",
                triggered_at_level=1,
                stats={"coverage": min(5, level + 1), "duration_hours": 24 * level, "lead_count": level},
            )
        )
    if level >= 2:
        responses.append(
            GeneratedResponse(
                kind=ResponseKind.CONTAINMENT,
                title="Equipe de contencao",
                triggered_at_level=2,
                stats={
                    "team_size": 2 + level,
                    "combat_pool": 5 + level,
                    "health": 4 + level,
                    "armor": min(3, level),
                    "coordination": level,
                },
            )
        )
    if level >= 3:
        responses.append(
            GeneratedResponse(
                kind=ResponseKind.FINANCIAL_BLOCK,
                title="Restricao financeira",
                triggered_at_level=3,
                stats={"accounts_affected": level * 2, "duration_hours": 12 * level, "scope": "regional"},
            )
        )
    return responses


def confirm_client_report(
    report: ClientEventReport,
    *,
    event_id: str,
    basis: VerificationBasis,
    verified_at: datetime | None = None,
) -> VerifiedEvent:
    """Converte um relato nao confiavel em evento verificado (deve ser chamado por camada autorizada)."""

    # A logica de validacao de entrada reside em ClientEventReport (pydantic).
    # Esta funcao atua como uma barreira de criacao de VerifiedEvent.

    return VerifiedEvent(
        event_id=event_id,
        campaign_id=report.campaign_id,
        event_kind=report.event_kind,
        occurred_at=report.occurred_at,
        area_id=report.area_id,
        verification_basis=basis,
        verified_at=verified_at or datetime.now(timezone.utc),
    )
