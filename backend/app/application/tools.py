"""Ferramentas gerais da API: rolagem de expressão, validação de modelo, cálculo de ficha e extração."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.application.roll_activity import RollActivityRecorder
from app.domain.errors import InvalidInput
from app.domain.models import DiceRequest, DiceResponse, ExtractionRequest, SheetCalculationRequest, TemplateDraft
from app.domain.dice import roll
from app.domain.extraction import create_review_draft
from app.domain.sheet_calculations import calculate_sheet
from app.domain.templates import validate_template


@dataclass(frozen=True)
class DiceOutcome:
    result: DiceResponse
    chronicle_status: str | None


async def roll_expression(request: DiceRequest, activity: RollActivityRecorder) -> DiceOutcome:
    try:
        result = roll(request.expression, effects=request.effects, context_tags=request.context_tags)
    except ValueError as error:
        raise InvalidInput(str(error)) from error
    recorded = await activity.record_field(request.chronicle, request.expression)
    return DiceOutcome(result, recorded.status if recorded else None)


def checked_template(template: TemplateDraft) -> TemplateDraft:
    try:
        return validate_template(template)
    except ValueError as error:
        raise InvalidInput(str(error)) from error


def calculated_values(request: SheetCalculationRequest) -> dict[str, Any]:
    try:
        return calculate_sheet(request.template, request.values)
    except ValueError as error:
        raise InvalidInput(str(error)) from error


def review_draft(request: ExtractionRequest) -> dict[str, object]:
    try:
        return create_review_draft(request)
    except ValueError as error:
        raise InvalidInput(str(error)) from error
