"""Supabase falso para testar rotas migradas sem rede.

Substitui o adaptador ``supabase_session`` e grava cada chamada recebida.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI

from app.adapters.inbound.http.dependencies import supabase_session

DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000003"

RequestHandler = Callable[[str, str, dict[str, str] | None, dict[str, Any] | None], Any]
RpcHandler = Callable[[str, dict[str, Any]], Any]


@dataclass
class RecordedRequest:
    method: str
    path: str
    params: dict[str, str] | None
    payload: dict[str, Any] | None


@dataclass
class FakeSupabase:
    user_id: str = DEFAULT_USER_ID
    on_request: RequestHandler = lambda *_: []
    on_rpc: RpcHandler = lambda *_: {}
    requests: list[RecordedRequest] = field(default_factory=list)
    rpcs: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    async def current_user_id(self) -> str:
        return self.user_id

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, str] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        self.requests.append(RecordedRequest(method, path, params, payload))
        return self.on_request(method, path, params, payload)

    async def rpc(self, function: str, payload: dict[str, Any]) -> Any:
        self.rpcs.append((function, payload))
        return self.on_rpc(function, payload)


def use_fake_supabase(app: FastAPI, fake: FakeSupabase) -> FakeSupabase:
    app.dependency_overrides[supabase_session] = lambda: fake
    return fake
