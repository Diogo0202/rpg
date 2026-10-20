import type { SnapshotPage, SyncCampaign, SyncCapabilities, SyncChangeEvent, SyncPage, SyncRecord, SyncResult, SyncTransport } from "./types.ts";
import { validateChanges } from "./merge.ts";

export class SyncHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly code?: string;
  constructor(message: string, status: number, retryAfterMs?: number, code?: string) {
    super(message); this.name = "SyncHttpError";
    this.status = status; this.retryAfterMs = retryAfterMs; this.code = code;
  }
}
export type AccessTokenProvider = (refresh?: boolean) => Promise<string | null>;

export function parseRetryAfter(value: string | null, now = Date.now(), capMs = 120000): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const raw = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(raw)) return undefined;
  if (raw < 0) return 0;
  return Math.min(capMs, Math.floor(raw));
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const entityPattern = /^[a-z][a-z0-9_]{0,63}$/;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
function normalizeCursor(value: unknown, label: string): string {
  if (typeof value === "string" && value.length <= 256) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error(`Invalid ${label} cursor`);
}
function safeJson(value: unknown, depth = 0): unknown {
  if (depth > 32) throw new Error("Sync response JSON is too deeply nested");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("Sync response contains an invalid number"); return value; }
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new Error("Sync response array is too large");
    return value.map((item) => safeJson(item, depth + 1));
  }
  if (typeof value !== "object") throw new Error("Sync response contains a non-JSON value");
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) throw new Error("Sync response contains a forbidden object key");
    result[key] = safeJson(child, depth + 1);
  }
  return result;
}
function safeData(value: unknown): SyncRecord["data"] {
  const data = safeJson(value);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Sync record data must be an object");
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_RESPONSE_BYTES) throw new Error("Sync record data is too large");
  return data as SyncRecord["data"];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label} response`);
  return value as Record<string, unknown>;
}
function normalizeRecord(input: unknown): SyncRecord | null {
  if (input == null) return null;
  const value = object(input, "record");
  const id = String(value.entity_id ?? value.id ?? "");
  if (!uuidPattern.test(id) || typeof value.entity_type !== "string" || !entityPattern.test(value.entity_type) || typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version < 1) throw new Error("Invalid sync record identity or version");
  const deleted = value.deleted === true || value.tombstone === true;
  const data = value.data === undefined && deleted ? {} : safeData(value.data);
  return { entity_type: value.entity_type, id, entity_id: id, version: value.version, data, ...(deleted ? { deleted: true } : {}) };
}

function loopback(hostname: string): boolean { return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"; }
function checkedBaseUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("baseUrl must be an absolute HTTPS URL, or HTTP loopback for local development"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("baseUrl cannot include credentials, query, or fragment");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname))) throw new Error("baseUrl requires HTTPS; HTTP is allowed only for loopback development");
  return url.toString().replace(/\/+$/, "");
}
function normalizeMutation(input: unknown): NonNullable<Parameters<SyncTransport["push"]>[1]["mutations"]>[number] {
  const value = object(input, "mutation");
  if (typeof value.operation_id !== "string" || !uuidPattern.test(value.operation_id) || typeof value.entity_type !== "string" || !entityPattern.test(value.entity_type) || typeof value.entity_id !== "string" || !uuidPattern.test(value.entity_id)) throw new Error("Invalid mutation identity");
  if (!["create", "update", "delete"].includes(String(value.action)) || typeof value.base_version !== "number" || !Number.isSafeInteger(value.base_version) || value.base_version < 0) throw new Error("Invalid mutation action or base version");
  if (!Array.isArray(value.depends_on) || value.depends_on.length > 200 || value.depends_on.some((id) => typeof id !== "string" || !uuidPattern.test(id) || id === value.operation_id) || new Set(value.depends_on).size !== value.depends_on.length) throw new Error("Invalid mutation dependencies");
  const changes = validateChanges(value.changes as Parameters<typeof validateChanges>[0]);
  const action = value.action as "create" | "update" | "delete";
  if (action === "delete" ? changes.length !== 0 : changes.length === 0) throw new Error("Invalid mutation change count");
  const mutation = { operation_id: value.operation_id, entity_type: value.entity_type, entity_id: value.entity_id, action, base_version: value.base_version, changes, depends_on: value.depends_on as string[] };
  if (new TextEncoder().encode(JSON.stringify(mutation)).byteLength > 32768) throw new Error("Mutation exceeds 32 KB");
  return mutation;
}

export interface FastApiSyncTransportOptions {
  baseUrl: string;
  getAccessToken: AccessTokenProvider;
  fetch?: typeof fetch;
  maxAttempts?: number;
  retryMaxMs?: number;
  retryBaseMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class FastApiSyncTransport implements SyncTransport {
  private readonly options: FastApiSyncTransportOptions;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly base: string;
  constructor(options: FastApiSyncTransportOptions) {
    this.options = options;
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.fetcher) throw new Error("fetch is unavailable");
    this.base = checkedBaseUrl(options.baseUrl);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const attempts = Math.min(8, Math.max(1, Math.floor(this.options.maxAttempts ?? 4))), cap = Math.min(120000, Math.max(0, this.options.retryMaxMs ?? 120000));
    let refreshUsed = false, refreshNext = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.options.getAccessToken(refreshNext);
      refreshNext = false;
      if (!token) throw new SyncHttpError("Sign in is required", 401, undefined, "reauth_required");
      let response: Response;
      try {
        response = await this.fetcher(`${this.base}${path}`, {
          ...init,
          headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers, Authorization: `Bearer ${token}` },
          cache: "no-store", redirect: "error",
        });
      } catch (error) {
        if (attempt + 1 >= attempts) throw new SyncHttpError(error instanceof Error ? error.message : "Network request failed", 0);
        await this.sleep(Math.min(cap, (this.options.retryBaseMs ?? 500) * 2 ** attempt));
        continue;
      }
      if (response.status === 401 && !refreshUsed) { refreshUsed = true; refreshNext = true; continue; }
      if (response.status === 429 || response.status === 503) {
        const delay = parseRetryAfter(response.headers.get("Retry-After"), this.now(), cap) ?? Math.min(cap, (this.options.retryBaseMs ?? 500) * 2 ** attempt);
        if (attempt + 1 < attempts) { await this.sleep(delay); continue; }
        throw new SyncHttpError(`Sync service returned ${response.status}`, response.status, delay, "retry_later");
      }
      if (!response.ok) {
        let message = `Sync service returned ${response.status}`;
        try { const body = object(await this.readJson(response), "error"); if (typeof body.detail === "string") message = body.detail; else if (typeof body.message === "string") message = body.message; } catch { /* response may have no JSON body */ }
        throw new SyncHttpError(message, response.status, undefined, response.status === 403 ? "campaign_revoked" : undefined);
      }
      if (response.status === 204) return null;
      return this.readJson(response);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    const declared = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("Sync response exceeds 2 MB");
    let text: string;
    if (response.body) {
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.byteLength;
        if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Sync response exceeds 2 MB"); }
        chunks.push(part.value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      text = new TextDecoder().decode(bytes);
    } else text = await response.text();
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("Sync service returned invalid JSON"); }
    return safeJson(value);
  }

  async listCampaigns(): Promise<SyncCampaign[]> {
    const payload = object(await this.request("/api/v1/sync/campaigns"), "campaign list");
    if (payload.protocol_version !== 1 || !Array.isArray(payload.campaigns)) throw new Error("Invalid campaign list envelope");
    return payload.campaigns.map((item) => {
      const campaign = object(item, "campaign");
      if (typeof campaign.id !== "string" || !uuidPattern.test(campaign.id) || typeof campaign.owner_id !== "string" || !uuidPattern.test(campaign.owner_id) || typeof campaign.name !== "string" || campaign.name.length > 300) throw new Error("Invalid campaign entry");
      if (campaign.description !== undefined && campaign.description !== null && (typeof campaign.description !== "string" || campaign.description.length > 2000)) throw new Error("Invalid campaign description");
      if (campaign.updated_at !== undefined && typeof campaign.updated_at !== "string") throw new Error("Invalid campaign update timestamp");
      return { id: campaign.id, owner_id: campaign.owner_id, name: campaign.name, description: typeof campaign.description === "string" ? campaign.description : null, updated_at: typeof campaign.updated_at === "string" ? campaign.updated_at : undefined };
    });
  }

  async capabilities(campaignId: string): Promise<SyncCapabilities> {
    const payload = object(await this.request(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/sync/capabilities`), "capabilities");
    if (payload.protocol_version !== 1 || payload.campaign_id !== campaignId || !["owner", "master", "player", "guest"].includes(String(payload.role)) || !payload.entity_fields || typeof payload.entity_fields !== "object" || Array.isArray(payload.entity_fields)) throw new Error("Invalid campaign capabilities envelope");
    const entries = Object.entries(payload.entity_fields as Record<string, unknown>);
    if (entries.length > 100) throw new Error("Too many sync entity types");
    const entityFields: Record<string, string[]> = Object.create(null);
    for (const [entityType, rawFields] of entries) {
      if (!entityPattern.test(entityType) || !Array.isArray(rawFields) || rawFields.length > 200) throw new Error("Invalid entity capabilities");
      const fields = rawFields.map((field) => {
        if (typeof field !== "string" || !entityPattern.test(field) || forbiddenKeys.has(field)) throw new Error("Invalid writable field capability");
        return field;
      });
      if (new Set(fields).size !== fields.length) throw new Error("Duplicate writable field capability");
      entityFields[entityType] = fields;
    }
    return { protocol_version: 1, campaign_id: campaignId, role: payload.role as SyncCapabilities["role"], entity_fields: entityFields };
  }

  async push(campaignId: string, body: { protocol_version: 1; device_id: string; mutations: Parameters<SyncTransport["push"]>[1]["mutations"] }): Promise<{ cursor?: string; results: SyncResult[] }> {
    if (body.protocol_version !== 1 || !uuidPattern.test(body.device_id) || !Array.isArray(body.mutations) || body.mutations.length < 1 || body.mutations.length > 50) throw new Error("Invalid push request envelope");
    const mutations = body.mutations.map(normalizeMutation);
    if (new Set(mutations.map((mutation) => mutation.operation_id)).size !== mutations.length) throw new Error("Duplicate operation ID in batch");
    const requestBody = JSON.stringify({ protocol_version: 1, device_id: body.device_id, mutations });
    if (new TextEncoder().encode(requestBody).byteLength > MAX_REQUEST_BYTES) throw new Error("Push batch exceeds 1 MB");
    const payload = object(await this.request(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/sync/push`, { method: "POST", body: requestBody }), "push");
    if (payload.protocol_version !== 1 || payload.campaign_id !== campaignId || !Array.isArray(payload.results) || payload.results.length > 50) throw new Error("Invalid push envelope");
    if (payload.results.length !== body.mutations.length) throw new Error("Push response must contain one ordered result per operation");
    const results = payload.results.map((item, index) => {
      const result = object(item, "push result");
      if (typeof result.operation_id !== "string" || result.operation_id !== body.mutations[index].operation_id || !uuidPattern.test(result.operation_id) || !["applied", "duplicate", "conflict", "denied", "invalid", "dependency_failed"].includes(String(result.status))) throw new Error("Invalid or out-of-order push result");
      const record = normalizeRecord(result.record);
      let conflictPaths: string[][] | undefined;
      if (result.conflict_paths !== undefined) {
        if (!Array.isArray(result.conflict_paths) || result.conflict_paths.length > 200) throw new Error("Invalid conflict path list");
        conflictPaths = result.conflict_paths.map((path) => {
          if (!Array.isArray(path) || !path.length || path.length > 12 || path.some((segment) => typeof segment !== "string" || !segment || forbiddenKeys.has(segment))) throw new Error("Invalid conflict path");
          return path as string[];
        });
      }
      if (result.message !== undefined && (typeof result.message !== "string" || result.message.length > 2000)) throw new Error("Invalid result message");
      return { operation_id: result.operation_id, status: result.status as SyncResult["status"], ...(record ? { record } : {}), ...(conflictPaths ? { conflict_paths: conflictPaths } : {}), ...(typeof result.message === "string" ? { message: result.message } : {}) };
    });
    return { cursor: payload.cursor === undefined ? undefined : normalizeCursor(payload.cursor, "push"), results };
  }

  async changes(campaignId: string, cursor: string, limit = 100): Promise<SyncPage> {
    const query = new URLSearchParams({ cursor, limit: String(Math.min(100, Math.max(1, limit))) });
    const payload = object(await this.request(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/sync/changes?${query}`), "changes");
    if (payload.protocol_version !== 1 || payload.campaign_id !== campaignId || !Array.isArray(payload.changes)) throw new Error("Invalid changes envelope");
    const events: SyncChangeEvent[] = payload.changes.map((item) => {
      const event = object(item, "change");
      if (typeof event.revision !== "number" || !Number.isSafeInteger(event.revision) || event.revision < 1 || typeof event.version !== "number" || !Number.isSafeInteger(event.version) || event.version < 1 || typeof event.entity_type !== "string" || !entityPattern.test(event.entity_type) || typeof event.entity_id !== "string" || !uuidPattern.test(event.entity_id) || !["create", "update", "delete"].includes(String(event.action))) throw new Error("Invalid change event");
      const record = normalizeRecord(event.record);
      if (record && (record.id !== event.entity_id || record.entity_type !== event.entity_type || record.version < event.version)) throw new Error("Change record does not match event identity/version");
      return { revision: event.revision, version: event.version, entity_type: event.entity_type, entity_id: event.entity_id, action: event.action as "create" | "update" | "delete", ...(record ? { record } : {}), ...(event.tombstone === true ? { tombstone: true } : {}) };
    });
    if (typeof payload.has_more !== "boolean") throw new Error("Invalid changes pagination flag");
    return { protocol_version: 1, campaign_id: campaignId, cursor: normalizeCursor(payload.cursor, "changes"), has_more: payload.has_more, changes: events };
  }

  async snapshot(campaignId: string, entityType: string, afterId?: string, limit = 100): Promise<SnapshotPage> {
    const query = new URLSearchParams({ entity_type: entityType, limit: String(Math.min(100, Math.max(1, limit))) });
    if (afterId) query.set("after_id", afterId);
    const payload = object(await this.request(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/sync/snapshot?${query}`), "snapshot");
    if (payload.protocol_version !== 1 || payload.campaign_id !== campaignId || !Array.isArray(payload.records) || payload.records.length > 100) throw new Error("Invalid snapshot envelope");
    const records = payload.records.map(normalizeRecord).filter((record): record is SyncRecord => record !== null);
    const nextAfterId = payload.next_after_id ?? null;
    if (nextAfterId !== null && (typeof nextAfterId !== "string" || !uuidPattern.test(nextAfterId))) throw new Error("Invalid snapshot cursor ID");
    if (typeof payload.has_more !== "boolean") throw new Error("Invalid snapshot pagination flag");
    if (payload.has_more && nextAfterId === null) throw new Error("Snapshot page is missing next_after_id");
    return { protocol_version: 1, campaign_id: campaignId, cursor: normalizeCursor(payload.cursor, "snapshot"), records, next_after_id: nextAfterId, has_more: payload.has_more };
  }
}

