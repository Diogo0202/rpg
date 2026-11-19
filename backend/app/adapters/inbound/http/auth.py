"""Exigência de sessão para rotas que não precisam saber quem é o usuário, só que ele entrou."""

from __future__ import annotations

import os

import httpx
from fastapi import Header, HTTPException, Request

AUTH_TIMEOUT_SECONDS = 5


async def require_signed_in_user(request: Request, authorization: str | None = Header(default=None)) -> None:
    """Aceita a sessão já validada pelo ``ApiSecurityMiddleware`` ou confere o token no Supabase."""
    if getattr(request.state, "supabase_user", None) is not None:
        return
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_PUBLISHABLE_KEY")
    if not supabase_url or not supabase_key:
        raise HTTPException(status_code=503, detail="autenticação da API ainda não está configurada")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="sessão necessária")
    try:
        async with httpx.AsyncClient(timeout=AUTH_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": supabase_key, "Authorization": authorization},
            )
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="serviço de autenticação indisponível") from error
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="sessão inválida")
