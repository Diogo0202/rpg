/** Regras puras do store mobile: chaves, leitura de caminhos e conversão de registros em entidades. */

import {
  SyncHttpError,
  fieldValuesEqual,
  type FieldValue,
  type JsonValue,
  type OutboxEntry,
  type SyncChange,
  type SyncRecord,
  type SyncState,
} from "@/lib/mobile-sync/index.ts";
import type { Entity } from "./context";
import { fromRemoteRecord } from "./remote-adapter";

type JsonObject = Record<string, JsonValue>;

/** Tabelas remotas que a interface conhece por outro nome. */
export const REMOTE_TO_UI: Record<string, string> = {
  campaign_sessions: "journal_sessions",
  campaign_events: "journal_notes",
};

export const entityKey = (type: string, id: string) => `${type}\u0000${id}`;
export const uiType = (remoteType: string) => REMOTE_TO_UI[remoteType] ?? remoteType;

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function fieldValue(value: JsonValue | undefined, clone = false): FieldValue {
  return value === undefined ? { exists: false } : { exists: true, value: clone ? cloneJson(value) : value };
}

export function readPath(data: JsonObject | undefined, path: string[]): FieldValue {
  let node: JsonValue | undefined = data;
  for (const part of path) {
    if (!isJsonObject(node) || !Object.prototype.hasOwnProperty.call(node, part)) return { exists: false };
    node = node[part];
  }
  return fieldValue(node);
}

export function httpStatusOf(error: unknown): number | undefined {
  return error instanceof SyncHttpError ? error.status : undefined;
}

/** Falha de rede (status 0 ou fetch recusado), diferente de uma recusa da API. */
export function isNetworkError(error: unknown): boolean {
  return httpStatusOf(error) === 0 || (error instanceof TypeError && /fetch|network/i.test(error.message));
}

/** Pares [tipo remoto, id] de tudo o que existe no cache ou ainda está na fila. */
export function knownEntityIds(state: SyncState): Array<[string, string]> {
  const ids = new Map<string, [string, string]>();
  for (const record of Object.values(state.records))
    ids.set(entityKey(uiType(record.entity_type), record.id), [record.entity_type, record.id]);
  for (const { mutation } of state.outbox)
    ids.set(entityKey(uiType(mutation.entity_type), mutation.entity_id), [mutation.entity_type, mutation.entity_id]);
  return [...ids.values()];
}

export function templatesById(state: SyncState): Map<string, JsonObject> {
  return new Map(Object.values(state.records)
    .filter((record) => record.entity_type === "system_templates" && !record.deleted)
    .map((record) => [record.id, record.data]));
}

/** Copia sistema, nome, versão e campos do modelo para a ficha, como a tela espera. */
function withTemplate(data: JsonObject, template: JsonObject | undefined): JsonObject {
  if (template) {
    data.system_key = typeof template.system_key === "string" ? template.system_key : String(data.template_id);
    data.template_name = typeof template.name === "string" ? template.name : "Modelo da campanha";
    data.template_version = typeof template.version === "number" ? template.version : 1;
    const schema = template.schema;
    if (isJsonObject(schema) && Array.isArray(schema.fields)) {
      data.template_fields = schema.fields;
      if (typeof schema.system_key === "string") data.system_key = schema.system_key;
      if (schema.system_key === "one-ring") data.template_schema = schema;
    }
  }
  if (!Array.isArray(data.effects)) data.effects = [];
  return data;
}

/** Converte um registro do cache na entidade da interface, com as marcas de pendência e conflito. */
export function toEntity(
  remoteType: string,
  record: SyncRecord,
  state: SyncState,
  connected: boolean,
  templates: Map<string, JsonObject>,
): Entity {
  const type = uiType(remoteType);
  const adapted = connected ? fromRemoteRecord(type, record) : record;
  let data = { ...adapted.data } as JsonObject;
  if (type === "character_sheets" && connected) data = withTemplate(data, templates.get(String(data.template_id)));
  const pending = state.outbox.filter((entry) => entry.mutation.entity_type === remoteType && entry.mutation.entity_id === record.id);
  const intents = remoteType === "character_sheets" ? (state.adjustments ?? []).filter((intent) => intent.sheet_id === record.id) : [];
  return {
    type,
    id: record.id,
    version: record.version,
    data,
    pending: pending.length > 0 || intents.some((intent) => intent.state === "queued" || intent.state === "inflight"),
    conflict: pending.some((entry) => entry.state === "conflict") || intents.some((intent) => intent.state === "invalid" || intent.state === "denied"),
  };
}

