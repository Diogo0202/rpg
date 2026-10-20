export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Path = string[];
export type FieldValue = { exists: false } | { exists: true; value: JsonValue };
export type SyncAction = "create" | "update" | "delete";
export type MutationStatus = "queued" | "inflight" | "accepted" | "conflict" | "denied" | "invalid" | "dependency_failed";
export type ResultStatus = "applied" | "duplicate" | "conflict" | "denied" | "invalid" | "dependency_failed";

export interface SyncChange { path: Path; before: FieldValue; after: FieldValue }
export interface SyncMutation {
  operation_id: string; entity_type: string; entity_id: string;
  action: SyncAction; base_version: number; changes: SyncChange[]; depends_on: string[];
}
export interface SyncRecord {
  entity_type: string; id: string; entity_id?: string; version: number; data: Record<string, JsonValue>; deleted?: boolean;
}
export interface SyncResult {
  operation_id: string; status: ResultStatus; record?: SyncRecord | null; conflict_paths?: Path[]; message?: string;
}
export interface SyncChangeEvent {
  revision: number; version: number; entity_type: string; entity_id: string; action: "create" | "update" | "delete";
  record?: SyncRecord | null; tombstone?: true;
}
export interface SyncPartition { accountId: string; campaignId: string; deviceId: string }
export interface SyncConfig extends SyncPartition {
  entityFields: Record<string, string[]>;
  now?: () => number;
  randomUUID?: () => string;
  maxBatch?: number;
  maxBatchBytes?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
}
export interface OutboxEntry {
  mutation: SyncMutation; state: MutationStatus; createdAt: number; attempts: number;
  nextAttemptAt: number; lastError?: string; acceptedCursor?: string;
}
export interface SyncState {
  schema: "rpg-nexus-mobile-v1"; partition: SyncPartition; cursor: string | null;
  records: Record<string, SyncRecord>; outbox: OutboxEntry[]; lease?: { owner: string; until: number }; updatedAt: number;
}
export interface SyncPage { protocol_version: 1; campaign_id: string; cursor: string; has_more: boolean; changes: SyncChangeEvent[] }
export interface SnapshotPage {
  protocol_version: 1; campaign_id: string; cursor: string; records: SyncRecord[];
  next_after_id: string | null; has_more: boolean;
}
export interface SyncTransport {
  listCampaigns(): Promise<SyncCampaign[]>;
  capabilities(campaignId: string): Promise<SyncCapabilities>;
  push(campaignId: string, body: { protocol_version: 1; device_id: string; mutations: SyncMutation[] }): Promise<{ cursor?: string; results: SyncResult[] }>;
  changes(campaignId: string, cursor: string, limit?: number): Promise<SyncPage>;
  snapshot(campaignId: string, entityType: string, afterId?: string, limit?: number): Promise<SnapshotPage>;
}
export interface SyncCampaign { id: string; owner_id: string; name: string; description?: string | null; updated_at?: string }
export interface SyncCapabilities { protocol_version: 1; campaign_id: string; entity_fields: Record<string, string[]>; role: "owner" | "master" | "player" | "guest" }
export interface StoreUpdate<T> { result: T; state: SyncState }
export interface SyncStore {
  getOrCreateDeviceId(accountId: string): Promise<string>;
  read(partition: SyncPartition): Promise<SyncState>;
  update<T>(partition: SyncPartition, updater: (current: SyncState) => StoreUpdate<T>): Promise<T>;
  clearAccount(accountId: string): Promise<void>;
}
export interface EnqueueInput {
  entityType: string; entityId?: string; action: SyncAction; changes?: SyncChange[]; dependsOn?: string[];
}
