import { createSyncId, syncPartitionKey, SyncHttpError, parseRetryAfter, type SyncPartition } from "../sync/core.ts";
import { emptyCompanySnapshot, makeCompanyCommand, optimisticSnapshot, projectCompanySnapshot, validateCompanyCommand, type CompanyCommand, type CompanyKind, type CompanyRole, type CompanySnapshot, type CompanySyncState, type CompanyQueueEntry } from "./company-sync.ts";
import { clearRingDraftAccount } from "./drafts.ts";

const DB = "rpg-nexus-one-ring-company-v1";
const TABLE = "partitions";
export type CompanyPartition = SyncPartition;
export class CompanyHttpError extends SyncHttpError { constructor(status:number,message:string,retryAfterMs?:number){super(message,status,retryAfterMs);this.name="CompanyHttpError";} }
export interface CompanyTransport { get(): Promise<CompanySnapshot>; command(command: CompanyCommand): Promise<CompanySnapshot> }
export interface CompanyStore { read(p: CompanyPartition): Promise<CompanySyncState>; write(p: CompanyPartition, change: (state: CompanySyncState) => CompanySyncState): Promise<CompanySyncState>; clearAccount(accountId: string): Promise<void> }

const key=syncPartitionKey;
function clone<T>(value: T): T { return structuredClone(value); }
function initial(p: CompanyPartition): CompanySyncState { return { schema: "one-ring-company-v1", account_id: p.accountId, campaign_id: p.campaignId, device_id: p.deviceId, snapshot: null, queue: [], paused: false, updated_at: Date.now() }; }

