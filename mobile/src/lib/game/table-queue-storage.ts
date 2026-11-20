import { prefDeletePrefix, prefSet, prefUpdateKeys } from "@/lib/nexus/prefs";
import { GameActionQueue, normalizeQueue } from "./action-queue";

const queues = new Map<string, GameActionQueue>();
export function tableQueueKey(account: string, campaign: string, device: string): string {
  return `game-action-queue-v2:${account}:${campaign}:${device}`;
}
export function tableQueueFor(account: string, campaign: string, device: string): GameActionQueue {
  const key = tableQueueKey(account, campaign, device);
  let queue = queues.get(key);
  if (!queue) {
    // A write failure must reach the caller. An accepted offline action must survive restart.
    const legacyKey = `game-action-queue-v1:${account}:${campaign}`;
    const revokedKey = `game-action-queue-v2:${account}:${campaign}:revoked`;
    const update = (change: (current: ReturnType<typeof normalizeQueue>) => ReturnType<typeof normalizeQueue>) =>
      prefUpdateKeys([key, legacyKey, revokedKey, `game-action-queue-account:${account}`], ([raw, old, revoked, signedOut]) => {
        if (revoked || signedOut) throw new Error("Acesso a campanha revogado; fila bloqueada.");
        const current = normalizeQueue(raw);
        const ids = new Set(current.map((entry) => entry.operation_id));
        const legacy = normalizeQueue(old).filter((entry) => !ids.has(entry.operation_id));
        const next = change([...current, ...legacy]);
        return { result: next, writes: [[key, next], [legacyKey, []]] };
      });
    queue = new GameActionQueue({
      read: () => update((current) => current),
      write: async (value) => { await prefSet(key, value); },
      update,
    });
    queues.set(key, queue);
  }
  return queue;
}
export async function clearTableAccount(account: string): Promise<void> {
  await prefSet(`game-action-queue-account:${account}`, true);
  const prefix = `game-action-queue-v2:${account}:`;
  const owned = [...queues.entries()].filter(([key]) => key.startsWith(prefix));
  owned.forEach(([, queue]) => queue.disable());
  await Promise.all(owned.map(([, queue]) => queue.clear()));
  owned.forEach(([key]) => queues.delete(key));
  await prefDeletePrefix(prefix);
  await prefDeletePrefix(`game-action-queue-v1:${account}:`);
  await prefSet(`game-action-queue-v1:${account}`, []);
}
export async function blockTableCampaign(account: string, campaign: string): Promise<void> {
  const prefix = `game-action-queue-v2:${account}:${campaign}:`;
  for (const [key, queue] of queues) if (key.startsWith(prefix)) queue.disable();
  await prefSet(`${prefix}revoked`, true);
}

export async function restoreTableCampaign(account: string, campaign: string): Promise<void> {
  await prefSet(`game-action-queue-account:${account}`, false);
  await prefSet(`game-action-queue-v2:${account}:${campaign}:revoked`, false);
  const prefix = `game-action-queue-v2:${account}:${campaign}:`;
  for (const key of queues.keys()) if (key.startsWith(prefix)) queues.delete(key);
}
