"""Montagem da API: routers dos adaptadores HTTP, middlewares de segurança e CORS."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.access_audit import AccessAuditMiddleware
from app.adapters.inbound.http import (
    ai_assistance,
    campaign_invites,
    chronicle,
    experience,
    generators,
    hunter,
    marketplace,
    mobile_sync,
    modifiers,
    one_ring_company,
    rules,
    second_inquisition,
    sheets,
    spotify,
    system_rolls,
    tools,
    v5,
    v5_actions,
    v5_sanguine,
    voice_sessions,
)
from app.security import ApiSecurityMiddleware
from app.shared_concurrency import SharedAdmissionMiddleware

DEFAULT_CORS_ORIGINS = "http://localhost:3000"
ROUTERS = (
    generators.router,
    v5.router,
    sheets.router,
    rules.router,
    modifiers.router,
    v5_actions.router,
    v5_sanguine.router,
    second_inquisition.router,
    chronicle.router,
    system_rolls.router,
    ai_assistance.router,
    mobile_sync.router,
    marketplace.router,
    marketplace.maintenance_router,
    campaign_invites.router,
    voice_sessions.router,
    experience.router,
    hunter.router,
    one_ring_company.router,
    spotify.router,
    tools.router,
)


def allowed_origins() -> list[str]:
    """Em produção a lista vem do ambiente. Não abrimos CORS para qualquer origem."""
    origins = [
        origin.strip().rstrip("/")
        for origin in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",")
        if origin.strip()
    ]
    if "*" in origins:
        raise RuntimeError("CORS_ORIGINS não pode conter * quando credenciais estão liberadas")
    return origins


app = FastAPI(title="RPG-Atlas API", version="0.1.0")
for router in ROUTERS:
    app.include_router(router)
app.add_middleware(ApiSecurityMiddleware)
app.add_middleware(SharedAdmissionMiddleware)
app.add_middleware(AccessAuditMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Retry-After", "X-Request-ID", "X-Chronicle-Activity"],
)
