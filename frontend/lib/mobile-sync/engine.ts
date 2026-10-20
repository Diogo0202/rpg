import { fieldValuesEqual, projectRecord, validateChanges } from "./merge.ts";
import { pendingEntries } from "./store.ts";
import type { EnqueueInput, JsonValue, OutboxEntry, SyncChange, SyncConfig, SyncMutation, SyncPartition, SyncRecord, SyncResult, SyncState, SyncStore, SyncTransport } from "./types.ts";

const entityKey = (type: string, id: string) => JSON.stringify([type, id]);
const copy = <T>(value: T): T => structuredClone(value);
const uuid = (): string => {
  if (!globalThis.crypto?.randomUUID) throw new Error("crypto.randomUUID is required for sync IDs");
  return globalThis.crypto.randomUUID();
};
export const createOperationId = uuid;
export const createDeviceId = uuid;
export const createEntityId = uuid;
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const entityName = /^[a-z][a-z0-9_]{0,63}$/;

function fieldAt(record: SyncRecord | undefined, path: string[]): { exists: false } | { exists: true; value: JsonValue } {
  let node: JsonValue | undefined = record?.data;
  for (const segment of path) {
    if (!node || typeof node !== "object" || Array.isArray(node) || !Object.prototype.hasOwnProperty.call(node, segment)) return { exists: false };
    node = node[segment];
  }
  return node === undefined ? { exists: false } : { exists: true, value: node };
}
function mutationBytes(mutation: SyncMutation): number { return new TextEncoder().encode(JSON.stringify(mutation)).byteLength; }
function projectMutation(record: SyncRecord | undefined, mutation: SyncMutation): SyncRecord | undefined {
  const nextVersion = (record?.version ?? mutation.base_version) + 1;
  if (mutation.action === "delete") return { entity_type: mutation.entity_type, id: mutation.entity_id, version: nextVersion, data: {}, deleted: true };
  const projected = projectRecord(record, mutation.changes);
  if (!projected) return undefined;
  projected.entity_type = mutation.entity_type;
  projected.id = mutation.entity_id;
  projected.version = mutation.action === "create" ? 1 : nextVersion;
  return projected;
}
function cursorAtOrPast(cursor: string | null, target: string | undefined): boolean {
  if (cursor === null || target === undefined) return false;
  if (cursor === target) return true;
  if (/^(0|[1-9][0-9]*)$/.test(cursor) && /^(0|[1-9][0-9]*)$/.test(target)) return BigInt(cursor) >= BigInt(target);
  return false;
}
function httpStatus(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error ? Number((error as { status: unknown }).status) : undefined;
}
function asRecord(record: SyncRecord | null | undefined, entityType?: string, entityId?: string): SyncRecord | undefined {
  if (!record) return undefined;
  return { ...copy(record), id: record.id ?? record.entity_id ?? entityId ?? "", entity_type: record.entity_type ?? entityType ?? "" };
}

export interface SyncReport { sent: number; applied: number; conflicts: string[]; blocked: boolean; retryAt?: number; reason?: "reauth_required" | "revoked" | "retry_later" | "network" }

export class SyncEngine {
  readonly partition: SyncPartition;
  private readonly config: SyncConfig;
  private readonly store: SyncStore;
  private readonly transport: SyncTransport;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly maxBatch: number;
  private readonly maxBatchBytes: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly leaseOwner = uuid();

  constructor(config: SyncConfig, store: SyncStore, transport: SyncTransport) {
    if (!config.entityFields || typeof config.entityFields !== "object" || Array.isArray(config.entityFields)) throw new Error("entityFields must come from campaign capabilities");
    const entityFields: Record<string, string[]> = Object.create(null);
    for (const [entityType, fields] of Object.entries(config.entityFields)) {
      if (!entityName.test(entityType) || !Array.isArray(fields) || fields.length > 200 || fields.some((field) => typeof field !== "string" || !entityName.test(field)) || new Set(fields).size !== fields.length) throw new Error("invalid campaign capability list");
      entityFields[entityType] = fields.slice();
    }
    this.config = { ...config, entityFields }; this.store = store; this.transport = transport;
    if (!isUuid(config.deviceId)) throw new Error("deviceId must be a UUID from the local store");
    this.partition = { accountId: config.accountId, campaignId: config.campaignId, deviceId: config.deviceId };
    this.now = config.now ?? Date.now;
    this.makeId = config.randomUUID ?? uuid;
    this.maxBatch = Math.min(50, Math.max(1, config.maxBatch ?? 50));
    this.maxBatchBytes = Math.min(1024 * 1024, Math.max(32768, config.maxBatchBytes ?? 1024 * 1024));
    this.retryBaseMs = config.retryBaseMs ?? 1000;
    this.retryMaxMs = config.retryMaxMs ?? 60000;
  }

