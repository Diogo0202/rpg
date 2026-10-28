import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { NexusContext } from "@/lib/nexus/context";
import { accessTokenProvider, getSupabaseAuth } from "@/lib/nexus/auth";
import { prefGet, prefSet } from "@/lib/nexus/prefs";
import { createGameRequest, GameApiError, type GameRequest } from "@/lib/game/api";
import { GameActionQueue, makeQueuedAction, memoryStorage, type QueuedAction, type QueueStorage } from "@/lib/game/action-queue";
import { canNarrate } from "@/lib/game/table-rules";

export type AdjustOutcome = { status: "sent"; result: unknown } | { status: "queued" };

function newId(): string {
  return globalThis.crypto.randomUUID();
}

const queues = new Map<string, GameActionQueue>();
function queueFor(accountId: string): GameActionQueue {
  let queue = queues.get(accountId);
  if (!queue) {
    const key = `game-action-queue-v1:${accountId}`;
    const fallback = memoryStorage();
    const storage: QueueStorage = {
      async read() { try { return await prefGet<unknown>(key); } catch { return fallback.read(); } },
      async write(value) { try { await prefSet(key, value); } catch { await fallback.write(value); } },
    };
    queue = new GameActionQueue(storage);
    queues.set(accountId, queue);
  }
  return queue;
}

function readOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * API access for the table screens: an authenticated request bound to the signed-in account,
 * the online flag, and the offline queue of adjustments (stable operation_id per action).
 */
export function useTableApi() {
  const nexus = useContext(NexusContext);
  const accountId = nexus?.mode === "connected" ? nexus.user?.id ?? null : null;
  const apiBase = (import.meta.env.VITE_NEXUS_API_URL as string | undefined)?.trim();
  const [online, setOnline] = useState(readOnline);
  const [queued, setQueued] = useState<QueuedAction[]>([]);
  const syncNow = nexus?.syncNow;
  const syncRef = useRef(syncNow);
  syncRef.current = syncNow;

  const { request, unavailable } = useMemo((): { request: GameRequest | null; unavailable: string } => {
    if (!nexus || nexus.mode !== "connected" || !accountId) return { request: null, unavailable: "Conecte uma campanha em Sincronização para usar as ações de mesa." };
    if (!apiBase) return { request: null, unavailable: "Configure a URL da API para usar as ações de mesa." };
    const auth = getSupabaseAuth();
    if (!auth) return { request: null, unavailable: "Entre na campanha para usar as ações de mesa." };
    try {
      return { request: createGameRequest({ baseUrl: apiBase, getAccessToken: accessTokenProvider(auth, accountId) }), unavailable: "" };
    } catch (error) {
      return { request: null, unavailable: error instanceof Error ? error.message : "API indisponível." };
    }
  }, [nexus, accountId, apiBase]);

  const queue = accountId ? queueFor(accountId) : null;

  const flush = useCallback(async () => {
    if (!queue || !request) return null;
    const result = await queue.flush(request);
    setQueued(result.remaining);
    if (result.sent.length) void syncRef.current?.().catch(() => undefined);
    return result;
  }, [queue, request]);

  useEffect(() => {
    let active = true;
    if (!queue) { setQueued([]); return; }
    void queue.list().then((items) => { if (active) setQueued(items); }).catch(() => undefined);
    if (readOnline()) void flush().catch(() => undefined);
    return () => { active = false; };
  }, [queue, flush]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const up = () => { setOnline(true); void flush().catch(() => undefined); };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [flush]);

  /** Sends now when possible; offline (or a lost reply) keeps it queued with the same operation_id. */
  const adjust = useCallback(async (input: { sheetId: string; label: string; path: string; body: Record<string, unknown> }): Promise<AdjustOutcome> => {
    if (!queue) throw new GameApiError("Conecte uma campanha para ajustar a ficha.", 401);
    const action = makeQueuedAction({ ...input, operationId: newId(), now: Date.now() });
    setQueued(await queue.enqueue(action));
    if (!request || !readOnline()) return { status: "queued" };
    const result = await queue.flush(request);
    setQueued(result.remaining);
    if (result.sent.length) void syncRef.current?.().catch(() => undefined);
    const failed = result.failed.find((item) => item.operation_id === action.operation_id);
    if (failed) throw new GameApiError(failed.last_error ?? "O servidor recusou o ajuste.", 422);
    if (result.results.has(action.operation_id)) return { status: "sent", result: result.results.get(action.operation_id) };
    return { status: "queued" };
  }, [queue, request]);

  const discard = useCallback(async (operationId: string) => { if (queue) setQueued(await queue.discard(operationId)); }, [queue]);
  const retry = useCallback(async (operationId: string) => { if (queue) { setQueued(await queue.retry(operationId)); await flush(); } }, [queue, flush]);

  /** Refresh the local mirror of the sheet after a server-side change. */
  const refreshSheet = useCallback(() => { void syncRef.current?.().catch(() => undefined); }, []);

  return {
    request, unavailable, online, queued, adjust, flush, discard, retry, refreshSheet,
    narrator: canNarrate(nexus?.capabilities?.role), viewerId: nexus?.user?.id ?? null,
  };
}

export type TableApi = ReturnType<typeof useTableApi>;

/** Stable operation id per logical action, kept until it succeeds (retry after a lost reply replays). */
export function useOperationIds() {
  const ids = useRef(new Map<string, string>());
  return useMemo(() => ({
    take(key: string) { let id = ids.current.get(key); if (!id) { id = newId(); ids.current.set(key, id); } return id; },
    done(key: string) { ids.current.delete(key); },
    clear() { ids.current.clear(); },
  }), []);
}
