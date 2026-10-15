from __future__ import annotations

import os
import secrets
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    DiceRequest,
    DiceResponse,
    ExtractionRequest,
    SheetCalculationRequest,
    SheetCalculationResponse,
    TemplateDraft,
)
from app.services.dice import roll
from app.services.extraction import create_review_draft
from app.services.sheet_calculations import calculate_sheet
from app.services.templates import validate_template
from app.routes.generators import router as generation_router
from app.routes.v5 import router as v5_router
from app.routes.sheets import router as sheets_router
from app.routes.rules import router as rules_router
from app.routes.modifiers import router as modifiers_router
from app.routes.v5_actions import router as v5_actions_router
from app.routes.second_inquisition import router as second_inquisition_router
from app.routes.chronicle import router as chronicle_router
from app.routes.system_rolls import router as system_rolls_router

app = FastAPI(title="RPG Nexus API", version="0.1.0")
app.include_router(generation_router)
app.include_router(v5_router)
app.include_router(sheets_router)
app.include_router(rules_router)
app.include_router(modifiers_router)
app.include_router(v5_actions_router)
app.include_router(second_inquisition_router)
app.include_router(chronicle_router)
app.include_router(system_rolls_router)

# Em produção a lista vem do ambiente. Não abrimos CORS para qualquer origem.
origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
if "*" in origins:
    raise RuntimeError("CORS_ORIGINS não pode conter * quando credenciais estão liberadas")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_extraction_worker(
    x_worker_token: Annotated[str | None, Header()] = None,
) -> None:
    """Keep draft creation on the trusted worker until Supabase JWT is wired."""
    worker_token = os.getenv("EXTRACTION_WORKER_TOKEN")
    if not worker_token:
        raise HTTPException(status_code=503, detail="extração ainda não está configurada")
    if not x_worker_token or not secrets.compare_digest(x_worker_token, worker_token):
        raise HTTPException(status_code=403, detail="worker de extração não autorizado")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/dice/roll", response_model=DiceResponse)
def roll_dice(payload: DiceRequest) -> DiceResponse:
    try:
        return roll(payload.expression, effects=payload.effects, context_tags=payload.context_tags)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/v1/templates/validate", response_model=TemplateDraft)
def validate_template_payload(payload: TemplateDraft) -> TemplateDraft:
    try:
        return validate_template(payload)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/v1/sheets/calculate", response_model=SheetCalculationResponse)
def calculate_sheet_payload(payload: SheetCalculationRequest) -> SheetCalculationResponse:
    try:
        return SheetCalculationResponse(values=calculate_sheet(payload.template, payload.values))
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/v1/extractions/draft")
def create_extraction_draft(
    payload: ExtractionRequest,
    _: Annotated[None, Depends(require_extraction_worker)],
) -> dict[str, object]:
    return create_review_draft(payload)
