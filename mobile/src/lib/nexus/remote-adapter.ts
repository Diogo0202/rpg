import type { JsonValue, SyncRecord } from "@/lib/mobile-sync/index.ts";

export type RemotePathSet = { path: string[]; value: JsonValue | undefined };

const remoteNames: Record<string, string> = { journal_sessions: "campaign_sessions", journal_notes: "campaign_events" };
const supportedRemoteEntities = new Set([
  "campaigns", "system_templates", "character_sheets", "character_inventory", "world_entities", "world_relations",
  "maps", "map_pins", "campaign_sessions", "campaign_factions", "campaign_events", "combat_sessions",
]);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function remoteEntityType(type: string): string {
  const mapped = remoteNames[type] ?? type;
  if (mapped === "campaign_state" || mapped === "music_links" || !supportedRemoteEntities.has(mapped)) {
    throw new Error(`${type} fica somente neste aparelho; a API móvel não aceita este tipo de registro.`);
  }
  return mapped;
}

export function fromRemoteRecord(type: string, record: SyncRecord): SyncRecord {
  const entityType = remoteNames[type] ?? type;
  const data = { ...record.data } as Record<string, JsonValue>;
  for (const key of ["id", "campaign_id", "owner_id", "created_by", "created_at", "updated_at", "sync_version"]) delete data[key];
  if (entityType !== "system_templates") { delete data.version; }
  if (entityType === "world_entities") {
    const body = object(data.body);
    data.description = typeof body.description === "string" ? body.description : "";
    data.tags = Array.isArray(body.tags) && body.tags.every((tag) => typeof tag === "string") ? body.tags : [];
  } else if (entityType === "maps") {
    const document = object(data.document);
    if (typeof document.width === "number") data.columns = document.width;
    if (typeof document.height === "number") data.rows = document.height;
    if (typeof document.description === "string") data.description = document.description;
  } else if (entityType === "map_pins") {
    data.map_id = typeof data.map_id === "string" ? data.map_id : "";
    data.note = "";
  } else if (entityType === "campaign_sessions") {
    data.session_date = typeof data.played_on === "string" ? data.played_on : "";
  } else if (entityType === "campaign_events") {
    data.body = typeof data.description === "string" ? data.description : "";
  }
  return { ...record, data };
}

function assertOnlyKeys(data: Record<string, JsonValue>, allowed: readonly string[], entity: string): void {
  const extra = Object.keys(data).filter((key) => !allowed.includes(key));
  if (extra.length) throw new Error(`${entity}: campo(s) sem suporte remoto: ${extra.join(", ")}.`);
}

