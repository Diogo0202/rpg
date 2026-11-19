"""Tradução dos erros de domínio para respostas HTTP."""

from __future__ import annotations

from collections.abc import Callable, Coroutine, Iterator
from contextlib import contextmanager
from typing import Any

from fastapi import HTTPException, Request, Response
from fastapi.routing import APIRoute

from app.domain.errors import (
    Conflict,
    DomainError,
    Forbidden,
    InvalidInput,
    LimitExceeded,
    NotFound,
    RateLimited,
    ServiceUnavailable,
    Unauthenticated,
    UnexpectedUpstreamResponse,
)

HTTP_STATUS: dict[type[DomainError], int] = {
    Unauthenticated: 401,
    Forbidden: 403,
    NotFound: 404,
    Conflict: 409,
    LimitExceeded: 413,
    InvalidInput: 422,
    RateLimited: 429,
    UnexpectedUpstreamResponse: 502,
    ServiceUnavailable: 503,
}


def http_status(error: DomainError) -> int:
    for error_type in type(error).__mro__:
        if error_type in HTTP_STATUS:
            return HTTP_STATUS[error_type]
    return 500


def to_http_exception(error: DomainError) -> HTTPException:
    headers = None
    if isinstance(error, RateLimited) and error.retry_after_seconds is not None:
        headers = {"Retry-After": error.retry_after_seconds}
    return HTTPException(status_code=http_status(error), detail=error.message, headers=headers)


@contextmanager
def domain_errors_as_http() -> Iterator[None]:
    """Para código legado que ainda fala em ``HTTPException``."""
    try:
        yield
    except DomainError as error:
        raise to_http_exception(error) from error


class DomainErrorRoute(APIRoute):
    """Rota que converte erros de domínio em HTTP, mesmo quando o roteador é montado num app de teste."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def handle(request: Request) -> Response:
            with domain_errors_as_http():
                return await handler(request)

        return handle
