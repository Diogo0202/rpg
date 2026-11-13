import type { RingValues } from "./creation.ts";
export type RingDraft = { accountId: string; campaignId: string; templateId: string; values: RingValues; updatedAt: string };
const DB = "atlas-one-ring-drafts";
const key = (account: string, campaign: string, template: string) => JSON.stringify([account, campaign, template]);
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", mode), request = work(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error ?? new Error("Falha no armazenamento local."));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function loadRingDraft(account: string, campaign: string, template: string): Promise<RingDraft | null> {
  const row = await transaction("readonly", (store) => store.get(key(account, campaign, template)));
  return row && row.accountId === account && row.campaignId === campaign && row.templateId === template ? row as RingDraft : null;
}
export async function saveRingDraft(draft: RingDraft): Promise<void> {
  await transaction("readwrite", (store) => store.put({ ...draft, key: key(draft.accountId, draft.campaignId, draft.templateId) }));
}
export async function removeRingDraft(account: string, campaign: string, template: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(key(account, campaign, template)));
}
export async function clearRingDraftAccount(account: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite"), request = tx.objectStore("drafts").openCursor();
      request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value.accountId === account) cursor.delete(); cursor.continue(); } };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
