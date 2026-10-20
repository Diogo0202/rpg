import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FastApiSyncTransport, IndexedDbSyncStore, SyncEngine, SyncHttpError, fieldValuesEqual, openSyncStore,
  type JsonValue, type SyncCampaign, type SyncCapabilities, type SyncChange, type SyncState, type SyncTransport,
} from "@/lib/mobile-sync/index.ts";
import { LOCAL_ACCOUNT_ID, LOCAL_CAMPAIGN_ID, LOCAL_CAMPAIGN_NAME, LOCAL_ENTITY_FIELDS, REMOTE_BOOTSTRAP_ENTITIES, LocalOnlyTransport, connectionStatus } from "./config";
import { getSupabaseAuth, getSupabaseConfigProblem, accessTokenProvider } from "./auth";
import { fromRemoteRecord, remoteEntityType, toRemoteCreate, toRemotePath, type RemotePathSet } from "./remote-adapter";
import { seedDemo } from "./seed";
import { prefGet, prefSet } from "./prefs";

export type Entity<T = Record<string, JsonValue>> = { type: string; id: string; version: number; data: T; pending: boolean; conflict: boolean };
export type PathSet = RemotePathSet;
export type NexusUser = { id: string; email: string | null };

type Ctx = {
  ready: boolean;
  error: string | null;
  engine: SyncEngine | null;
  state: SyncState | null;
  deviceId: string | null;
  mode: "local" | "connected";
  accountId: string;
  campaignId: string;
  campaignName: string;
  user: NexusUser | null;
  campaigns: SyncCampaign[];
  capabilities: SyncCapabilities | null;
  connectionMessage: string;
  list: <T = Record<string, JsonValue>>(type: string) => Entity<T>[];
  get: <T = Record<string, JsonValue>>(type: string, id: string | undefined | null) => Entity<T> | undefined;
  create: (type: string, data: Record<string, JsonValue>, opts?: { dependsOnEntities?: [string, string][]; id?: string }) => Promise<string>;
  update: (type: string, id: string, sets: PathSet[]) => Promise<boolean>;
  remove: (type: string, id: string) => Promise<void>;
  refresh: () => Promise<void>;
  wipeLocal: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshCampaigns: () => Promise<SyncCampaign[]>;
  connectCampaign: (campaignId: string) => Promise<void>;
  syncNow: () => Promise<void>;
  setLocalMode: () => Promise<void>;
  connectionConfigured: boolean;
};

const NexusContext = createContext<Ctx | null>(null);
const entityKey = (type: string, id: string) => `${type}\u0000${id}`;
const CAMPAIGN_CACHE = "nexus-cached-campaigns-v1:";
const CAPABILITIES_CACHE = "nexus-cached-capabilities-v1:";
const SELECTED_CAMPAIGN = "nexus-selected-campaign-v1:";
const DEMO_SEED_DISABLED = "nexus-local-demo-seed-disabled-v1";
const remoteToUi: Record<string, string> = { campaign_sessions: "journal_sessions", campaign_events: "journal_notes" };
const seedLocks = new Map<string, Promise<void>>();

function readPath(data: Record<string, JsonValue> | undefined, path: string[]): { exists: false } | { exists: true; value: JsonValue } {
  let node: JsonValue | undefined = data;
  for (const part of path) {
    if (!node || typeof node !== "object" || Array.isArray(node) || !Object.prototype.hasOwnProperty.call(node, part)) return { exists: false };
    node = node[part];
  }
  return node === undefined ? { exists: false } : { exists: true, value: node };
}
function clean(value: JsonValue): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
function statusOf(error: unknown): number | undefined { return error instanceof SyncHttpError ? error.status : undefined; }
function isOnlineTransportError(error: unknown): boolean { return statusOf(error) === 0 || (error instanceof TypeError && /fetch|network/i.test(error.message)); }

async function withSeedLock(name: string, task: () => Promise<void>): Promise<void> {
  const lockManager = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManager }).locks;
  if (lockManager) { await lockManager.request(name, { mode: "exclusive" }, task); return; }
  const prior = seedLocks.get(name) ?? Promise.resolve();
  const next = prior.then(task);
  seedLocks.set(name, next);
  try { await next; } finally { if (seedLocks.get(name) === next) seedLocks.delete(name); }
}

