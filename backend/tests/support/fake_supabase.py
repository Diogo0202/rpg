"""Supabase falso para testar rotas migradas sem rede.

Substitui o adaptador ``supabase_session`` e grava cada chamada recebida.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI

from app.adapters.inbound.http.dependencies import roll_activity_recorder, supabase_session

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
        errors: Any = None,
    ) -> Any:
        self.requests.append(RecordedRequest(method, path, params, payload))
        return await _resolved(self.on_request(method, path, params, payload))

    async def rpc(self, function: str, payload: dict[str, Any], *, errors: Any = None) -> Any:
        self.rpcs.append((function, payload))
        return await _resolved(self.on_rpc(function, payload))


async def _resolved(result: Any) -> Any:
    """Os testes podem responder com funções comuns ou ``async``."""
    return await result if inspect.isawaitable(result) else result


def use_fake_supabase(app: FastAPI, fake: FakeSupabase) -> FakeSupabase:
    app.dependency_overrides[supabase_session] = lambda: fake
    return fake


def stub_supabase(app: FastAPI, *, request: RequestHandler | None = None, rpc: RpcHandler | None = None) -> FakeSupabase:
    """Troca só os manipuladores informados, mantendo o Supabase falso já instalado no app."""
    fake = getattr(app.state, "fake_supabase", None)
    if fake is None:
        fake = use_fake_supabase(app, FakeSupabase())
        app.state.fake_supabase = fake
    if request is not None:
        fake.on_request = request
    if rpc is not None:
        fake.on_rpc = rpc
    return fake


def stub_roll_activity(app: FastAPI, record: Callable[[Any], Any]) -> None:
    class Recorder:
        async def record(self, context: Any) -> Any:
            return await _resolved(record(context))

    app.dependency_overrides[roll_activity_recorder] = Recorder
