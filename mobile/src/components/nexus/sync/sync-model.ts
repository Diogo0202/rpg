/** Regras da tela de sincronização, sem React: rótulos de estado e resolução de conflito. */

import type { OutboxEntry, SyncChange, SyncRecord, SyncState } from "@/lib/mobile-sync";
import { readPath } from "@/lib/nexus/records";

export const STATUS_LABELS: Record<string, string> = {
  queued: "na fila",
  inflight: "em processamento local",
  accepted: "aguardando confirmação recebida",
  conflict: "conflito",
  denied: "negada",
  invalid: "inválida",
  dependency_failed: "dependência falhou",
};

export const statusLabel = (state: string) => STATUS_LABELS[state] ?? state;

/** Registro que o aparelho recebeu do servidor para a entidade da operação. */
export function receivedBase(state: SyncState | null, entry: OutboxEntry): SyncRecord | undefined {
  return state?.records[JSON.stringify([entry.mutation.entity_type, entry.mutation.entity_id])];
}

export function valueAt(record: SyncRecord | undefined, path: string[]) {
  return readPath(record?.data, path);
}

/** Texto de um valor JSON para comparação lado a lado; ausente quando não existe. */
export function pretty(field: { exists: boolean; value?: unknown }): string {
  return field.exists && field.value !== undefined ? JSON.stringify(field.value, null, 2) : "(ausente)";
}

/** Reaplica cada campo do rascunho tomando como "antes" o valor da base recebida. */
export function reapplyOnBase(changes: SyncChange[], base: SyncRecord): SyncChange[] {
  return changes.map((change) => ({ ...change, before: valueAt(base, change.path) }));
}

export function legacyQueueKey(accountId: string) {
  return `game-action-queue-v1:${accountId}`;
}
