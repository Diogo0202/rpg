from __future__ import annotations

import json
import math

import httpx
import pytest

from app.services import ai_provider as provider


def _config(monkeypatch, *, enabled="true", model=provider.MODEL, input_price="0.75", output_price="4.50"):
    monkeypatch.setenv("AI_ENABLED", enabled)
    monkeypatch.setenv("AI_MODEL", model)
    monkeypatch.setenv("AI_INPUT_USD_PER_MILLION", input_price)
    monkeypatch.setenv("AI_OUTPUT_USD_PER_MILLION", output_price)
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-secret")


def _template():
    return {"name": "Test", "version": 1, "schema": {"name": "Test", "version": 1, "fields": [
        {"id": "nome", "label": "Nome", "kind": "text", "required": True},
        {"id": "clan", "label": "Clã", "kind": "select", "options": ["A", "B"]},
        {"id": "forca", "label": "Força", "kind": "number"},
        {"id": "total", "label": "Total", "kind": "formula", "expression": "forca + 1"},
    ]}}


def test_disabled_provider_never_creates_client(monkeypatch):
    _config(monkeypatch, enabled="false")
    def forbidden(**kwargs):
        raise AssertionError("client must not be created")
    monkeypatch.setattr(provider.httpx, "AsyncClient", forbidden)
    with pytest.raises(provider.AIUnavailable):
        import asyncio
        asyncio.run(provider.generate_proposal("npc", {}))


def test_configuration_fails_closed_and_reserves_floor(monkeypatch):
    _config(monkeypatch)
    assert provider.provider_settings().reserve_micro == 318432
    _config(monkeypatch, model="another-model")
    with pytest.raises(provider.AIUnavailable):
        provider.provider_settings()
    _config(monkeypatch, input_price="0.74")
    with pytest.raises(provider.AIUnavailable):
        provider.provider_settings()


def test_schema_only_exposes_editable_template_fields():
    schema = provider.result_schema("sheet", _template())
    serialized = json.dumps(schema)
    assert "nome" in serialized and "clan" in serialized and "forca" in serialized
    assert "total" not in serialized
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"name", "values", "narrative", "questions"}


def test_validation_rejects_calculated_and_unapproved_values():
    template = _template()
    result = {"name": "A", "values": {"nome": "A", "clan": "C", "forca": 2, "total": 3}, "narrative": "", "questions": []}
    with pytest.raises(provider.AIProviderError):
        provider.validate_result("sheet", result, template)
    result["values"] = {"nome": "A", "clan": "A", "forca": True}
    with pytest.raises(provider.AIProviderError):
        provider.validate_result("sheet", result, template)


@pytest.mark.parametrize("field,value", [("forca", math.nan), ("forca", math.inf), ("forca", -math.inf), ("forca", 1_000_001), ("nome", "x" * 10_001)])
def test_sheet_values_enforce_bounds(field, value):
    template = _template()
    result = {"name": "A", "values": {field: value}, "narrative": "", "questions": []}
    with pytest.raises(provider.AIProviderError):
        provider.validate_result("sheet", result, template)


def test_sheet_proposal_can_omit_required_fields_until_approval():
    result = {"name": "A", "values": {}, "narrative": "", "questions": []}
    normalized = provider.validate_result("sheet", result, _template())
    assert normalized["values"] == {}


@pytest.mark.parametrize("kind", ["other", "", "template"])
def test_invalid_kind_fails_before_network(kind, monkeypatch):
    with pytest.raises(provider.AIProviderError) as error:
        provider.result_schema(kind)
    assert error.value.code == "invalid_kind"


def test_context_size_is_limited_before_network(monkeypatch):
    _config(monkeypatch)
    with pytest.raises(provider.AIProviderError) as error:
        import asyncio
        asyncio.run(provider.generate_proposal("math_tutor", {"text": "x" * provider.MAX_INPUT_BYTES}))
    assert error.value.code == "input_too_large"


class _Stream:
    def __init__(self, response):
        self.response = response
    async def __aenter__(self):
        return self.response
    async def __aexit__(self, *args):
        return False


class _Response:
    status_code = 200
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()
    async def aiter_bytes(self):
        yield self.payload


class _Client:
    def __init__(self, payload, captured):
        self.payload, self.captured = payload, captured
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        return False
    def stream(self, method, url, **kwargs):
        self.captured.update(method=method, url=url, **kwargs)
        return _Stream(_Response(self.payload))


@pytest.mark.parametrize("payload,code", [
    ({"status": "incomplete", "usage": {"input_tokens": 1, "output_tokens": 1}}, "incomplete_output"),
    ({"status": "completed", "usage": {"input_tokens": 1, "output_tokens": 1}, "output": [{"content": [{"type": "refusal"}]}]}, "refusal"),
    ({"status": "completed", "usage": {"input_tokens": "1", "output_tokens": 1}, "output": []}, "invalid_usage"),
    ({"status": "completed", "usage": {"input_tokens": 1, "output_tokens": 1}, "output": [{"content": [{"type": "output_text", "text": "not json"}]}]}, "invalid_output"),
    ({"status": "in_progress", "usage": {"input_tokens": 1, "output_tokens": 1}, "output": []}, "invalid_output"),
    ({"usage": {"input_tokens": 1, "output_tokens": 1}, "output": []}, "invalid_output"),
])
def test_bad_provider_responses_fail_closed(monkeypatch, payload, code):
    _config(monkeypatch)
    captured = {}
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **_: _Client(payload, captured))
    with pytest.raises(provider.AIProviderError) as error:
        import asyncio
        asyncio.run(provider.generate_proposal("math_tutor", {"expression": "2+2", "values": {}, "server_result": 4}))
    assert error.value.code == code
    body = captured["json"]
    assert body["store"] is False
    assert "tools" not in body
    assert body["reasoning"] == {"effort": "none"}
    assert body["text"]["format"]["type"] == "json_schema"
    assert body["text"]["format"]["strict"] is True


def test_success_returns_validated_result_and_usage(monkeypatch):
    _config(monkeypatch)
    payload = {"status": "completed", "usage": {"input_tokens": 5, "output_tokens": 7}, "output": [
        {"content": [{"type": "output_text", "text": json.dumps({"explanation": "Somar 2 e 2 resulta em 4."})}]}
    ]}
    captured = {}
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **_: _Client(payload, captured))
    import asyncio
    result = asyncio.run(provider.generate_proposal("math_tutor", {"expression": "2+2", "values": {}, "server_result": 4}))
    assert result.input_tokens == 5 and result.output_tokens == 7
    assert result.model == provider.MODEL
    assert captured["json"]["store"] is False
    assert "tools" not in captured["json"]
