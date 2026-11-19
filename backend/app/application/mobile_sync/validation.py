"""Validação das respostas do Supabase antes de entregá-las ao aplicativo mobile.

O aplicativo grava o que recebe na base confirmada (ADR 0001), então qualquer campo fora do
contrato é tratado como resposta inválida. As funções levantam ``ValueError``.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.services.mobile_sync import (
    ENTITY_FIELDS,
    FORBIDDEN_KEYS,
    MAX_MUTATIONS,
    MAX_PAGE_SIZE,
    MAX_PATH_DEPTH,
    MAX_SAFE_INTEGER,
    PROTOCOL_VERSION,
    SyncMutation,
    allowed_record_fields,
    strict_int,
    validate_json_value,
)

Row = dict[str, Any]
CAMPAIGN_FIELDS = frozenset({"id", "owner_id", "name", "description", "updated_at"})
RESULT_STATUSES = frozenset({"applied", "duplicate", "conflict", "denied", "invalid", "dependency_failed"})
RESULT_FIELDS = frozenset({"operation_id", "status", "record", "conflict_paths", "message"})
CHANGE_FIELDS = frozenset({"revision", "version", "entity_type", "entity_id", "action", "record", "tombstone"})
MAX_CONFLICT_PATHS = 200
MAX_RESULT_MESSAGE = 500


def campaign_row(row: Any) -> Row:
    if type(row) is not dict or set(row) != CAMPAIGN_FIELDS:
        raise ValueError("campanha inválida")
    UUID(row["id"])
    UUID(row["owner_id"])
    if not all(type(row[key]) is str for key in ("name", "description", "updated_at")):
        raise ValueError("campanha inválida")
    return row


def sync_record(record: Any, entity_type: str | None = None, campaign_id: UUID | None = None) -> Row:
    if type(record) is not dict or set(record) != {"entity_type", "entity_id", "version", "data"}:
        raise ValueError("record inválido")
    kind = record["entity_type"]
    if type(kind) is not str or kind not in ENTITY_FIELDS or (entity_type is not None and kind != entity_type):
        raise ValueError("entity_type inválido")
    UUID(record["entity_id"])
    strict_int(record["version"], minimum=1, maximum=MAX_SAFE_INTEGER, label="version")
    data = record["data"]
    if type(data) is not dict or set(data) != allowed_record_fields(kind):
        raise ValueError("dados do record inválidos")
    validate_json_value(data)
    if "id" not in data or UUID(data["id"]) != UUID(record["entity_id"]):
        raise ValueError("ID do record inválido")
    if kind != "campaigns" and "campaign_id" not in data:
        raise ValueError("vínculo da campanha ausente")
    if campaign_id is not None and "campaign_id" in data and UUID(data["campaign_id"]) != campaign_id:
        raise ValueError("record fora da campanha solicitada")
    if campaign_id is not None and kind == "campaigns" and UUID(record["entity_id"]) != campaign_id:
        raise ValueError("campanha do record inválida")
    return record


def _valid_conflict_path(path: Any) -> bool:
    if type(path) is not list or not 1 <= len(path) <= MAX_PATH_DEPTH:
        return False
    return all(
        type(part) is str and part and part.strip() == part and not part.isdecimal() and part.lower() not in FORBIDDEN_KEYS
        for part in path
    )


def _push_result(result: Any, operation: SyncMutation, campaign_id: UUID) -> Row:
    if type(result) is not dict or set(result) - RESULT_FIELDS:
        raise ValueError("resultado inválido")
    if str(UUID(result["operation_id"])) != str(operation.operation_id):
        raise ValueError("ordem ou operation_id inválido")
    if result.get("status") not in RESULT_STATUSES:
        raise ValueError("status inválido")
    output = {"operation_id": result["operation_id"], "status": result["status"]}
    if "record" in result:
        record = sync_record(result["record"], campaign_id=campaign_id)
        if record["entity_type"] != operation.entity_type or UUID(record["entity_id"]) != operation.entity_id:
            raise ValueError("record não corresponde à operação")
        output["record"] = record
    if "conflict_paths" in result:
        paths = result["conflict_paths"]
        if type(paths) is not list or len(paths) > MAX_CONFLICT_PATHS or not all(_valid_conflict_path(path) for path in paths):
            raise ValueError("conflict_paths inválido")
        output["conflict_paths"] = paths
    if "message" in result:
        if type(result["message"]) is not str or len(result["message"]) > MAX_RESULT_MESSAGE:
            raise ValueError("message inválida")
        output["message"] = result["message"]
    return output


def push_response(value: Any, campaign_id: UUID, operations: list[SyncMutation]) -> Row:
    if type(value) is not dict or set(value) != {"protocol_version", "campaign_id", "cursor", "results"}:
        raise ValueError("envelope inválido")
    if type(value["protocol_version"]) is not int or value["protocol_version"] != PROTOCOL_VERSION:
        raise ValueError("versão inválida")
    if UUID(value["campaign_id"]) != campaign_id:
        raise ValueError("campanha inválida")
    strict_int(value["cursor"], minimum=0, maximum=MAX_SAFE_INTEGER, label="cursor")
    results = value["results"]
    if type(results) is not list or len(results) > MAX_MUTATIONS or len(results) != len(operations):
        raise ValueError("resultados inválidos")
    checked = [_push_result(result, operations[index], campaign_id) for index, result in enumerate(results)]
    return {"protocol_version": PROTOCOL_VERSION, "campaign_id": str(campaign_id), "cursor": value["cursor"], "results": checked}


def _envelope(value: Any, campaign_id: UUID, extra: set[str]) -> None:
    if type(value) is not dict or set(value) != {"protocol_version", "campaign_id", "cursor", "has_more"} | extra:
        raise ValueError("envelope inválido")
    if type(value["protocol_version"]) is not int or value["protocol_version"] != PROTOCOL_VERSION or UUID(value["campaign_id"]) != campaign_id:
        raise ValueError("versão ou campanha inválida")
    strict_int(value["cursor"], minimum=0, maximum=MAX_SAFE_INTEGER, label="cursor")
    if type(value["has_more"]) is not bool:
        raise ValueError("has_more inválido")


def snapshot_page(value: Any, campaign_id: UUID, entity_type: str) -> Row:
    _envelope(value, campaign_id, {"records", "next_after_id"})
    records = value["records"]
    if type(records) is not list or len(records) > MAX_PAGE_SIZE:
        raise ValueError("records inválido")
    checked = [sync_record(record, entity_type, campaign_id) for record in records]
    after = value["next_after_id"]
    if after is not None:
        UUID(after)
    if checked and UUID(after) != UUID(checked[-1]["entity_id"]):
        raise ValueError("next_after_id não corresponde à última linha")
    if value["has_more"] and (not checked or after is None):
        raise ValueError("cursor da página inválido")
    return {
        "protocol_version": PROTOCOL_VERSION, "campaign_id": str(campaign_id), "cursor": value["cursor"],
        "has_more": value["has_more"], "next_after_id": after, "records": checked,
    }


def _change(change: Any, campaign_id: UUID, cursor: int, previous_revision: int | None) -> Row:
    if type(change) is not dict or set(change) - CHANGE_FIELDS:
        raise ValueError("change inválido")
    revision = strict_int(change.get("revision"), minimum=1, maximum=MAX_SAFE_INTEGER, label="revision")
    if revision > cursor or (previous_revision is not None and revision <= previous_revision):
        raise ValueError("revisões fora de ordem ou além do cursor")
    version = strict_int(change.get("version"), minimum=1, maximum=MAX_SAFE_INTEGER, label="version")
    kind = change.get("entity_type")
    if type(kind) is not str or kind not in ENTITY_FIELDS:
        raise ValueError("entity_type inválido")
    UUID(change.get("entity_id"))
    action = change.get("action")
    if action not in {"create", "update", "delete"}:
        raise ValueError("action inválida")
    if "record" in change:
        record = sync_record(change["record"], kind, campaign_id)
        if record["version"] < version or UUID(record["entity_id"]) != UUID(change["entity_id"]):
            raise ValueError("versão do record anterior à mudança")
    if action == "delete":
        if change.get("tombstone") is not True or "record" in change:
            raise ValueError("tombstone inválido")
    elif "record" not in change or "tombstone" in change:
        raise ValueError("record de mudança ausente ou tombstone inesperado")
    return change


def changes_page(value: Any, campaign_id: UUID) -> Row:
    _envelope(value, campaign_id, {"changes"})
    changes = value["changes"]
    if type(changes) is not list or len(changes) > MAX_PAGE_SIZE:
        raise ValueError("changes inválido")
    checked: list[Row] = []
    for change in changes:
        checked.append(_change(change, campaign_id, value["cursor"], checked[-1]["revision"] if checked else None))
    return {
        "protocol_version": PROTOCOL_VERSION, "campaign_id": str(campaign_id), "cursor": value["cursor"],
        "has_more": value["has_more"], "changes": checked,
    }