  readState(): Promise<SyncState> { return this.store.read(this.partition); }

  async getRecord(entityType: string, entityId: string): Promise<SyncRecord | undefined> {
    const state = await this.store.read(this.partition), key = entityKey(entityType, entityId);
    let record = state.records[key] ? copy(state.records[key]) : undefined;
    for (const entry of state.outbox) {
      const mutation = entry.mutation;
      if (mutation.entity_type !== entityType || mutation.entity_id !== entityId) continue;
      record = projectMutation(record, mutation);
    }
    return record;
  }

  async enqueue(input: EnqueueInput): Promise<SyncMutation> {
    if (!["create", "update", "delete"].includes(input.action)) throw new Error("invalid sync action");
    const allowed = this.config.entityFields[input.entityType];
    if (!allowed) throw new Error(`entity type is not enabled: ${input.entityType}`);
    const entityId = input.entityId ?? (input.action === "create" ? this.makeId() : "");
    if (!isUuid(entityId)) throw new Error("entityId must be a UUID");
    if (input.action === "delete" && (input.changes?.length ?? 0) !== 0) throw new Error("delete cannot contain changes");
    const changes = input.action === "delete" ? [] : validateChanges(input.changes ?? [], allowed);
    if (input.action !== "delete" && changes.length === 0) throw new Error("create/update needs changes");
    const opId = this.makeId();
    if (!isUuid(opId)) throw new Error("operationId generator must return a UUID");
    return this.store.update(this.partition, (state) => {
      const key = entityKey(input.entityType, entityId);
      let projected = state.records[key] ? copy(state.records[key]) : undefined;
      const prior = state.outbox.filter((entry) => entry.mutation.entity_type === input.entityType && entry.mutation.entity_id === entityId);
      for (const entry of prior) {
        projected = projectMutation(projected, entry.mutation);
      }
      const exists = projected && !projected.deleted;
      if (input.action === "create" && exists) throw new Error("entity already exists in local projection");
      if (input.action !== "create" && !exists) throw new Error("entity does not exist in local projection");
      for (const change of changes) {
        const before = fieldAt(projected, change.path);
        if (!fieldValuesEqual(before, change.before)) throw new Error(`change before value does not match local projection at ${change.path.join(".")}`);
      }
      const dependsOn = [...new Set([...(input.dependsOn ?? []), ...prior.map((entry) => entry.mutation.operation_id)])];
      const mutation: SyncMutation = {
        operation_id: opId, entity_type: input.entityType, entity_id: entityId,
        action: input.action, base_version: input.action === "create" ? 0 : projected!.version,
        changes: copy(changes), depends_on: dependsOn,
      };
      if (mutationBytes(mutation) > 32768) throw new Error("operation exceeds 32 KB");
      const entry: OutboxEntry = { mutation, state: "queued", createdAt: this.now(), attempts: 0, nextAttemptAt: 0 };
      state.outbox.push(entry); state.updatedAt = this.now();
      return { result: copy(mutation), state };
    });
  }

