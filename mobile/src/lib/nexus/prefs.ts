/**
 * Tiny IndexedDB key/value store for device-local, non-synced data (roll history).
 * It is NOT an outbox; synced entities always go through SyncEngine.
 */
const DB = "rpg-nexus-mobile-local-prefs";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function prefGet<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function prefSet(key: string, value: unknown): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function prefClear(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}


/** Deletes only this account's table data; other account preferences remain intact. */
export async function prefDeletePrefix(prefix: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => { const cursor = req.result; if (!cursor) return; if (String(cursor.key).startsWith(prefix)) cursor.delete(); cursor.continue(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Reads and updates a group of keys in one IndexedDB transaction across tabs. */
export async function prefUpdateKeys<T>(keys: string[], update: (values: unknown[]) => { result: T; writes: Array<[string, unknown]> }): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const values: unknown[] = [];
    let pending = keys.length;
    let result: T;
    let failure: unknown;
    const apply = () => {
      try { const next = update(values); result = next.result; for (const [key, value] of next.writes) store.put(value, key); }
      catch (error) { failure = error; tx.abort(); }
    };
    keys.forEach((key, index) => { const req = store.get(key); req.onsuccess = () => { values[index] = req.result; if (--pending === 0) apply(); }; });
    if (!keys.length) apply();
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error);
  });
}
