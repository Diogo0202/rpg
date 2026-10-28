import { GameApiError, isRetryable, isUuid, safeApiPath, type GameRequest } from "./api";

/**
 * Offline queue for table adjustments (V3 blood/damage/healing, cell Danger/Desperation, V5
 * compulsion/torpor/hunt, bond drinks). Same idea as SheetAdjustmentIntent in mobile-sync:
 * the operation_id is minted once, stored with the request and sent on every retry, so the
 * server's RPC replays instead of applying twice. Rolls are never queued: they need the server.
 */
export type QueuedActionState = "queued" | "inflight" | "failed";
export type QueuedAction = {
  operation_id: string;
  sheet_id: string;
  label: string;
  path: string;
  body: Record<string, unknown>;
  created_at: number;
  attempts: number;
  state: QueuedActionState;
  last_error?: string;
};

export type QueueStorage = {
  read(): Promise<unknown>;
  write(value: QueuedAction[]): Promise<void>;
};

export const QUEUE_LIMIT = 100;

function validEntry(value: unknown): value is QueuedAction {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return isUuid(item.operation_id) && isUuid(item.sheet_id) && typeof item.label === "string" && typeof item.path === "string"
    && Boolean(item.body) && typeof item.body === "object" && !Array.isArray(item.body)
    && (item.body as Record<string, unknown>).operation_id === item.operation_id
    && typeof item.created_at === "number" && typeof item.attempts === "number"
    && (item.state === "queued" || item.state === "inflight" || item.state === "failed");
}

/** Stored entries that still look right; an "inflight" left by a closed app goes back to the queue. */
export function normalizeQueue(value: unknown): QueuedAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(validEntry).map((item) => ({ ...item, state: item.state === "inflight" ? "queued" : item.state })).slice(-QUEUE_LIMIT);
}

/** A new adjustment with its stable operation_id written into the body. */
export function makeQueuedAction(input: { sheetId: string; label: string; path: string; body: Record<string, unknown>; operationId: string; now: number }): QueuedAction {
  if (!isUuid(input.sheetId) || !isUuid(input.operationId)) throw new GameApiError("Ficha ou operação inválida.", 422);
  safeApiPath(input.path);
  return {
    operation_id: input.operationId, sheet_id: input.sheetId, label: input.label.slice(0, 120), path: input.path,
    body: { ...input.body, operation_id: input.operationId }, created_at: input.now, attempts: 0, state: "queued",
  };
}

export type FlushResult = { sent: QueuedAction[]; failed: QueuedAction[]; remaining: QueuedAction[]; results: Map<string, unknown> };

/**
 * Sends queued entries in order. Success removes the entry; offline, busy server or a session to
 * refresh stops the flush and keeps the rest; any other refusal marks the entry as failed so the
 * player sees why and may discard it.
 */
export async function flushQueue(entries: QueuedAction[], send: GameRequest): Promise<FlushResult> {
  const remaining = entries.map((item) => ({ ...item }));
  const sent: QueuedAction[] = [];
  const failed: QueuedAction[] = [];
  const results = new Map<string, unknown>();
  for (const entry of [...remaining]) {
    if (entry.state !== "queued") continue;
    entry.attempts += 1;
    try {
      results.set(entry.operation_id, await send("POST", entry.path, entry.body));
      remaining.splice(remaining.indexOf(entry), 1);
      sent.push(entry);
    } catch (error) {
      entry.last_error = error instanceof Error ? error.message : "Falha ao enviar.";
      if (isRetryable(error)) break;
      entry.state = "failed";
      failed.push(entry);
    }
  }
  return { sent, failed, remaining, results };
}

/** Persistent queue with a simple in-process lock so two flushes never send the same entry. */
export class GameActionQueue {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly storage: QueueStorage) {}

  private locked<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<QueuedAction[]> {
    return normalizeQueue(await this.storage.read());
  }

  enqueue(action: QueuedAction): Promise<QueuedAction[]> {
    return this.locked(async () => {
      const current = normalizeQueue(await this.storage.read());
      if (current.some((item) => item.operation_id === action.operation_id)) return current;
      if (current.length >= QUEUE_LIMIT) throw new GameApiError("Fila offline cheia: sincronize antes de novos ajustes.", 422);
      const next = [...current, action];
      await this.storage.write(next);
      return next;
    });
  }

  discard(operationId: string): Promise<QueuedAction[]> {
    return this.locked(async () => {
      const next = normalizeQueue(await this.storage.read()).filter((item) => item.operation_id !== operationId);
      await this.storage.write(next);
      return next;
    });
  }

  retry(operationId: string): Promise<QueuedAction[]> {
    return this.locked(async () => {
      const next = normalizeQueue(await this.storage.read()).map((item) => item.operation_id === operationId ? { ...item, state: "queued" as const, last_error: undefined } : item);
      await this.storage.write(next);
      return next;
    });
  }

  flush(send: GameRequest): Promise<FlushResult> {
    return this.locked(async () => {
      const result = await flushQueue(normalizeQueue(await this.storage.read()), send);
      await this.storage.write(result.remaining);
      return result;
    });
  }
}

/** In-memory storage (tests, or when IndexedDB is unavailable). */
export function memoryStorage(initial: QueuedAction[] = []): QueueStorage & { value: QueuedAction[] } {
  const box = { value: initial, async read() { return box.value; }, async write(value: QueuedAction[]) { box.value = value; } };
  return box;
}