  async applyRemote(event: { entity_type: string; entity_id: string; version: number; action: "upsert" | "delete"; record?: SyncRecord | null; tombstone?: boolean }): Promise<void> {
    await this.store.update(this.partition, (state) => {
      const key = entityKey(event.entity_type, event.entity_id), record = asRecord(event.record, event.entity_type, event.entity_id);
      if (record && event.action !== "delete" && !event.tombstone) {
        const current = state.records[key];
        if (!current || record.version >= current.version) state.records[key] = record;
      }
      else if (event.action === "delete" || event.tombstone) {
        const current = state.records[key];
        if (!current || event.version >= current.version) state.records[key] = { entity_type: event.entity_type, id: event.entity_id, version: event.version, data: {}, deleted: true };
      }
      const base = state.records[key];
      const touched: string[][] = [];
      const confirmed = new Set<string>();
      for (const entry of state.outbox) {
        const m = entry.mutation;
        if (m.entity_type !== event.entity_type || m.entity_id !== event.entity_id) continue;
        if (entry.state === "accepted") {
          const confirmsDelete = m.action === "delete" && !!base?.deleted && base.version >= m.base_version + 1;
          const confirmsWrite = m.action !== "delete" && !!base && !base.deleted && m.changes.every((change) => fieldValuesEqual(fieldAt(base, change.path), change.after));
          if (confirmsDelete || confirmsWrite) confirmed.add(m.operation_id);
          continue;
        }
        if (m.action === "delete") {
          if (base && !base.deleted && base.version !== m.base_version) { entry.state = "conflict"; entry.lastError = "delete base changed"; }
          continue;
        }
        const alreadyApplied = !!base && !base.deleted && m.changes.every((change) => fieldValuesEqual(fieldAt(base, change.path), change.after));
        const conflicting = alreadyApplied ? [] : m.changes.filter((change) => !touched.some((path) => path.length <= change.path.length && path.every((part, i) => change.path[i] === part)) && !fieldValuesEqual(fieldAt(base, change.path), change.before));
        if (conflicting.length) { entry.state = "conflict"; entry.lastError = `remote fields changed: ${conflicting.map((c) => c.path.join(".")).join(", ")}`; }
        touched.push(...m.changes.map((change) => change.path));
      }
      if (confirmed.size) state.outbox = state.outbox.filter((entry) => !confirmed.has(entry.mutation.operation_id));
      state.updatedAt = this.now();
      return { result: undefined, state };
    });
  }

  private async markRevoked(message = "campaign access revoked"): Promise<void> {
    await this.store.update(this.partition, (state) => {
      state.records = {};
      state.cursor = null;
      state.lease = undefined;
      for (const entry of state.outbox) {
        entry.state = "denied";
        entry.lastError = message;
      }
      state.updatedAt = this.now();
      return { result: undefined, state };
    });
  }

  async pull(): Promise<{ pages: number; applied: number }> {
    let state = await this.store.read(this.partition), pages = 0, applied = 0;
    while (true) {
      let page;
      try { page = await this.transport.changes(this.partition.campaignId, state.cursor ?? "", 100); }
      catch (error) {
        if (httpStatus(error) === 403) await this.markRevoked(error instanceof Error ? error.message : "campaign access revoked");
        throw error;
      }
      for (const event of page.changes) {
        await this.applyRemote({ ...event, action: event.action === "delete" || event.tombstone ? "delete" : "upsert" });
        applied++;
      }
      state = await this.store.update(this.partition, (current) => {
        current.cursor = page.cursor; current.updatedAt = this.now();
        current.outbox = current.outbox.filter((entry) => entry.state !== "accepted" || !cursorAtOrPast(page.cursor, entry.acceptedCursor));
        return { result: copy(current), state: current };
      });
      pages++;
      if (!page.has_more) break;
    }
    return { pages, applied };
  }

  async bootstrap(entityTypes: string[]): Promise<void> {
    const types = [...new Set(entityTypes)];
    if (!types.length) throw new Error("bootstrap requires entity types");
    let watermark: string | null = null;
    for (const type of types) {
      let afterId: string | undefined;
      do {
        let page;
        try { page = await this.transport.snapshot(this.partition.campaignId, type, afterId, 100); }
        catch (error) {
          if (httpStatus(error) === 403) await this.markRevoked(error instanceof Error ? error.message : "campaign access revoked");
          throw error;
        }
        watermark ??= page.cursor;
        for (const record of page.records) await this.applyRemote({ entity_type: type, entity_id: record.id ?? record.entity_id ?? "", version: record.version, action: "upsert", record });
        afterId = page.has_more ? page.next_after_id ?? undefined : undefined;
        if (page.has_more && !afterId) throw new Error("snapshot page is missing next_after_id");
      } while (afterId);
    }
    if (watermark !== null) await this.store.update(this.partition, (state) => { state.cursor = watermark; return { result: undefined, state }; });
    await this.pull();
  }

