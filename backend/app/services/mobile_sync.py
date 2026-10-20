from __future__ import annotations

import json
import math
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator, model_validator


PROTOCOL_VERSION = 1
MAX_SAFE_INTEGER = 2**53 - 1
MAX_MUTATIONS = 50
MAX_CHANGES = 200
MAX_PATH_DEPTH = 12
MAX_OPERATION_BYTES = 32 * 1024
MAX_PAGE_SIZE = 200
FORBIDDEN_KEYS = {"__proto__", "prototype", "constructor"}

# Only database tables with campaign-scoped records accepted by the sync RPC
# belong here. Field sets exclude server-managed identity and audit columns.
ENTITY_FIELDS: dict[str, frozenset[str]] = {
    "campaigns": frozenset({"name", "description"}),
    "character_inventory": frozenset({"sheet_id", "name", "category", "quantity", "resource_cost", "damage_bonus", "protection", "notes", "acquired", "equipped", "sort_order"}),
    "system_templates": frozenset({"name", "schema", "page_references"}),
    "character_sheets": frozenset({"template_id", "name", "values"}),
    "world_entities": frozenset({"kind", "name", "body"}),
    "world_relations": frozenset({"from_entity_id", "to_entity_id", "relation_type", "notes"}),
    "maps": frozenset({"name", "document", "grid_kind", "isometric"}),
    "map_pins": frozenset({"map_id", "entity_id", "x", "y", "label"}),
    "combat_sessions": frozenset({"map_id", "title", "state", "active"}),
    "campaign_sessions": frozenset({"sequence", "title", "summary", "status", "played_on"}),
    "campaign_factions": frozenset({"name", "description", "goal", "tension", "limit", "consequence"}),
    "campaign_events": frozenset({"session_id", "faction_id", "title", "description", "occurred_on", "status"}),
}

READ_ONLY_ENTITIES = frozenset()

JSON_FIELDS: dict[str, frozenset[str]] = {
    "character_sheets": frozenset({"values"}),
    "system_templates": frozenset({"schema"}),
    "world_entities": frozenset({"body"}),
    "maps": frozenset({"document"}),
    "combat_sessions": frozenset({"state"}),
}


def _json_value(value: Any, *, depth: int = 0) -> None:
    if depth > 32:
        raise ValueError("JSON excede a profundidade permitida")
    if value is None or type(value) in {str, bool, int}:
        return
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError("JSON não aceita NaN ou infinito")
        return
    if type(value) is list:
        for item in value:
            _json_value(item, depth=depth + 1)
        return
    if type(value) is dict:
        for key, item in value.items():
            if type(key) is not str or not key or key.lower() in FORBIDDEN_KEYS:
                raise ValueError("chave JSON inválida")
            _json_value(item, depth=depth + 1)
        return
    raise ValueError("valor precisa ser JSON válido")


def validate_json_value(value: Any) -> None:
    _json_value(value)


class ValueState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    exists: StrictBool
    value: Any = None

    @model_validator(mode="after")
    def check_presence(self) -> "ValueState":
        if not self.exists and "value" in self.model_fields_set:
            raise ValueError("value deve faltar quando exists é false")
        if self.exists and "value" not in self.model_fields_set:
            raise ValueError("value é obrigatório quando exists é true")
        if self.exists:
            _json_value(self.value)
        return self


class SyncChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: list[StrictStr] = Field(min_length=1, max_length=MAX_PATH_DEPTH)
    before: ValueState
    after: ValueState

    @field_validator("path")
    @classmethod
    def check_path(cls, value: list[str]) -> list[str]:
        if any(not key or key.strip() != key or key.lower() in FORBIDDEN_KEYS or key.isdecimal() for key in value):
            raise ValueError("caminho contém chave vazia, proibida ou índice de array")
        return value