const isPositiveInteger = (value: JsonValue | undefined): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Próximo número de sessão, contando as salvas e as que ainda estão na fila. */
export function nextSessionSequence(state: SyncState): number {
  const sequences = Object.values(state.records)
    .filter((record) => record.entity_type === "campaign_sessions" && !record.deleted)
    .map((record) => record.data.sequence)
    .filter(isPositiveInteger);
  for (const { mutation } of state.outbox) {
    if (mutation.entity_type !== "campaign_sessions" || mutation.action === "delete") continue;
    for (const change of mutation.changes)
      if (change.path.length === 1 && change.path[0] === "sequence" && change.after.exists && isPositiveInteger(change.after.value))
        sequences.push(change.after.value);
  }
  return Math.max(0, ...sequences) + 1;
}

/** Operações ainda não aceitas de uma entidade, para encadear uma criação dependente. */
export function pendingOperationIds(outbox: OutboxEntry[], entityType: string, entityId: string): string[] {
  return outbox
    .filter((entry) => entry.mutation.entity_type === entityType && entry.mutation.entity_id === entityId && entry.state !== "accepted")
    .map((entry) => entry.mutation.operation_id);
}

export function creationChanges(data: JsonObject): SyncChange[] {
  return Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ path: [key], before: { exists: false }, after: { exists: true, value: cloneJson(value) } }));
}

/** Campos numéricos do modelo e os que o servidor controla (experiência e moedas de criação). */
export function sheetFieldRoles(schema: JsonObject): { numeric: Set<string>; managed: Set<string> } {
  const numeric = new Set<string>();
  const managed = new Set<string>();
  if (Array.isArray(schema.fields))
    for (const field of schema.fields)
      if (isJsonObject(field) && typeof field.id === "string" && field.kind === "number") numeric.add(field.id);
  if (typeof schema.experience_field === "string") managed.add(schema.experience_field);
  if (Array.isArray(schema.meta_currencies))
    for (const item of schema.meta_currencies)
      if (isJsonObject(item) && typeof item.field === "string") managed.add(item.field);
  return { numeric, managed };
}

export type SheetDelta = { fieldId: string; delta: number };

/** Maior ajuste numérico que vai como delta atômico; acima disso, a troca é gravada por valor. */
const MAX_ATOMIC_DELTA = 1000;

/**
 * Divide a troca de valores de uma ficha: números livres pequenos viram ajustes atômicos,
 * que o servidor soma mesmo com edições concorrentes; o resto vira troca de caminho.
 */
export function sheetValueChanges(
  prior: JsonObject,
  next: JsonObject,
  roles: { numeric: Set<string>; managed: Set<string> },
): { deltas: SheetDelta[]; changes: SyncChange[] } {
  const deltas: SheetDelta[] = [];
  const changes: SyncChange[] = [];
  for (const fieldId of new Set([...Object.keys(prior), ...Object.keys(next)])) {
    const before = prior[fieldId];
    const after = next[fieldId];
    if (before === after) continue;
    const atomic = roles.numeric.has(fieldId) && !roles.managed.has(fieldId)
      && (before === undefined || (typeof before === "number" && Number.isSafeInteger(before)))
      && typeof after === "number" && Number.isSafeInteger(after);
    if (atomic) {
      const delta = after - (typeof before === "number" ? before : 0);
      if (delta !== 0 && Math.abs(delta) <= MAX_ATOMIC_DELTA) deltas.push({ fieldId, delta });
      else if (delta !== 0) changes.push({ path: ["values", fieldId], before: fieldValue(before), after: fieldValue(after) });
    } else if (!fieldValuesEqual(fieldValue(before), fieldValue(after))) {
      changes.push({ path: ["values", fieldId], before: fieldValue(before, true), after: fieldValue(after, true) });
    }
  }
  return { deltas, changes };
}

export function outboxSummary(state: SyncState | null) {
  const out = state?.outbox ?? [];
  const adjustments = state?.adjustments ?? [];
  return {
    total: out.length + adjustments.length,
    queued: out.filter((entry) => entry.state === "queued" || entry.state === "inflight").length
      + adjustments.filter((intent) => intent.state === "queued" || intent.state === "inflight").length,
    conflicts: out.filter((entry) => entry.state === "conflict").length,
    blocked: out.filter((entry) => ["denied", "invalid", "dependency_failed"].includes(entry.state)).length
      + adjustments.filter((intent) => intent.state === "denied" || intent.state === "invalid").length,
  };
}
