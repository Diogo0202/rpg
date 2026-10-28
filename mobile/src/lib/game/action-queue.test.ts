import { describe, expect, it, vi } from "vitest";
import { GameApiError, type GameRequest } from "./api";
import { GameActionQueue, makeQueuedAction, memoryStorage, normalizeQueue } from "./action-queue";

const SHEET = "22222222-2222-4222-8222-222222222222";
const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const action = (n: number) => makeQueuedAction({ sheetId: SHEET, label: `Ajuste ${n}`, path: `/api/v1/system-rolls/vampire-v3/sheets/${SHEET}/actions`, body: { action: "dano", amount: n }, operationId: op(n), now: n });

describe("offline game action queue", () => {
  it("writes the stable operation id into the body", () => {
    expect(action(1).body).toEqual({ action: "dano", amount: 1, operation_id: op(1) });
    expect(() => makeQueuedAction({ sheetId: "x", label: "", path: "/api/v1/a", body: {}, operationId: op(1), now: 0 })).toThrow();
    expect(() => makeQueuedAction({ sheetId: SHEET, label: "", path: "https://evil.test/api/v1/a", body: {}, operationId: op(1), now: 0 })).toThrow();
  });

  it("restores inflight entries as queued and drops malformed ones", () => {
    expect(normalizeQueue([{ ...action(1), state: "inflight" }, { nope: true }, { ...action(2), body: { operation_id: op(9) } }]).map((item) => [item.operation_id, item.state]))
      .toEqual([[op(1), "queued"]]);
  });

  it("keeps the queue when offline and resends the same body later", async () => {
    const storage = memoryStorage();
    const queue = new GameActionQueue(storage);
    await queue.enqueue(action(1));
    await queue.enqueue(action(1));
    await queue.enqueue(action(2));
    const offline: GameRequest = vi.fn(async () => { throw new GameApiError("Sem conexão", 0); });
    const first = await queue.flush(offline);
    expect(first.sent).toEqual([]);
    expect(offline).toHaveBeenCalledTimes(1);
    expect(storage.value.map((item) => item.state)).toEqual(["queued", "queued"]);

    const bodies: unknown[] = [];
    const online: GameRequest = vi.fn(async (_method, _path, body) => { bodies.push(body); return { ok: true }; });
    const second = await queue.flush(online);
    expect(second.sent.map((item) => item.operation_id)).toEqual([op(1), op(2)]);
    expect(bodies).toEqual([action(1).body, action(2).body]);
    expect(storage.value).toEqual([]);
  });

  it("marks refused entries as failed and lets the player retry or discard", async () => {
    const storage = memoryStorage();
    const queue = new GameActionQueue(storage);
    await queue.enqueue(action(1));
    await queue.enqueue(action(2));
    const refuse: GameRequest = vi.fn(async (_m, _p, body) => {
      if ((body as { amount: number }).amount === 1) throw new GameApiError("operação não permitida", 403);
      return {};
    });
    const result = await queue.flush(refuse);
    expect(result.failed.map((item) => item.last_error)).toEqual(["operação não permitida"]);
    expect(storage.value.map((item) => [item.operation_id, item.state])).toEqual([[op(1), "failed"]]);
    await queue.retry(op(1));
    expect(storage.value[0]?.state).toBe("queued");
    await queue.discard(op(1));
    expect(storage.value).toEqual([]);
  });

  it("never sends one entry twice when flushes overlap", async () => {
    const queue = new GameActionQueue(memoryStorage());
    await queue.enqueue(action(1));
    const send: GameRequest = vi.fn(async () => ({}));
    await Promise.all([queue.flush(send), queue.flush(send)]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