class SyncMutation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation_id: UUID
    entity_type: StrictStr
    entity_id: UUID
    action: Literal["create", "update", "delete"]
    base_version: StrictInt = Field(ge=0, le=MAX_SAFE_INTEGER)
    changes: list[SyncChange] = Field(max_length=MAX_CHANGES)
    depends_on: list[UUID] = Field(max_length=MAX_MUTATIONS)

    @model_validator(mode="after")
    def check_shape(self) -> "SyncMutation":
        if self.entity_type not in ENTITY_FIELDS or self.entity_type in READ_ONLY_ENTITIES:
            raise ValueError("entidade não aceita sincronização")
        if self.action == "create" and self.base_version != 0:
            raise ValueError("create exige base_version zero")
        if self.action != "create" and self.base_version < 1:
            raise ValueError("update e delete exigem base_version positiva")
        if self.action == "delete" and self.changes:
            raise ValueError("delete não aceita changes")
        if self.action != "delete" and not self.changes:
            raise ValueError("operação exige ao menos uma mudança")
        paths = [tuple(change.path) for change in self.changes]
        if len(paths) != len(set(paths)):
            raise ValueError("caminhos repetidos")
        for index, path in enumerate(paths):
            if any(path[:len(other)] == other or other[:len(path)] == path for other in paths[index + 1:]):
                raise ValueError("caminhos sobrepostos")
        if len(set(self.depends_on)) != len(self.depends_on) or self.operation_id in self.depends_on:
            raise ValueError("depends_on inválido")
        self._check_fields()
        encoded = json.dumps(self.model_dump(mode="json", exclude_unset=True), ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_OPERATION_BYTES:
            raise ValueError("operação excede 32 KB")
        return self

    def _check_fields(self) -> None:
        allowed = ENTITY_FIELDS[self.entity_type]
        json_fields = JSON_FIELDS.get(self.entity_type, frozenset())
        for change in self.changes:
            root = change.path[0]
            if root not in allowed:
                raise ValueError("campo não permitido para esta entidade")
            if len(change.path) > 1 and root not in json_fields:
                raise ValueError("caminhos internos só são permitidos em campos JSON")
            if self.action == "create" and change.before.exists:
                raise ValueError("create exige before.exists false")


class SyncPushRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    protocol_version: StrictInt
    device_id: UUID
    mutations: list[SyncMutation] = Field(max_length=MAX_MUTATIONS)

    @model_validator(mode="after")
    def check_body(self) -> "SyncPushRequest":
        if self.protocol_version != PROTOCOL_VERSION:
            raise ValueError("protocol_version não suportado")
        operation_ids = [item.operation_id for item in self.mutations]
        if len(operation_ids) != len(set(operation_ids)):
            raise ValueError("operation_id repetido no lote")
        positions = {mutation.operation_id: index for index, mutation in enumerate(self.mutations)}
        for index, mutation in enumerate(self.mutations):
            if any(positions[dependency] >= index for dependency in mutation.depends_on if dependency in positions):
                raise ValueError("dependência do lote precisa apontar para operação anterior")
        _json_value(self.model_dump(mode="json"))
        return self


def strict_int(value: Any, *, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} fora dos limites")
    return value


def allowed_record_fields(entity_type: str) -> frozenset[str]:
    return {
        "campaigns": frozenset({"id", "owner_id", "name", "description", "created_at", "updated_at"}),
        "system_templates": frozenset({"id", "campaign_id", "owner_id", "source_id", "name", "version", "status", "schema", "page_references", "created_at", "approved_at"}),
        "character_sheets": frozenset({"id", "campaign_id", "template_id", "owner_id", "name", "values", "effects", "version", "updated_at"}),
        "character_inventory": frozenset({"id", "sheet_id", "campaign_id", "name", "category", "quantity", "resource_cost", "damage_bonus", "protection", "notes", "acquired", "equipped", "sort_order", "version", "updated_at"}),
        "world_entities": frozenset({"id", "campaign_id", "kind", "name", "body", "created_by", "version", "created_at", "updated_at"}),
        "world_relations": frozenset({"id", "campaign_id", "from_entity_id", "to_entity_id", "relation_type", "notes", "created_by"}),
        "maps": frozenset({"id", "campaign_id", "name", "document", "grid_kind", "isometric", "created_by", "version", "updated_at"}),
        "map_pins": frozenset({"id", "map_id", "entity_id", "campaign_id", "x", "y", "label"}),
        "campaign_sessions": frozenset({"id", "campaign_id", "sequence", "title", "summary", "status", "played_on", "created_at", "updated_at"}),
        "campaign_factions": frozenset({"id", "campaign_id", "name", "description", "goal", "tension", "limit", "consequence", "version", "created_at", "updated_at"}),
        "campaign_events": frozenset({"id", "campaign_id", "session_id", "faction_id", "title", "description", "occurred_on", "status", "created_at", "updated_at"}),
        "combat_sessions": frozenset({"id", "campaign_id", "map_id", "title", "state", "active", "created_by", "version", "created_at"}),
    }[entity_type]
