import type { Throw } from "./simulate.ts";
import type { Aim, DieRequest } from "./types.ts";

export type SimulateRequest = { id: number; requests: DieRequest[]; seed: number; aim?: Aim };
export type SimulateReply = { id: number; thrown?: Throw; error?: string };

type Pending = { resolve: (thrown: Throw) => void; reject: (error: Error) => void };

/** One worker serves every tray on the page, so only the first throw pays for starting it. */
let worker: Worker | null = null;
let broken = false;
let nextId = 0;
const pending = new Map<number, Pending>();

function fail(error: Error): void {
  broken = true;
  worker?.terminate();
  worker = null;
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function start(): Worker {
  const created = new Worker(new URL("./simulate.worker.ts", import.meta.url), { type: "module" });
  created.onmessage = (event: MessageEvent<SimulateReply>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.thrown) entry.resolve(event.data.thrown);
    else entry.reject(new Error(event.data.error ?? "A simulação falhou."));
  };
  // A worker that cannot load or crashes is not tried again; callers simulate on their own thread.
  created.onerror = () => fail(new Error("O worker da simulação não carregou."));
  created.onmessageerror = () => fail(new Error("O worker da simulação respondeu algo ilegível."));
  return created;
}

/**
 * simulateThrow in a Web Worker. Rejects when workers are unavailable or the worker fails, so the
 * caller can fall back to simulating on the main thread; the result is the same for the same seed.
 */
export function simulateInWorker(requests: DieRequest[], seed: number, aim?: Aim): Promise<Throw> {
  if (broken || typeof Worker === "undefined") return Promise.reject(new Error("Sem Web Worker."));
  try {
    worker ??= start();
  } catch (error) {
    broken = true;
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  const id = nextId++;
  const message: SimulateRequest = { id, requests, seed, aim };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage(message);
  });
}
