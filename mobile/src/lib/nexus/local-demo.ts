/** Partição local de demonstração: cria o motor e semeia o exemplo uma única vez por aparelho. */

import { SyncEngine, type IndexedDbSyncStore } from "@/lib/mobile-sync/index.ts";
import { accountCache } from "./account-cache";
import { LOCAL_ACCOUNT_ID, LOCAL_CAMPAIGN_ID, LOCAL_ENTITY_FIELDS, LocalOnlyTransport } from "./config";
import { seedDemo } from "./seed";

const memoryLocks = new Map<string, Promise<void>>();

/** Usa o Web Locks entre abas quando existe; sem ele, uma fila em memória na mesma aba. */
async function withExclusiveLock(name: string, task: () => Promise<void>): Promise<void> {
  const lockManager = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (lockManager) {
    await lockManager.request(name, { mode: "exclusive" }, task);
    return;
  }
  const next = (memoryLocks.get(name) ?? Promise.resolve()).then(task);
  memoryLocks.set(name, next);
  try {
    await next;
  } finally {
    if (memoryLocks.get(name) === next) memoryLocks.delete(name);
  }
}

export async function seedLocalDemoOnce(engine: SyncEngine, disabled = false): Promise<void> {
  const name = `rpg-nexus-demo:${engine.partition.accountId}:${engine.partition.campaignId}`;
  await withExclusiveLock(name, async () => {
    const current = await engine.readState();
    if (!disabled && current.outbox.length === 0 && Object.keys(current.records).length === 0) await seedDemo(engine);
  });
}

export async function openLocalEngine(store: IndexedDbSyncStore): Promise<SyncEngine> {
  const deviceId = await store.getOrCreateDeviceId(LOCAL_ACCOUNT_ID);
  const engine = new SyncEngine(
    { accountId: LOCAL_ACCOUNT_ID, campaignId: LOCAL_CAMPAIGN_ID, deviceId, entityFields: LOCAL_ENTITY_FIELDS },
    store,
    new LocalOnlyTransport(),
  );
  await seedLocalDemoOnce(engine, await accountCache.demoSeedDisabled());
  return engine;
}
