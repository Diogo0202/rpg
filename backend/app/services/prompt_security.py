"""Boundaries for untrusted campaign text and RPC results.

These checks constrain data shape and size. They do not identify or neutralize
prompt injection, and no LLM currently consumes these values.
"""

from __future__ import annotations

import math
import unicodedata
from collections.abc import Mapping
from uuid import UUID


class UntrustedDataError(ValueError):
    """A source value or upstream result is outside the accepted contract."""


def normalize_untrusted_text(value: object, *, field: str, max_chars: int, max_bytes: int | None = None) -> str:
    """Normalize bounded text while preserving ordinary story and rules content."""
    if not isinstance(value, str):
        raise UntrustedDataError(f"{field} precisa ser texto")
    normalized = unicodedata.normalize("NFC", value)
    if len(normalized) > max_chars:
        raise UntrustedDataError(f"{field} excede o limite de caracteres")
    try:
        encoded = normalized.encode("utf-8", errors="strict")
    except UnicodeEncodeError as error:
        raise UntrustedDataError(f"{field} contém Unicode inválido") from error
    if max_bytes is not None and len(encoded) > max_bytes:
        raise UntrustedDataError(f"{field} excede o limite de bytes")
    if any(unicodedata.category(char) == "Cc" and char not in "\n\r\t" for char in normalized):
        raise UntrustedDataError(f"{field} contém caracteres de controle")
    return normalized


def _required(row: Mapping[str, object], key: str) -> object:
    if key not in row:
        raise UntrustedDataError(f"resposta do Supabase sem {key}")
    return row[key]


def _uuid(value: object, *, field: str) -> str:
    if not isinstance(value, str):
        raise UntrustedDataError(f"{field} inválido na resposta do Supabase")
    try:
        return str(UUID(value))
    except (ValueError, AttributeError) as error:
        raise UntrustedDataError(f"{field} inválido na resposta do Supabase") from error


def _positive_page(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 100_000:
        raise UntrustedDataError("page_number inválido na resposta do Supabase")
    return value


def _rows(value: object, *, max_rows: int) -> list[Mapping[str, object]]:
    if not isinstance(value, list) or len(value) > max_rows:
        raise UntrustedDataError("formato inválido na resposta do Supabase")
    if any(not isinstance(row, Mapping) for row in value):
        raise UntrustedDataError("linha inválida na resposta do Supabase")
    return value  # type: ignore[return-value]


def validate_rule_search_results(value: object) -> list[dict[str, object]]:
    """Return only the stable public search fields; unknown RPC keys are dropped."""
    safe_rows: list[dict[str, object]] = []
    for row in _rows(value, max_rows=10):
        safe_row: dict[str, object] = {
            "source_id": _uuid(_required(row, "source_id"), field="source_id"),
            "source_title": normalize_untrusted_text(
                _required(row, "source_title"), field="source_title", max_chars=240, max_bytes=960
            ),
            "page_number": _positive_page(_required(row, "page_number")),
            "excerpt": normalize_untrusted_text(
                _required(row, "excerpt"), field="excerpt", max_chars=1600, max_bytes=6400
            ),
        }
        # Older RPC fixtures omitted rank; keep that valid public response shape.
        if "rank" in row:
            rank = row["rank"]
            if isinstance(rank, bool) or not isinstance(rank, (int, float)) or not math.isfinite(rank):
                raise UntrustedDataError("rank inválido na resposta do Supabase")
            safe_row["rank"] = float(rank)
        safe_rows.append(safe_row)
    return safe_rows


def validate_rule_page_result(value: object) -> dict[str, object] | None:
    """Validate the single page record and prevent extra RPC fields reaching clients."""
    rows = _rows(value, max_rows=1)
    if not rows:
        return None
    row = rows[0]
    return {
        "source_id": _uuid(_required(row, "source_id"), field="source_id"),
        "source_title": normalize_untrusted_text(
            _required(row, "source_title"), field="source_title", max_chars=240, max_bytes=960
        ),
        "page_number": _positive_page(_required(row, "page_number")),
        "content": normalize_untrusted_text(
            _required(row, "content"), field="content", max_chars=12_000, max_bytes=48_000
        ),
    }