  async sync(): Promise<SyncReport> {
    let state = await this.store.read(this.partition);
    const claimed = await this.store.update(this.partition, (current) => {
      if (current.lease && current.lease.until > this.now()) return { result: null, state: current };
      if (current.lease && current.lease.until <= this.now()) {
        for (const entry of current.outbox) if (entry.state === "inflight") entry.state = "queued";
      }
      const candidates = pendingEntries(current).filter((entry) => entry.nextAttemptAt <= this.now() && !entry.mutation.depends_on.some((id) => current.outbox.some((candidate) => candidate.mutation.operation_id === id && ["conflict", "denied", "invalid", "dependency_failed"].includes(candidate.state))));
      const ready: OutboxEntry[] = [];
      for (const entry of candidates) {
        if (ready.length >= this.maxBatch) break;
        const next = [...ready.map((item) => item.mutation), entry.mutation];
        if (new TextEncoder().encode(JSON.stringify({ protocol_version: 1, device_id: this.partition.deviceId, mutations: next })).byteLength > this.maxBatchBytes) break;
        ready.push(entry);
      }
      if (!ready.length) { current.lease = undefined; return { result: [] as SyncMutation[], state: current }; }
      current.lease = { owner: this.leaseOwner, until: this.now() + 120000 };
      for (const entry of ready) { entry.state = "inflight"; entry.attempts++; }
      return { result: ready.map((entry) => copy(entry.mutation)), state: current };
    });
    if (claimed === null) return { sent: 0, applied: 0, conflicts: state.outbox.filter((e) => e.state === "conflict").map((e) => e.mutation.operation_id), blocked: true };
    if (!claimed.length) return { sent: 0, applied: 0, conflicts: state.outbox.filter((e) => e.state === "conflict").map((e) => e.mutation.operation_id), blocked: state.outbox.some((e) => ["conflict", "denied", "invalid", "dependency_failed"].includes(e.state)) };
    const mutations = claimed;
    const ids = new Set(mutations.map((mutation) => mutation.operation_id));
    const heartbeat = setInterval(() => {
      void this.store.update(this.partition, (current) => {
        if (current.lease?.owner === this.leaseOwner) current.lease.until = this.now() + 120000;
        return { result: undefined, state: current };
      }).catch(() => undefined);
    }, 30000);
    let response: { cursor?: string; results: SyncResult[] };
    try {
      response = await this.transport.push(this.partition.campaignId, { protocol_version: 1, device_id: this.partition.deviceId, mutations });
    } catch (error) {
      clearInterval(heartbeat);
      const http = error as { status?: number; retryAfterMs?: number; message?: string };
      const retryAt = await this.store.update(this.partition, (current) => {
        if (current.lease?.owner !== this.leaseOwner) return { result: 0, state: current };
        for (const entry of current.outbox) if (ids.has(entry.mutation.operation_id) || http.status === 403) {
          entry.state = http.status === 403 ? "denied" : "queued"; entry.lastError = http.message ?? "sync request failed";
          if (http.status === 403) continue;
          const exponent = Math.min(entry.attempts - 1, 10), jitter = Math.floor((this.config.randomUUID ? 0.5 : Math.random()) * this.retryBaseMs);
          const delay = Math.min(this.retryMaxMs, http.retryAfterMs ?? this.retryBaseMs * 2 ** exponent + jitter);
          entry.nextAttemptAt = this.now() + delay;
        }
        current.lease = undefined;
        if (http.status === 403) { current.records = {}; current.cursor = null; }
        return { result: Math.max(...current.outbox.filter((e) => ids.has(e.mutation.operation_id)).map((e) => e.nextAttemptAt), 0), state: current };
      });
      const reason = http.status === 403 ? "revoked" : http.status === 401 ? "reauth_required" : http.status === 429 || http.status === 503 ? "retry_later" : "network";
      return { sent: mutations.length, applied: 0, conflicts: [], blocked: http.status === 403 || http.status === 401, retryAt, reason };
    }
    clearInterval(heartbeat);
    const results = new Map(response.results.map((result) => [result.operation_id, result]));
    let applied = 0;
    await this.store.update(this.partition, (current) => {
      if (current.lease?.owner !== this.leaseOwner) return { result: undefined, state: current };
      current.outbox = current.outbox.filter((entry) => {
        if (!ids.has(entry.mutation.operation_id)) return true;
        const result = results.get(entry.mutation.operation_id);
        if (!result) { entry.state = "queued"; entry.lastError = "server omitted this operation result"; return true; }
        const m = entry.mutation, key = entityKey(m.entity_type, m.entity_id), remote = asRecord(result.record, m.entity_type, m.entity_id);
        if (result.status === "applied" || result.status === "duplicate") {
          if (!remote) {
            entry.state = "accepted";
            entry.acceptedCursor = response.cursor;
            entry.lastError = "server accepted operation; awaiting pull confirmation";
            applied++;
            return true;
          }
          const existing = current.records[key];
          if (!existing || remote.version >= existing.version) current.records[key] = remote;
          applied++; return false;
        }
        entry.state = result.status; entry.lastError = result.message ?? result.conflict_paths?.map((p) => p.join(".")).join(", ") ?? result.status;
        if (remote && (!current.records[key] || remote.version >= current.records[key].version)) current.records[key] = remote;
        return true;
      });
      // Push-head cursors do not advance the pull cursor; only fully processed changes pages can do that.
      current.lease = undefined;
      current.updatedAt = this.now();
      return { result: undefined, state: current };
    });
    const after = await this.store.read(this.partition);
    return { sent: mutations.length, applied, conflicts: after.outbox.filter((e) => e.state === "conflict").map((e) => e.mutation.operation_id), blocked: after.outbox.some((e) => e.state === "conflict" || e.state === "denied") };
  }

