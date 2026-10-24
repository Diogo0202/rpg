import type { OutboxEntry, StoreUpdate, SyncPartition, SyncState, SyncStore } from "./types.ts";

const DB_NAME = "rpg-nexus-mobile-v1";
const STORE_NAME = "partitions";
const partitionKey = (p: SyncPartition) => JSON.stringify([p.accountId, p.campaignId, p.deviceId]);
const clone = <T>(value: T): T => structuredClone(value);

function initialState(partition: SyncPartition): SyncState {
  return { schema: "rpg-nexus-mobile-v1", partition: { ...partition }, cursor: null, records: {}, outbox: [], adjustments: [], updatedAt: Date.now() };
}
function normalize(state: SyncState): SyncState {
  const copy = clone(state);
  copy.adjustments ??= [];
  return copy;
}

export class MemoryCoordinator {
  readonly partitions = new Map<string, SyncState>();
  readonly devices = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  async transact<T>(work: () => T): Promise<T> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.queue;
    this.queue = previous.then(() => turn);
    await previous;
    try { return work(); } finally { release(); }
  }
}

export class MemorySyncStore implements SyncStore {
  private readonly coordinator: MemoryCoordinator;
  constructor(coordinator = new MemoryCoordinator()) { this.coordinator = coordinator; }
  async getOrCreateDeviceId(accountId: string): Promise<string> {
    return this.coordinator.transact(() => {
      let id = this.coordinator.devices.get(accountId);
      if (!id) { id = globalThis.crypto.randomUUID(); this.coordinator.devices.set(accountId, id); }
      return id;
    });
  }
  async read(partition: SyncPartition): Promise<SyncState> {
    return this.coordinator.transact(() => {
      const key = partitionKey(partition), state = normalize(this.coordinator.partitions.get(key) ?? initialState(partition));
      this.coordinator.partitions.set(key, clone(state));
      return clone(state);
    });
  }
  async update<T>(partition: SyncPartition, updater: (current: SyncState) => StoreUpdate<T>): Promise<T> {
    return this.coordinator.transact(() => {
      const key = partitionKey(partition), current = normalize(this.coordinator.partitions.get(key) ?? initialState(partition));
      const { result, state } = updater(clone(current));
      if (state.schema !== "rpg-nexus-mobile-v1" || partitionKey(state.partition) !== key) throw new Error("partition/schema mismatch");
      this.coordinator.partitions.set(key, clone(state));
      return clone(result);
    });
  }
  async clearAccount(accountId: string): Promise<void> {
    await this.coordinator.transact(() => {
      for (const [key, state] of this.coordinator.partitions) if (state.partition.accountId === accountId) this.coordinator.partitions.delete(key);
      this.coordinator.devices.delete(accountId);
    });
  }
}

export class IndexedDbSyncStore implements SyncStore {
  private dbPromise?: Promise<IDBDatabase>;
  private readonly dbName: string;
  private readonly idb: IDBFactory;
  constructor(dbName = DB_NAME, idb: IDBFactory = globalThis.indexedDB) {
    this.dbName = dbName; this.idb = idb;
    if (!idb) throw new Error("IndexedDB is unavailable in this environment");
  }
  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = new Promise((resolve, reject) => {
      const request = this.idb.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("accountId", "accountId", { unique: false });
        }
        if (!db.objectStoreNames.contains("devices")) db.createObjectStore("devices", { keyPath: "accountId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab"));
    });
    return this.dbPromise;
  }
  async getOrCreateDeviceId(accountId: string): Promise<string> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("devices", "readwrite"), store = tx.objectStore("devices"), request = store.get(accountId);
      let id = "";
      request.onsuccess = () => {
        const row = request.result as { deviceId?: string } | undefined;
        id = row?.deviceId ?? globalThis.crypto.randomUUID();
        if (!row) store.put({ accountId, deviceId: id });
      };
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB device registration failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB device registration aborted"));
    });
  }
  async read(partition: SyncPartition): Promise<SyncState> {
    const db = await this.db(), key = partitionKey(partition);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite"), store = tx.objectStore(STORE_NAME), req = store.get(key);
      let state = initialState(partition);
      req.onsuccess = () => {
        const row = req.result as { state?: SyncState } | undefined;
        state = normalize(row?.state ?? state);
        store.put({ key, accountId: partition.accountId, state });
      };
      tx.oncomplete = () => resolve(clone(state));
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB read failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB read aborted"));
    });
  }
  async update<T>(partition: SyncPartition, updater: (current: SyncState) => StoreUpdate<T>): Promise<T> {
    const db = await this.db(), key = partitionKey(partition);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite"), store = tx.objectStore(STORE_NAME), req = store.get(key);
      let result!: T;
      req.onsuccess = () => {
        try {
          const row = req.result as { state?: SyncState } | undefined;
          const { result: nextResult, state } = updater(normalize(row?.state ?? initialState(partition)));
          if (state.schema !== "rpg-nexus-mobile-v1" || partitionKey(state.partition) !== key) throw new Error("partition/schema mismatch");
          result = nextResult;
          store.put({ key, accountId: partition.accountId, state });
        } catch (error) { tx.abort(); reject(error); }
      };
      tx.oncomplete = () => resolve(clone(result));
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB update failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB update aborted"));
    });
  }
  async clearAccount(accountId: string): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, "devices"], "readwrite"), index = tx.objectStore(STORE_NAME).index("accountId");
      const request = index.openCursor(IDBKeyRange.only(accountId));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
      tx.objectStore("devices").delete(accountId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB account cleanup failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB account cleanup aborted"));
    });
  }
}

export function openSyncStore(): IndexedDbSyncStore { return new IndexedDbSyncStore(); }

export function pendingEntries(state: SyncState): OutboxEntry[] { return state.outbox.filter((entry) => entry.state === "queued" || entry.state === "inflight"); }