export class CompanyOfflineStore {
  private readonly indexedDBFactory: IDBFactory;
  constructor(indexedDBFactory: IDBFactory = globalThis.indexedDB) {
    this.indexedDBFactory = indexedDBFactory;
    if (!indexedDBFactory) throw new Error("IndexedDB indisponível.");
  }
  private db?: Promise<IDBDatabase>;
  private open() { return this.db ??= new Promise((resolve, reject) => {
    const request = this.indexedDBFactory.open(DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(TABLE)) { const store = request.result.createObjectStore(TABLE, { keyPath: "key" }); store.createIndex("account_id", "account_id", { unique: false }); } };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error("Atualização do IndexedDB bloqueada."));
  }); }
  async read(p: CompanyPartition): Promise<CompanySyncState> {
    const db = await this.open(); return new Promise((resolve, reject) => { const tx = db.transaction(TABLE, "readonly"), req = tx.objectStore(TABLE).get(key(p)); req.onsuccess = () => resolve(clone(req.result?.state ?? initial(p))); req.onerror = () => reject(req.error); });
  }
  async write(p: CompanyPartition, change: (state: CompanySyncState) => CompanySyncState): Promise<CompanySyncState> {
    const db = await this.open(); return new Promise((resolve, reject) => { const tx = db.transaction(TABLE, "readwrite"), store = tx.objectStore(TABLE), req = store.get(key(p)); let result: CompanySyncState; req.onsuccess = () => { try { result = change(clone(req.result?.state ?? initial(p))); if (result.schema !== "one-ring-company-v1" || result.account_id !== p.accountId || result.campaign_id !== p.campaignId || result.device_id !== p.deviceId) throw new Error("Partição local incompatível."); store.put({ key: key(p), account_id: p.accountId, state: result }); } catch (error) { tx.abort(); reject(error); } }; tx.oncomplete = () => resolve(clone(result)); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }
  async clearAccount(accountId: string) { const db = await this.open(); await new Promise<void>((resolve, reject) => { const tx = db.transaction(TABLE, "readwrite"), cursor = tx.objectStore(TABLE).index("account_id").openCursor(IDBKeyRange.only(accountId)); cursor.onsuccess = () => { const row = cursor.result; if (row) { row.delete(); row.continue(); } }; tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
}

export type CompanyOfflineContext = { accountId: string; campaignId: string; viewerId: string; role: CompanyRole; deviceId: string };
export async function saveOfflineContext(context: CompanyOfflineContext, store: CompanyStore = new CompanyOfflineStore()): Promise<void> {
  if (context.accountId !== context.viewerId) throw new Error("A identidade offline precisa corresponder à conta autenticada.");
  await store.write({ accountId: context.accountId, campaignId: context.campaignId, deviceId: context.deviceId }, (state) => ({ ...state, viewer_id: context.viewerId, viewer_role: context.role, updated_at: Date.now() }));
  if (typeof localStorage !== "undefined") localStorage.setItem("one-ring-company-active-account", context.accountId);
}
export async function getOfflineContext(accountId: string, campaignId: string, deviceId: string, store: CompanyStore = new CompanyOfflineStore()): Promise<CompanyOfflineContext | null> {
  if (typeof localStorage === "undefined" || localStorage.getItem("one-ring-company-active-account") !== accountId) return null;
  const state = await store.read({ accountId, campaignId, deviceId });
  if (state.viewer_id !== accountId || !state.viewer_role || state.queue.some((entry) => entry.state === "denied")) return null;
  return { accountId, campaignId, viewerId: state.viewer_id, role: state.viewer_role, deviceId };
}
export async function clearOfflineAccount(accountId: string, store: CompanyStore = new CompanyOfflineStore()): Promise<void> {
  if (typeof localStorage !== "undefined" && localStorage.getItem("one-ring-company-active-account") === accountId) localStorage.removeItem("one-ring-company-active-account");
  await Promise.all([store.clearAccount(accountId), ...(typeof indexedDB === "undefined" ? [] : [clearRingDraftAccount(accountId)])]);
}

export class CompanySyncEngine {
  readonly partition: CompanyPartition;
  private readonly store: CompanyStore;
  private readonly transport: CompanyTransport;
  private readonly makeId: () => string;
  private flushing?: Promise<{ applied: number; paused: boolean; reason?: string; status?: number }>;
  constructor(partition: CompanyPartition, store: CompanyStore, transport: CompanyTransport, makeId: () => string = createSyncId) { this.partition = Object.freeze({ ...partition }); this.store = store; this.transport = transport; this.makeId = makeId; }
  async state() { return this.store.read(this.partition); }
  async snapshot() { const state = await this.state(); return state.snapshot ? projectCompanySnapshot(state.snapshot, state.queue) : null; }
  async accept(role: CompanyRole, actorId: string, kind: CompanyKind, payload: Record<string, unknown>) {
    let command!: CompanyCommand;
    const state = await this.store.write(this.partition, (current) => {
      if (actorId !== this.partition.accountId || current.viewer_id !== actorId || current.viewer_role !== role) throw new Error("Prepare o acesso autenticado desta conta antes de editar offline.");
      const base = current.snapshot ?? emptyCompanySnapshot(), projected = projectCompanySnapshot(base, current.queue);
      const issue = validateCompanyCommand(projected, role, actorId, kind, payload); if (issue) throw new Error(issue);
      if (current.paused || current.queue.some((entry) => entry.state !== "queued")) throw new Error("Resolva a fila pendente antes de registrar outra operação.");
      if (kind === "add_member" && projected.company?.id.startsWith("pending:")) throw new Error("Aguarde a criação da Companhia ser confirmada antes de adicionar fichas.");
      const version = (projected.company?.version ?? 0);
      command = makeCompanyCommand(kind, payload, version, this.makeId);
      current.queue.push({ command, state: "queued", created_at: Date.now() }); current.updated_at = Date.now(); return current;
    });
    return { state, command };
  }
  private verifySnapshot(snapshot: CompanySnapshot) { if (snapshot.company && snapshot.company.campaign_id !== this.partition.campaignId) throw new Error("Resposta de outra campanha recusada."); }
  private async revoke() { await this.store.write(this.partition, (state) => ({ ...state, snapshot: null, candidates:[], ended_sessions:[], approved_templates:[], viewer_id: undefined, viewer_role: undefined, paused: true, queue: state.queue.map((entry) => ({ ...entry, state: "denied" as const, reason: "Acesso revogado. Entre na campanha para revisar as pendências." })) })); }
  async refresh() { try { const fresh = await this.transport.get(); this.verifySnapshot(fresh); return await this.store.write(this.partition, (state) => ({ ...state, snapshot: (state.snapshot?.company?.version ?? 0) > (fresh.company?.version ?? 0) ? state.snapshot : fresh, updated_at: Date.now() })); } catch (error) { if (error instanceof CompanyHttpError && [401, 403, 404].includes(error.status)) await this.revoke(); throw error; } }
  flush() { return this.flushing ??= this.flushQueue().finally(() => { this.flushing = undefined; }); }
  private async flushQueue() {
    let applied = 0;
    while (true) {
      const state = await this.state(); if(state.retry_at && state.retry_at>Date.now())return{applied,paused:true,reason:"Aguarde o prazo de nova tentativa indicado pelo servidor."}; if (state.paused) return { applied, paused: true };
      const head = state.queue[0]; if (!head || head.state !== "queued") return { applied, paused: Boolean(head) };
      try {
        const snapshot = await this.transport.command(head.command);
        this.verifySnapshot(snapshot);
        await this.store.write(this.partition, (current) => ({ ...current, retry_at:undefined, snapshot: (current.snapshot?.company?.version ?? 0) > (snapshot.company?.version ?? 0) ? current.snapshot : snapshot, queue: current.queue.filter((entry) => entry.command.operation_id !== head.command.operation_id), updated_at: Date.now() })); applied++;
      } catch (error) {
        const http = error instanceof CompanyHttpError ? error.status : 0;
        if ([401, 403, 404].includes(http)) { await this.revoke(); return { applied, paused: true, reason: error instanceof Error ? error.message : "Acesso recusado.", status: http }; }
        await this.store.write(this.partition, (current) => { const entry = current.queue.find((item) => item.command.operation_id === head.command.operation_id); if (entry) { entry.state = http === 409 ? "conflict" : http === 401 || http === 403 ? "denied" : http === 422 ? "invalid" : "queued"; entry.reason = error instanceof Error ? error.message : "Falha de rede."; } if(error instanceof CompanyHttpError && error.retryAfterMs!==undefined)current.retry_at=Date.now()+error.retryAfterMs; current.paused = http === 401 || http === 403 || http === 409 || http === 422; current.updated_at = Date.now(); return current; });
        if(http===409){try{await this.refresh();}catch{/* A fila permanece pendente até confirmar o estado do servidor. */}}
        return { applied, paused: true, reason: error instanceof Error ? error.message : "Falha de rede.", status: http };
      }
    }
  }
  async reapplyConflict(operationId: string) {
    const fresh = await this.transport.get();
    this.verifySnapshot(fresh);
    return this.store.write(this.partition, (state) => { const i = state.queue.findIndex((e) => e.command.operation_id === operationId && e.state === "conflict"); if (i !== 0) throw new Error("Conflito não encontrado no início da fila."); state.snapshot = fresh; this.rebase(state); return state; });
  }
  private rebase(state: CompanySyncState) { let snapshot = state.snapshot ?? emptyCompanySnapshot(); for (const entry of state.queue) { const issue = validateCompanyCommand(snapshot, state.viewer_role ?? "guest", state.viewer_id ?? "", entry.command.kind, entry.command.payload); if (issue) throw new Error(issue); entry.command = makeCompanyCommand(entry.command.kind, entry.command.payload, snapshot.company?.version ?? 0, this.makeId); entry.state = "queued"; entry.reason = undefined; snapshot = optimisticSnapshot(snapshot, entry.command); } state.paused = false; state.updated_at = Date.now(); }
  async discard(operationId: string) { return this.store.write(this.partition, (state) => { const i = state.queue.findIndex((e) => e.command.operation_id === operationId); if (i < 0) throw new Error("Operação não encontrada."); if (state.queue[i].state === "queued") throw new Error("Confirme a resposta pendente antes de descartar esta operação."); if (state.queue[i].state === "denied") throw new Error("Entre na campanha para revisar o acesso antes de alterar esta fila."); state.queue.splice(i, 1); this.rebase(state); return state; }); }
}

export function createCompanyHttpTransport(campaignId: string, getAccessToken: () => Promise<string | null>, baseUrl = "") : CompanyTransport {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/campaigns/${encodeURIComponent(campaignId)}/one-ring/company`;
  async function request(path: string, init: RequestInit = {}) {
    const token = await getAccessToken(); if (!token) throw new CompanyHttpError(401, "Entre novamente para sincronizar as operações guardadas.");
    const response = await fetch(path, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init.headers } });
    if (!response.ok) { const body = await response.json().catch(() => null) as { detail?: string; message?: string } | null; throw new CompanyHttpError(response.status, body?.detail ?? body?.message ?? `Falha HTTP ${response.status}.`,parseRetryAfter(response.headers.get("Retry-After"))); }
    return response.json() as Promise<CompanySnapshot>;
  }
  return { get: () => request(url), command: (command) => request(`${url}/commands`, { method: "POST", body: JSON.stringify(command) }) };
}

export function projectedSnapshot(snapshot: CompanySnapshot, queue: CompanyQueueEntry[]) { return projectCompanySnapshot(snapshot, queue); }