  async resolveConflict(operationId: string, changes: SyncChange[]): Promise<SyncMutation> {
    const state = await this.store.read(this.partition), entry = state.outbox.find((e) => e.mutation.operation_id === operationId && e.state === "conflict");
    if (!entry) throw new Error("conflict operation not found");
    const old = entry.mutation, key = entityKey(old.entity_type, old.entity_id), base = state.records[key];
    if (!base) throw new Error("remote base is unavailable; pull changes before resolving");
    const nextChanges = validateChanges(changes, this.config.entityFields[old.entity_type]);
    if (!nextChanges.length) throw new Error("resolution needs explicit changes");
    const recreated = base.deleted;
    const dependents = state.outbox.filter((candidate) => candidate.mutation.depends_on.includes(operationId));
    if (recreated && dependents.length) throw new Error("resolve or discard dependent operations before recreating the deleted entity");
    for (const change of nextChanges) if (!fieldValuesEqual(recreated ? { exists: false } : fieldAt(base, change.path), change.before)) throw new Error("resolution before value must match the current remote base");
    const replacementId = this.makeId();
    const replacement: SyncMutation = { operation_id: replacementId, entity_type: old.entity_type, entity_id: recreated ? this.makeId() : old.entity_id, action: recreated ? "create" : "update", base_version: recreated ? 0 : base.version, changes: nextChanges, depends_on: old.depends_on.filter((id) => state.outbox.some((candidate) => candidate.mutation.operation_id === id)) };
    if (mutationBytes(replacement) > 32768) throw new Error("operation exceeds 32 KB");
    return this.store.update(this.partition, (current) => {
      const oldIndex = current.outbox.findIndex((candidate) => candidate.mutation.operation_id === operationId);
      if (oldIndex < 0 || current.outbox[oldIndex].state !== "conflict") throw new Error("conflict changed while resolving");
      current.outbox.splice(oldIndex, 1, { mutation: replacement, state: "queued", createdAt: this.now(), attempts: 0, nextAttemptAt: 0 });
      for (const candidate of current.outbox) candidate.mutation.depends_on = candidate.mutation.depends_on.map((id) => id === operationId ? replacementId : id);
      current.updatedAt = this.now();
      return { result: copy(replacement), state: current };
    });
  }

  async discardConflict(operationId: string): Promise<void> {
    await this.store.update(this.partition, (state) => {
      const item = state.outbox.find((entry) => entry.mutation.operation_id === operationId && entry.state === "conflict");
      if (!item) throw new Error("conflict operation not found");
      if (state.outbox.some((entry) => entry.mutation.depends_on.includes(operationId))) throw new Error("resolve or discard dependent operations first");
      state.outbox = state.outbox.filter((entry) => entry.mutation.operation_id !== operationId);
      state.updatedAt = this.now();
      return { result: undefined, state };
    });
  }

  async logout(): Promise<void> { await this.store.clearAccount(this.partition.accountId); }

  async exportPendingDrafts(): Promise<{ format: "rpg-nexus-mobile-v1-pending-drafts"; account_id: string; campaign_id: string; operations: SyncMutation[] }> {
    const state = await this.store.read(this.partition);
    return { format: "rpg-nexus-mobile-v1-pending-drafts", account_id: this.partition.accountId, campaign_id: this.partition.campaignId, operations: state.outbox.map((entry) => copy(entry.mutation)) };
  }
}