export async function seedLocalDemoOnce(engine: SyncEngine, disabled = false): Promise<void> {
  const name = `rpg-nexus-demo:${engine.partition.accountId}:${engine.partition.campaignId}`;
  await withSeedLock(name, async () => {
    const current = await engine.readState();
    if (!disabled && current.outbox.length === 0 && Object.keys(current.records).length === 0) await seedDemo(engine);
  });
}

export function NexusProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [state, setState] = useState<SyncState | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [records, setRecords] = useState<Map<string, Entity>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"local" | "connected">("local");
  const [accountId, setAccountId] = useState(LOCAL_ACCOUNT_ID);
  const [campaignId, setCampaignId] = useState(LOCAL_CAMPAIGN_ID);
  const [campaignName, setCampaignName] = useState(LOCAL_CAMPAIGN_NAME);
  const [user, setUser] = useState<NexusUser | null>(null);
  const [campaigns, setCampaigns] = useState<SyncCampaign[]>([]);
  const [capabilities, setCapabilities] = useState<SyncCapabilities | null>(null);
  const [connectionMessage, setConnectionMessage] = useState("");
  const storeRef = useRef<IndexedDbSyncStore | null>(null);
  const localEngineRef = useRef<SyncEngine | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const modeRef = useRef<"local" | "connected">("local");
  const env = import.meta.env as Record<string, string | undefined>;
  const auth = getSupabaseAuth();
  const apiBase = env.VITE_NEXUS_API_URL?.trim();
  const transport: SyncTransport | null = useMemo(() => {
    if (!auth || !apiBase) return null;
    try { return new FastApiSyncTransport({ baseUrl: apiBase, getAccessToken: accessTokenProvider(auth) }); }
    catch { return null; }
  }, [auth, apiBase]);

  const load = useCallback(async (eng: SyncEngine) => {
    const s = await eng.readState();
    const templateRows = Object.values(s.records).filter((record) => record.entity_type === "system_templates" && !record.deleted);
    const templateById = new Map(templateRows.map((record) => [record.id, record.data]));
    const ids = new Map<string, [string, string]>();
    for (const record of Object.values(s.records)) ids.set(entityKey(remoteToUi[record.entity_type] ?? record.entity_type, record.id), [record.entity_type, record.id]);
    for (const entry of s.outbox) ids.set(entityKey(remoteToUi[entry.mutation.entity_type] ?? entry.mutation.entity_type, entry.mutation.entity_id), [entry.mutation.entity_type, entry.mutation.entity_id]);
    const next = new Map<string, Entity>();
    await Promise.all([...ids.values()].map(async ([remoteType, id]) => {
      const record = await eng.getRecord(remoteType, id);
      if (!record || record.deleted) return;
      const type = remoteToUi[remoteType] ?? remoteType;
      const adapted = modeRef.current === "connected" ? fromRemoteRecord(type, record) : record;
      const data = { ...adapted.data } as Record<string, JsonValue>;
      if (type === "character_sheets" && modeRef.current === "connected") {
        const template = templateById.get(String(data.template_id));
        if (template) {
          data.system_key = typeof template.system_key === "string" ? template.system_key : String(data.template_id);
          data.template_name = typeof template.name === "string" ? template.name : "Modelo da campanha";
          data.template_version = typeof template.version === "number" ? template.version : 1;
          const schema = template.schema;
          if (schema && typeof schema === "object" && !Array.isArray(schema) && Array.isArray(schema.fields)) data.template_fields = schema.fields as JsonValue;
        }
        if (!Array.isArray(data.effects)) data.effects = [];
      }
      const pending = s.outbox.filter((entry) => entry.mutation.entity_type === remoteType && entry.mutation.entity_id === id);
      next.set(entityKey(type, id), { type, id, version: record.version, data, pending: pending.length > 0, conflict: pending.some((entry) => entry.state === "conflict") });
    }));
    setState(s); setRecords(next);
  }, []);

  const makeLocalEngine = useCallback(async (store: IndexedDbSyncStore) => {
    const device = await store.getOrCreateDeviceId(LOCAL_ACCOUNT_ID);
    const local = new SyncEngine({ accountId: LOCAL_ACCOUNT_ID, campaignId: LOCAL_CAMPAIGN_ID, deviceId: device, entityFields: LOCAL_ENTITY_FIELDS }, store, new LocalOnlyTransport());
    const disabled = await prefGet<boolean>(DEMO_SEED_DISABLED);
    await seedLocalDemoOnce(local, disabled === true);
    return { engine: local, device };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = openSyncStore(); storeRef.current = store;
        const { engine: local, device } = await makeLocalEngine(store);
        localEngineRef.current = local;
        if (cancelled) return;
        engineRef.current = local; modeRef.current = "local";
        setDeviceId(device); setEngine(local); setAccountId(LOCAL_ACCOUNT_ID); setCampaignId(LOCAL_CAMPAIGN_ID); setCampaignName(LOCAL_CAMPAIGN_NAME);
        await load(local);
        if (auth) {
          const session = await auth.auth.getSession();
          if (!session.error && session.data.session?.user) setUser({ id: session.data.session.user.id, email: session.data.session.user.email ?? null });
        }
      } catch (caught) { if (!cancelled) setError(caught instanceof Error ? caught.message : "Falha ao abrir o armazenamento local."); }
    })();
    return () => { cancelled = true; };
  }, [auth, load, makeLocalEngine]);

  const refresh = useCallback(async () => { if (engineRef.current) await load(engineRef.current); }, [load]);

  const list = useCallback(<T,>(type: string) => [...records.values()].filter((record) => record.type === type) as unknown as Entity<T>[], [records]);
  const get = useCallback(<T,>(type: string, id: string | undefined | null) => (id ? records.get(entityKey(type, id)) : undefined) as unknown as Entity<T> | undefined, [records]);

  const create = useCallback<Ctx["create"]>(async (type, input, opts) => {
    const active = engineRef.current;
    if (!active) throw new Error("Armazenamento local indisponível.");
    const remote = modeRef.current === "connected" ? toRemoteCreate(type, input) : { entityType: type, data: input };
    const current = await active.readState();
    const dependsOn = (opts?.dependsOnEntities ?? []).flatMap(([t, id]) => {
      const entityType = modeRef.current === "connected" ? remoteEntityType(t) : t;
      return current.outbox.filter((entry) => entry.mutation.entity_type === entityType && entry.mutation.entity_id === id && entry.state !== "accepted").map((entry) => entry.mutation.operation_id);
    });
    const changes: SyncChange[] = Object.entries(remote.data).filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({ path: [key], before: { exists: false }, after: { exists: true, value: clean(value) } }));
    const mutation = await active.enqueue({ entityType: remote.entityType, action: "create", changes, dependsOn, ...(opts?.id ? { entityId: opts.id } : {}) });
    await load(active); return mutation.entity_id;
  }, [load]);

  const update = useCallback<Ctx["update"]>(async (type, id, sets) => {
    const active = engineRef.current;
    if (!active) throw new Error("Armazenamento local indisponível.");
    const entityType = modeRef.current === "connected" ? remoteEntityType(type) : type;
    const current = await active.getRecord(entityType, id);
    if (!current || current.deleted) throw new Error("Registro não encontrado.");
    const logical = modeRef.current === "connected" ? fromRemoteRecord(type, current) : current;
    const changes: SyncChange[] = [];
    for (const set of sets) {
      const mapped = modeRef.current === "connected" ? toRemotePath(type, set.path, set.value) : { entityType, path: set.path, value: set.value };
      if (!mapped) continue;
      const before = readPath(logical.data, set.path);
      const after = mapped.value === undefined ? { exists: false as const } : { exists: true as const, value: clean(mapped.value) };
      if (fieldValuesEqual(before, after)) continue;
      const rawBefore = readPath(current.data, mapped.path);
      changes.push({ path: mapped.path, before: rawBefore, after });
    }
    if (!changes.length) return false;
    await active.enqueue({ entityType, entityId: id, action: "update", changes });
    await load(active); return true;
  }, [load]);

  const remove = useCallback<Ctx["remove"]>(async (type, id) => {
    const active = engineRef.current;
    if (!active) throw new Error("Armazenamento local indisponível.");
    await active.enqueue({ entityType: modeRef.current === "connected" ? remoteEntityType(type) : type, entityId: id, action: "delete" });
    await load(active);
  }, [load]);

  const signIn = useCallback<Ctx["signIn"]>(async (email, password) => {
    if (!auth) throw new Error("Informe VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para habilitar a entrada.");
    const response = await auth.auth.signInWithPassword({ email: email.trim(), password });
    if (response.error) throw response.error;
    if (!response.data.user) throw new Error("A autenticação não retornou uma conta.");
    setUser({ id: response.data.user.id, email: response.data.user.email ?? null });
    setConnectionMessage("Entrada concluída. Escolha uma campanha para carregar os dados autorizados.");
  }, [auth]);

  const signOut = useCallback<Ctx["signOut"]>(async () => {
    if (auth) { const response = await auth.auth.signOut(); if (response.error) throw response.error; }
    const local = localEngineRef.current;
    setUser(null); setCampaigns([]); setCapabilities(null); setConnectionMessage("Sessão encerrada. Dados locais e caches remotos seguem separados.");
    modeRef.current = "local"; setMode("local"); setAccountId(LOCAL_ACCOUNT_ID); setCampaignId(LOCAL_CAMPAIGN_ID); setCampaignName(LOCAL_CAMPAIGN_NAME);
    if (local) { engineRef.current = local; setEngine(local); setDeviceId(local.partition.deviceId); await load(local); }
  }, [auth, load]);

  const refreshCampaigns = useCallback<Ctx["refreshCampaigns"]>(async () => {
    if (!user) throw new Error("Entre em uma conta existente antes de carregar campanhas.");
    const cacheKey = `${CAMPAIGN_CACHE}${user.id}`;
    if (!transport) {
      const cached = await prefGet<SyncCampaign[]>(cacheKey) ?? [];
      setCampaigns(cached); setConnectionMessage("API sem configuração. Lista em cache, se houver.");
      if (cached.length) return cached;
      throw new Error("Informe VITE_NEXUS_API_URL para carregar campanhas.");
    }
    try {
      const rows = await transport.listCampaigns();
      await prefSet(cacheKey, rows); setCampaigns(rows); setConnectionMessage(`${rows.length} campanha(s) autorizada(s) pela API.`);
      return rows;
    } catch (caught) {
      if (statusOf(caught) === 403) throw caught;
      const cached = await prefGet<SyncCampaign[]>(cacheKey) ?? [];
      setCampaigns(cached);
      if (cached.length && (isOnlineTransportError(caught) || statusOf(caught) === 0)) {
        setConnectionMessage("Sem rede. Lista de campanhas em cache; a API continua sendo a autoridade de acesso."); return cached;
      }
      throw caught;
    }
  }, [transport, user]);

  const connectCampaign = useCallback<Ctx["connectCampaign"]>(async (requestedId) => {
    if (!user) throw new Error("Entre em uma conta existente antes de escolher uma campanha.");
    const selected = campaigns.find((campaign) => campaign.id === requestedId) ?? (await refreshCampaigns()).find((campaign) => campaign.id === requestedId);
    if (!selected) throw new Error("A campanha não está na lista recebida da API.");
    const capsKey = `${CAPABILITIES_CACHE}${user.id}:${requestedId}`;
    let caps: SyncCapabilities | undefined;
    if (transport) {
      try { caps = await transport.capabilities(requestedId); await prefSet(capsKey, caps); }
      catch (caught) {
        if (statusOf(caught) === 403 || statusOf(caught) === 401) throw caught;
        caps = await prefGet<SyncCapabilities>(capsKey);
        if (!caps) throw new Error("Sem conexão e sem capacidades em cache para esta campanha.");
        setConnectionMessage("Sem rede. Capacidades anteriores em cache; a API valida cada gravação quando voltar.");
      }
    } else caps = await prefGet<SyncCapabilities>(capsKey);
    if (!caps || caps.campaign_id !== requestedId || caps.protocol_version !== 1) throw new Error("Não há capacidades válidas em cache para esta campanha.");
    if (!storeRef.current) throw new Error("O armazenamento local ainda não abriu.");
    const device = await storeRef.current.getOrCreateDeviceId(user.id);
    const remoteTransport = transport ?? new LocalOnlyTransport();
    const remoteEngine = new SyncEngine({ accountId: user.id, campaignId: requestedId, deviceId: device, entityFields: caps.entity_fields }, storeRef.current, remoteTransport);
    engineRef.current = remoteEngine; modeRef.current = "connected";
    setEngine(remoteEngine); setMode("connected"); setAccountId(user.id); setCampaignId(requestedId); setCampaignName(selected.name); setCapabilities(caps); setDeviceId(device); setError(null);
    await prefSet(`${SELECTED_CAMPAIGN}${user.id}`, requestedId);
    await load(remoteEngine);
    const current = await remoteEngine.readState();
    if (current.cursor === null && Object.keys(current.records).length === 0) {
      try { await remoteEngine.bootstrap([...REMOTE_BOOTSTRAP_ENTITIES]); await load(remoteEngine); }
      catch (caught) {
        await load(remoteEngine);
        const after = await remoteEngine.readState();
        if (!Object.keys(after.records).length && !after.outbox.length) throw caught;
        setConnectionMessage(caught instanceof Error ? `Cache local aberto; sincronização pendente: ${caught.message}` : "Cache local aberto; a conexão aguarda rede.");
      }
    }
    setConnectionMessage((prior) => prior || `Campanha ${selected.name} carregada com regras de acesso do servidor.`);
  }, [campaigns, load, refreshCampaigns, transport, user]);

  const syncNow = useCallback<Ctx["syncNow"]>(async () => {
    const active = engineRef.current;
    if (!active || modeRef.current !== "connected") throw new Error("Escolha uma campanha conectada antes de sincronizar.");
    const report = await active.sync();
    await load(active);
    if (report.reason === "revoked") throw new Error("A campanha recusou o acesso. O cache autorizado foi limpo.");
    if (report.reason === "reauth_required") throw new Error("A sessão expirou. Entre novamente para sincronizar.");
    if (report.reason === "network" || report.reason === "retry_later") {
      setConnectionMessage(report.reason === "retry_later" ? "A API pediu nova tentativa mais tarde; alterações continuam na fila local." : "Sem rede; alterações mantidas na fila local.");
      return;
    }
    await active.pull(); await load(active);
    setConnectionMessage(`${report.applied} operação(ões) aceita(s); alterações remotas carregadas.`);
  }, [load]);

  const setLocalMode = useCallback<Ctx["setLocalMode"]>(async () => {
    if (!storeRef.current) throw new Error("O armazenamento local ainda não abriu.");
    await prefSet(DEMO_SEED_DISABLED, false);
    const { engine: local, device } = await makeLocalEngine(storeRef.current);
    localEngineRef.current = local; engineRef.current = local; modeRef.current = "local";
    setMode("local"); setAccountId(LOCAL_ACCOUNT_ID); setCampaignId(LOCAL_CAMPAIGN_ID); setCampaignName(LOCAL_CAMPAIGN_NAME); setDeviceId(device); setEngine(local); setCapabilities(null); setError(null);
    await load(local);
  }, [load, makeLocalEngine]);

  const wipeLocal = useCallback(async () => {
    const active = engineRef.current;
    if (!active) return;
    setRecords(new Map()); setState(null);
    try {
      await active.logout();
      if (modeRef.current === "local") await prefSet(DEMO_SEED_DISABLED, true);
      await load(active);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível limpar o armazenamento local."); throw caught; }
  }, [load]);

  const value = useMemo<Ctx>(() => ({
    ready: !!engine && !!state, error, engine, state, deviceId, mode, accountId, campaignId, campaignName, user, campaigns, capabilities, connectionMessage,
    list, get, create, update, remove, refresh, wipeLocal, signIn, signOut, refreshCampaigns, connectCampaign, syncNow, setLocalMode,
    connectionConfigured: connectionStatus(mode).apiUrlConfigured && connectionStatus(mode).supabaseUrlConfigured && connectionStatus(mode).publishableKeyConfigured,
  }), [engine, state, deviceId, error, mode, accountId, campaignId, campaignName, user, campaigns, capabilities, connectionMessage,
    list, get, create, update, remove, refresh, wipeLocal, signIn, signOut, refreshCampaigns, connectCampaign, syncNow, setLocalMode]);
  return <NexusContext.Provider value={value}>{children}</NexusContext.Provider>;
}

export function useNexus(): Ctx {
  const context = useContext(NexusContext);
  if (!context) throw new Error("useNexus must be used inside NexusProvider");
  return context;
}

export function outboxSummary(state: SyncState | null) {
  const out = state?.outbox ?? [];
  return {
    total: out.length,
    queued: out.filter((entry) => entry.state === "queued" || entry.state === "inflight").length,
    conflicts: out.filter((entry) => entry.state === "conflict").length,
    blocked: out.filter((entry) => ["denied", "invalid", "dependency_failed"].includes(entry.state)).length,
  };
}
