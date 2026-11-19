"""Liga as portas do marketplace a funções falsas trocadas por teste.

Cada atributo de ``fakes`` vazio usa o adaptador real; preenchido com ``monkeypatch.setattr``,
recebe as mesmas chamadas que o antigo módulo de serviço recebia, inclusive o token.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from fastapi import FastAPI, Header
from fastapi.testclient import TestClient

from app.adapters.inbound.http import marketplace as route
from app.adapters.inbound.http.dependencies import marketplace_catalog, marketplace_service_role, supabase_session
from app.adapters.outbound.supabase.marketplace import SupabaseMarketplaceCatalog, SupabaseMarketplaceServiceRole, public_request
from app.adapters.outbound.supabase.rest_client import SupabaseRestClient

fakes = SimpleNamespace(current_user_id=None, request_user=None, request_public=None, publish_as_service=None, apply_usage_events=None)


class _Session:
    def __init__(self, authorization: str | None) -> None:
        self._authorization = authorization
        self._real = SupabaseRestClient(authorization)

    async def current_user_id(self) -> str:
        if fakes.current_user_id is None:
            return await self._real.current_user_id()
        return await fakes.current_user_id(self._authorization)

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        return await self._real.request(method, path, **kwargs)

    async def rpc(self, function: str, payload: dict[str, Any], *, errors: Any = None) -> Any:
        if fakes.request_user is None:
            return await self._real.rpc(function, payload, errors=errors)
        return await fakes.request_user("POST", f"rpc/{function}", self._authorization, payload=payload)


class _ServiceRole:
    def __init__(self) -> None:
        self._real = SupabaseMarketplaceServiceRole()

    async def publish(self, owner_id: str, record: dict[str, Any]) -> dict[str, Any]:
        if fakes.publish_as_service is None:
            return await self._real.publish(owner_id, record)
        return await fakes.publish_as_service(owner_id, record)

    async def apply_usage_events(self) -> int | None:
        if fakes.apply_usage_events is None:
            return await self._real.apply_usage_events()
        return await fakes.apply_usage_events()


async def _public(method: str, path: str, **kwargs: Any) -> Any:
    request = fakes.request_public or public_request
    return await request(method, path, **kwargs)


def _session(authorization: str | None = Header(default=None)) -> _Session:
    return _Session(authorization)


def marketplace_client(*, maintenance: bool = False) -> TestClient:
    app = FastAPI()
    app.include_router(route.router)
    if maintenance:
        app.include_router(route.maintenance_router)
    app.dependency_overrides[supabase_session] = _session
    app.dependency_overrides[marketplace_catalog] = lambda: SupabaseMarketplaceCatalog(_public)
    app.dependency_overrides[marketplace_service_role] = _ServiceRole
    return TestClient(app)
