"""Adaptador HTTP das ferramentas gerais: saúde, dados, validação de modelo, cálculo e extração."""

from __future__ import annotations

import os
import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response

from app.adapters.inbound.http.dependencies import roll_activity_recorder
from app.adapters.inbound.http.errors import DomainErrorRoute
from app.application.roll_activity import RollActivityRecorder
from app.application.tools import calculated_values, checked_template, review_draft, roll_expression
from app.domain.errors import Forbidden, ServiceUnavailable
from app.domain.models import DiceRequest, DiceResponse, ExtractionRequest, SheetCalculationRequest, SheetCalculationResponse, TemplateDraft

CHRONICLE_ACTIVITY_HEADER = "X-Chronicle-Activity"

router = APIRouter(route_class=DomainErrorRoute)


def require_extraction_worker(x_worker_token: Annotated[str | None, Header()] = None) -> None:
    """Só o worker de extração, com token próprio, cria rascunhos."""
    worker_token = os.getenv("EXTRACTION_WORKER_TOKEN")
    if not worker_token:
        raise ServiceUnavailable("extração ainda não está configurada")
    if not x_worker_token or not secrets.compare_digest(x_worker_token, worker_token):
        raise Forbidden("worker de extração não autorizado")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/api/v1/dice/roll", response_model=DiceResponse)
async def roll_dice(
    payload: DiceRequest, response: Response, activity: RollActivityRecorder = Depends(roll_activity_recorder),
) -> DiceResponse:
    outcome = await roll_expression(payload, activity)
    if outcome.chronicle_status is not None:
        response.headers[CHRONICLE_ACTIVITY_HEADER] = outcome.chronicle_status
    return outcome.result


@router.post("/api/v1/templates/validate", response_model=TemplateDraft)
def validate_template_payload(payload: TemplateDraft) -> TemplateDraft:
    return checked_template(payload)


@router.post("/api/v1/sheets/calculate", response_model=SheetCalculationResponse)
def calculate_sheet_payload(payload: SheetCalculationRequest) -> SheetCalculationResponse:
    return SheetCalculationResponse(values=calculated_values(payload))


@router.post("/api/v1/extractions/draft")
def create_extraction_draft(payload: ExtractionRequest, _: Annotated[None, Depends(require_extraction_worker)]) -> dict[str, object]:
    return review_draft(payload)