export function toRemoteCreate(type: string, input: Record<string, JsonValue>): { entityType: string; data: Record<string, JsonValue> } {
  const entityType = remoteEntityType(type), data = { ...input };
  if (entityType === "character_sheets") {
    assertOnlyKeys(data, ["template_id", "name", "values"], "Ficha");
    if (typeof data.template_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.template_id)) throw new Error("A ficha precisa usar o ID de um modelo aprovado da campanha.");
    if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 120 || !data.values || typeof data.values !== "object" || Array.isArray(data.values)) throw new Error("Nome ou valores de ficha inválidos.");
  } else if (entityType === "character_inventory") {
    assertOnlyKeys(data, ["sheet_id", "name", "category", "quantity", "resource_cost", "damage_bonus", "protection", "notes", "acquired", "equipped", "sort_order", "custom_values"], "Inventário");
  } else if (entityType === "world_entities") {
    assertOnlyKeys(data, ["kind", "name", "description", "tags", "body"], "Entidade");
    const body = object(data.body);
    const description = data.description ?? body.description ?? "";
    const tags = data.tags ?? body.tags ?? [];
    if (typeof description !== "string" || !Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) throw new Error("Descrição ou tags da entidade são inválidas.");
    data.body = { ...body, description, tags } as JsonValue;
    delete data.description; delete data.tags;
  } else if (entityType === "maps") {
    assertOnlyKeys(data, ["name", "columns", "rows", "description", "document", "grid_kind", "isometric"], "Mapa");
    const document = object(data.document);
    const columns = data.columns ?? document.width, rows = data.rows ?? document.height;
    const description = data.description ?? document.description;
    if (columns !== undefined && (!Number.isInteger(columns) || Number(columns) < 1 || Number(columns) > 128)) throw new Error("A largura do mapa precisa ser um inteiro entre 1 e 128.");
    if (rows !== undefined && (!Number.isInteger(rows) || Number(rows) < 1 || Number(rows) > 128)) throw new Error("A altura do mapa precisa ser um inteiro entre 1 e 128.");
    data.document = {
      ...document,
      ...(columns !== undefined ? { width: columns } : {}),
      ...(rows !== undefined ? { height: rows } : {}),
      ...(description !== undefined ? { description } : {}),
      layers: document.layers ?? [], markers: document.markers ?? [], grid_enabled: document.grid_enabled ?? true,
    } as unknown as JsonValue;
    delete data.columns; delete data.rows; delete data.description;
  } else if (entityType === "map_pins") {
    assertOnlyKeys(data, ["map_id", "entity_id", "label", "x", "y", "note"], "Marcador");
    if (data.note) throw new Error("A API não tem campo de nota para marcadores; remova a nota antes de salvar.");
    if (typeof data.entity_id !== "string") throw new Error("Marcadores remotos precisam estar vinculados a uma entidade da campanha.");
    delete data.note;
  } else if (entityType === "campaign_sessions") {
    assertOnlyKeys(data, ["title", "summary", "status", "played_on", "sequence", "session_date"], "Sessão");
    if (typeof data.session_date === "string" && data.played_on === undefined) data.played_on = data.session_date;
    if (data.sequence === undefined) throw new Error("A sessão precisa de um número de sequência calculado pelo armazenamento da campanha.");
    if (!Number.isSafeInteger(data.sequence) || Number(data.sequence) < 1) throw new Error("Sequência da sessão inválida.");
    data.status ??= "planned";
    delete data.session_date;
  } else if (entityType === "campaign_events") {
    assertOnlyKeys(data, ["session_id", "faction_id", "title", "description", "occurred_on", "status", "body"], "Evento");
    if (data.description === undefined && data.body !== undefined) data.description = data.body;
    delete data.body;
  } else if (entityType === "campaign_state" || entityType === "music_links") {
    throw new Error(`${type} fica somente neste aparelho.`);
  } else if (entityType === "system_templates") {
    assertOnlyKeys(data, ["name", "schema", "page_references"], "Modelo");
  }
  return { entityType, data };
}

export function toRemotePath(type: string, path: string[], value: JsonValue | undefined): { entityType: string; path: string[]; value: JsonValue | undefined } | null {
  const entityType = remoteEntityType(type);
  if (type === "world_entities" && (path[0] === "description" || path[0] === "tags")) return { entityType, path: ["body", path[0], ...path.slice(1)], value };
  if (type === "maps" && path[0] === "columns") return { entityType, path: ["document", "width", ...path.slice(1)], value };
  if (type === "maps" && path[0] === "rows") return { entityType, path: ["document", "height", ...path.slice(1)], value };
  if (type === "maps" && path[0] === "description") return { entityType, path: ["document", "description", ...path.slice(1)], value };
  if (type === "map_pins" && path[0] === "note") {
    if (value) throw new Error("A API não tem campo de nota para marcadores; remova a nota antes de salvar.");
    return null;
  }
  if (type === "journal_sessions" && path[0] === "session_date") return { entityType, path: ["played_on", ...path.slice(1)], value };
  if (type === "journal_notes" && path[0] === "body") return { entityType, path: ["description", ...path.slice(1)], value };
  if (type === "campaign_state" || type === "music_links") throw new Error(`${type} fica somente neste aparelho.`);
  return { entityType, path, value };
}

export function makeSheetStarter(template: { id: string; name: string; version: number; schema: JsonValue }) {
  const schema = object(template.schema);
  if (schema.rules_profile_version != null) return null;
  if (!Array.isArray(schema.fields) || schema.fields.length < 1 || schema.fields.length > 200) return null;
  const fields = schema.fields as Record<string, unknown>[];
  if (fields.some((field) => !field || typeof field.id !== "string" || typeof field.label !== "string" || !["text", "number", "select", "checkbox", "collection", "formula", "roll"].includes(String(field.kind)))) return null;
  const normalized = fields.map((field) => ({
    required: false, options: [], expression: null, ...field,
  }));
  // Creation rules travel with the template: the database checks them when the sheet is created.
  const rules = Array.isArray(schema.creation_rules) ? { creation_rules: schema.creation_rules } : {};
  return {
    id: template.id, label: template.name, templateId: template.id, systemKey: template.id,
    template: { name: template.name, version: template.version, fields: normalized, ...rules,
      ...(typeof schema.system_key === "string" ? { system_key: schema.system_key } : {}),
    } as unknown as import("@/lib/sheet-template.ts").SheetTemplate,
    values: {} as Record<string, string | number | boolean | string[]>,
  };
}
