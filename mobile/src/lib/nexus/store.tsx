import { clearTableAccount, blockTableCampaign, restoreTableCampaign } from "@/lib/game/table-queue-storage";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FastApiSyncTransport,
  SyncEngine,
  fieldValuesEqual,
  openSyncStore,
  type IndexedDbSyncStore,
  type SyncCampaign,
  type SyncCapabilities,
  type SyncChange,
  type SyncState,
  type SyncTransport,
} from "@/lib/mobile-sync/index.ts";
import { accountCache, validCapabilities } from "./account-cache";
import {
  LOCAL_ACCOUNT_ID,
  LOCAL_CAMPAIGN_ID,
  LOCAL_CAMPAIGN_NAME,
  REMOTE_BOOTSTRAP_ENTITIES,
  LocalOnlyTransport,
  connectionStatus,
} from "./config";
import { getSupabaseAuth, accessTokenProvider } from "./auth";
import { openLocalEngine } from "./local-demo";
import {
  cloneJson,
  creationChanges,
  entityKey,
  httpStatusOf,
  isJsonObject,
  isNetworkError,
  knownEntityIds,
  nextSessionSequence,
  pendingOperationIds,
  readPath,
  sheetFieldRoles,
  sheetValueChanges,
  templatesById,
  toEntity,
} from "./records";
import { fromRemoteRecord, remoteEntityType, toRemoteCreate, toRemotePath } from "./remote-adapter";
import { useAutoSync } from "./use-auto-sync";
import { NexusContext, type Entity, type NexusContextValue as Ctx, type NexusUser, type PathSet } from "./context";

export type { Entity, NexusUser, PathSet };
export type NexusStoreValue = Ctx;
export { NexusContext } from "./context";
export { seedLocalDemoOnce } from "./local-demo";
export { outboxSummary } from "./records";

type Mode = "local" | "connected";

/** Partição aberta: o motor e a campanha que a interface está mostrando. */
type Partition = {
  engine: SyncEngine | null;
  mode: Mode;
  accountId: string;
  campaignId: string;
  campaignName: string;
  capabilities: SyncCapabilities | null;
  deviceId: string | null;
};

const LOCAL_PARTITION: Partition = {
  engine: null,
  mode: "local",
  accountId: LOCAL_ACCOUNT_ID,
  campaignId: LOCAL_CAMPAIGN_ID,
  campaignName: LOCAL_CAMPAIGN_NAME,
  capabilities: null,
  deviceId: null,
};

const ACCOUNT_CHANGED_LOADING = "A conta mudou durante o carregamento.";
const ACCOUNT_CHANGED_OPENING = "A conta mudou durante a abertura da campanha.";
const PARTITION_CHANGED_SYNCING = "A conta ou campanha ativa mudou durante a sincronização.";

function userOf(account: { id: string; email?: string | null }): NexusUser {
  return { id: account.id, email: account.email ?? null };
}

export function NexusProvider({ children }: { children: ReactNode }) {
  const [partition, setPartition] = useState<Partition>(LOCAL_PARTITION);
  const [state, setState] = useState<SyncState | null>(null);
  const [records, setRecords] = useState<Map<string, Entity>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<NexusUser | null>(null);
  const [campaigns, setCampaigns] = useState<SyncCampaign[]>([]);
  const [connectionMessage, setConnectionMessage] = useState("");
  const authAccountRef = useRef<string | null>(null);
  const authStateObservedRef = useRef(false);
  const storeRef = useRef<IndexedDbSyncStore | null>(null);
  const localEngineRef = useRef<SyncEngine | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const modeRef = useRef<Mode>("local");
  const env = import.meta.env as Record<string, string | undefined>;
  const auth = getSupabaseAuth();
  const apiBase = env.VITE_NEXUS_API_URL?.trim();
  const { engine, mode, accountId, campaignId, campaignName, capabilities, deviceId } = partition;

  const transportForAccount = useCallback((expectedAccountId: string): SyncTransport | null => {
    if (!auth || !apiBase) return null;
    try {
      return new FastApiSyncTransport({ baseUrl: apiBase, getAccessToken: accessTokenProvider(auth, expectedAccountId) });
    } catch {
      return null;
    }
  }, [auth, apiBase]);

  /** Lança erro se a conta mudou desde o início de uma operação assíncrona. */
  const assertAccount = useCallback((accountAtStart: string, message: string) => {
    if (authAccountRef.current !== accountAtStart) throw new Error(message);
  }, []);

  const load = useCallback(async (eng: SyncEngine) => {
    const current = await eng.readState();
    if (current.accessRevoked) await blockTableCampaign(eng.partition.accountId, eng.partition.campaignId);
    const connected = modeRef.current === "connected";
    const templates = templatesById(current);
    const next = new Map<string, Entity>();
    await Promise.all(knownEntityIds(current).map(async ([remoteType, id]) => {
      const record = await eng.getRecord(remoteType, id);
      if (!record || record.deleted) return;
      const entity = toEntity(remoteType, record, current, connected, templates);
      next.set(entityKey(entity.type, id), entity);
    }));
    if (engineRef.current !== eng) return;
    setRecords(next);
    setState(current);
  }, []);

  /** Troca a partição aberta e mantém os refs em sincronia com o estado. */
  const activate = useCallback((next: Partition) => {
    engineRef.current = next.engine;
    modeRef.current = next.mode;
    setPartition(next);
  }, []);

  const activateLocal = useCallback((local: SyncEngine | null) => {
    engineRef.current = local;
    modeRef.current = "local";
    setPartition((prior) => ({
      ...LOCAL_PARTITION,
      engine: local ?? prior.engine,
      deviceId: local?.partition.deviceId ?? prior.deviceId,
    }));
  }, []);

  /** Cria o motor da campanha; `stillValid` é conferido depois da busca do aparelho, antes de criar. */
  const openConnectedEngine = useCallback(async (
    account: string, campaignId: string, caps: SyncCapabilities, transport: SyncTransport | null, stillValid: () => boolean,
  ) => {
    const store = storeRef.current;
    if (!store) throw new Error("O armazenamento local ainda não abriu.");
    const device = await store.getOrCreateDeviceId(account);
    if (!stillValid()) return null;
    const remote = new SyncEngine(
      { accountId: account, campaignId, deviceId: device, entityFields: caps.entity_fields },
      store,
      transport ?? new LocalOnlyTransport(),
    );
    return { remote, device };
  }, []);

  /** Reabre a última campanha da conta a partir do cache, sem sincronizar. */
  const reopenCachedCampaign = useCallback(async (account: { id: string; email?: string | null }, isCancelled: () => boolean) => {
    const gone = () => isCancelled() || authAccountRef.current !== account.id;
    setUser(userOf(account));
    const [cached, requested] = await Promise.all([accountCache.campaigns(account.id), accountCache.selectedCampaign(account.id)]);
    if (gone()) return;
    setCampaigns(cached);
    const selectedId = requested || cached[0]?.id;
    if (!selectedId || !storeRef.current) return;
    const caps = await accountCache.capabilities(account.id, selectedId);
    if (gone() || !validCapabilities(caps, selectedId)) return;
    const name = cached.find((row) => row.id === selectedId)?.name ?? "Campanha em cache";
    const opened = await openConnectedEngine(account.id, selectedId, caps, transportForAccount(account.id), () => !gone());
    if (!opened) return;
    const { remote, device } = opened;
    activate({ engine: remote, mode: "connected", accountId: account.id, campaignId: selectedId, campaignName: name, capabilities: caps, deviceId: device });
    setConnectionMessage("Cache desta conta reaberto. A sincronização exige uma ação explícita.");
    await load(remote);
  }, [activate, load, openConnectedEngine, transportForAccount]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = openSyncStore();
        storeRef.current = store;
        const local = await openLocalEngine(store);
        localEngineRef.current = local;
        if (cancelled) return;
        activate({ ...LOCAL_PARTITION, engine: local, deviceId: local.partition.deviceId });
        await load(local);
        if (!auth) return;
        const session = await auth.auth.getSession();
        const account = session.data.session?.user;
        if (session.error || !account) return;
        if (authStateObservedRef.current && authAccountRef.current !== account.id) return;
        authAccountRef.current = account.id;
        await reopenCachedCampaign(account, () => cancelled);
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Falha ao abrir o armazenamento local.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activate, auth, load, reopenCachedCampaign]);

  useEffect(() => {
    if (!auth) return;
    const { data: { subscription } } = auth.auth.onAuthStateChange((_event, session) => {
      authStateObservedRef.current = true;
      const nextUser = session?.user ?? null;
      const nextAccountId = nextUser?.id ?? null;
      const priorAccountId = authAccountRef.current;
      if (nextAccountId === priorAccountId) return;

      // Keep this SDK callback synchronous. Detach the old partition immediately;
      // account cleanup runs outside the SDK callback.
      authAccountRef.current = nextAccountId;
      if (priorAccountId && !nextAccountId) {
        void clearTableAccount(priorAccountId).catch((failure) => setError(String(failure)));
        void storeRef.current?.clearAccount(priorAccountId).catch((failure) => setError(String(failure)));
      }
      const local = localEngineRef.current;
      if (engineRef.current && engineRef.current.partition.accountId !== LOCAL_ACCOUNT_ID) {
        activateLocal(local);
        setRecords(new Map());
        setState(null);
        if (local) queueMicrotask(() => { void load(local).catch(() => undefined); });
      }
      setUser(nextUser ? userOf(nextUser) : null);
      setCampaigns([]);
      setPartition((prior) => ({ ...prior, capabilities: null }));
      setConnectionMessage(nextUser
        ? "A conta mudou. O cache anterior foi fechado, e as pendências continuam guardadas na conta original."
        : "Sessão encerrada. As pendências permanecem guardadas na conta original.");
    });
    return () => subscription.unsubscribe();
  }, [activateLocal, auth, load]);

  const refresh = useCallback(async () => {
    if (engineRef.current) await load(engineRef.current);
  }, [load]);

  const list = useCallback(
    <T,>(type: string) => [...records.values()].filter((record) => record.type === type) as unknown as Entity<T>[],
    [records],
  );
  const get = useCallback(
    <T,>(type: string, id: string | undefined | null) =>
      (id ? records.get(entityKey(type, id)) : undefined) as unknown as Entity<T> | undefined,
    [records],
  );

  const requireEngine = useCallback(() => {
    const active = engineRef.current;
    if (!active) throw new Error("Armazenamento local indisponível.");
    return active;
  }, []);

  const create = useCallback<Ctx["create"]>(async (type, input, opts) => {
    const active = requireEngine();
    const connected = modeRef.current === "connected";
    const current = await active.readState();
    const createInput = connected && type === "journal_sessions" && input.sequence === undefined
      ? { ...input, sequence: nextSessionSequence(current), status: input.status ?? "planned" }
      : input;
    const remote = connected ? toRemoteCreate(type, createInput) : { entityType: type, data: input };
    const dependsOn = (opts?.dependsOnEntities ?? []).flatMap(([dependencyType, id]) =>
      pendingOperationIds(current.outbox, connected ? remoteEntityType(dependencyType) : dependencyType, id));
    const mutation = await active.enqueue({
      entityType: remote.entityType,
      action: "create",
      changes: creationChanges(remote.data),
      dependsOn,
      ...(opts?.id ? { entityId: opts.id } : {}),
    });
    await load(active);
    return mutation.entity_id;
  }, [load, requireEngine]);

  const update = useCallback<Ctx["update"]>(async (type, id, sets) => {
    const active = requireEngine();
    const connected = modeRef.current === "connected";
    const entityType = connected ? remoteEntityType(type) : type;
    const current = await active.getRecord(entityType, id);
    if (!current || current.deleted) throw new Error("Registro não encontrado.");
    const logical = connected ? fromRemoteRecord(type, current).data : current.data;
    const deltas: { fieldId: string; delta: number }[] = [];
    const changes: SyncChange[] = [];
    for (const set of sets) {
      if (connected && type === "character_sheets" && set.path.length === 1 && set.path[0] === "values" && isJsonObject(set.value)) {
        const templateId = typeof current.data.template_id === "string" ? current.data.template_id : "";
        const template = templateId ? await active.getRecord("system_templates", templateId) : undefined;
        const schema = isJsonObject(template?.data.schema) ? template.data.schema : {};
        const prior = isJsonObject(logical.values) ? logical.values : {};
        const split = sheetValueChanges(prior, set.value, sheetFieldRoles(schema));
        deltas.push(...split.deltas);
        changes.push(...split.changes);
        continue;
      }
      const mapped = connected ? toRemotePath(type, set.path, set.value) : { entityType, path: set.path, value: set.value };
      if (!mapped) continue;
      const before = readPath(logical, set.path);
      const after = mapped.value === undefined ? { exists: false as const } : { exists: true as const, value: cloneJson(mapped.value) };
      if (fieldValuesEqual(before, after)) continue;
      changes.push({ path: mapped.path, before: readPath(current.data, mapped.path), after });
    }
    for (const item of deltas) await active.enqueueSheetAdjustment(id, item.fieldId, item.delta);
    if (changes.length) await active.enqueue({ entityType, entityId: id, action: "update", changes });
    if (!changes.length && !deltas.length) return false;
    await load(active);
    return true;
  }, [load, requireEngine]);

  const remove = useCallback<Ctx["remove"]>(async (type, id) => {
    const active = requireEngine();
    await active.enqueue({
      entityType: modeRef.current === "connected" ? remoteEntityType(type) : type,
      entityId: id,
      action: "delete",
    });
    await load(active);
  }, [load, requireEngine]);

  const signIn = useCallback<Ctx["signIn"]>(async (email, password) => {
    if (!auth) throw new Error("Informe VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para habilitar a entrada.");
    const response = await auth.auth.signInWithPassword({ email: email.trim(), password });
    if (response.error) throw response.error;
    if (!response.data.user) throw new Error("A autenticação não retornou uma conta.");
    authAccountRef.current = response.data.user.id;
    authStateObservedRef.current = true;
    setUser(userOf(response.data.user));
    setConnectionMessage("Entrada concluída. Escolha uma campanha para carregar os dados autorizados.");
  }, [auth]);

  const signOut = useCallback<Ctx["signOut"]>(async () => {
    let authFailure: unknown;
    if (auth) {
      try {
        const response = await auth.auth.signOut({ scope: "local" });
        if (response.error) authFailure = response.error;
      } catch (caught) {
        authFailure = caught;
      }
    }
    authAccountRef.current = null;
    authStateObservedRef.current = true;
    const account = user?.id;
    if (account) await clearTableAccount(account);
    const local = localEngineRef.current;
    setUser(null);
    setCampaigns([]);
    setRecords(new Map());
    setState(null);
    setConnectionMessage("Sessão encerrada. O cache remoto desta conta foi removido.");
    activateLocal(local);
    let cleanupFailure: unknown;
    try {
      if (account) {
        const { clearOfflineAccount } = await import("../../../../shared/one-ring/offline.ts");
        await clearOfflineAccount(account);
        if (storeRef.current) await storeRef.current.clearAccount(account);
        await accountCache.clear(account, [...campaigns.map((campaign) => campaign.id), ...(campaignId ? [campaignId] : [])]);
      }
    } catch (caught) {
      cleanupFailure = caught;
    } finally {
      if (local) await load(local);
    }
    if (cleanupFailure) throw cleanupFailure;
    if (authFailure) throw authFailure;
  }, [activateLocal, auth, campaigns, campaignId, load, user]);

  const refreshCampaigns = useCallback<Ctx["refreshCampaigns"]>(async () => {
    if (!user) throw new Error("Entre em uma conta existente antes de carregar campanhas.");
    const accountAtStart = user.id;
    const transport = transportForAccount(accountAtStart);
    const readCachedCampaigns = async () => {
      const cached = await accountCache.campaigns(accountAtStart);
      assertAccount(accountAtStart, ACCOUNT_CHANGED_LOADING);
      setCampaigns(cached);
      return cached;
    };
    if (!transport) {
      const cached = await readCachedCampaigns();
      setConnectionMessage("API sem configuração. Lista em cache, se houver.");
      if (cached.length) return cached;
      throw new Error("Informe VITE_NEXUS_API_URL para carregar campanhas.");
    }
    try {
      const rows = await transport.listCampaigns();
      assertAccount(accountAtStart, ACCOUNT_CHANGED_LOADING);
      await accountCache.saveCampaigns(accountAtStart, rows);
      assertAccount(accountAtStart, ACCOUNT_CHANGED_LOADING);
      setCampaigns(rows);
      setConnectionMessage(`${rows.length} campanha(s) autorizada(s) pela API.`);
      return rows;
    } catch (caught) {
      assertAccount(accountAtStart, ACCOUNT_CHANGED_LOADING);
      const cached = await readCachedCampaigns();
      if (cached.length && isNetworkError(caught)) {
        setConnectionMessage("Sem rede. Lista de campanhas em cache; a API continua sendo a autoridade de acesso.");
        return cached;
      }
      throw caught;
    }
  }, [assertAccount, transportForAccount, user]);

  /** Capacidades da API, com o cache como reserva só quando falta rede. */
  const loadCapabilities = useCallback(async (accountAtStart: string, requestedId: string, transport: SyncTransport | null) => {
    if (!transport) return accountCache.capabilities(accountAtStart, requestedId);
    try {
      const caps = await transport.capabilities(requestedId);
      assertAccount(accountAtStart, ACCOUNT_CHANGED_OPENING);
      await restoreTableCampaign(accountAtStart, requestedId);
      await accountCache.saveCapabilities(accountAtStart, requestedId, caps);
      return caps;
    } catch (caught) {
      assertAccount(accountAtStart, ACCOUNT_CHANGED_OPENING);
      if (!isNetworkError(caught)) throw caught;
      const caps = await accountCache.capabilities(accountAtStart, requestedId);
      if (!caps) throw new Error("Sem conexão e sem capacidades em cache para esta campanha.");
      setConnectionMessage("Sem rede. Capacidades anteriores em cache; a API valida cada gravação quando voltar.");
      return caps;
    }
  }, [assertAccount]);

  /** Primeira carga de uma campanha vazia; com falha, o cache local continua aberto se tiver algo. */
  const bootstrapIfEmpty = useCallback(async (remote: SyncEngine, accountAtStart: string) => {
    const current = await remote.readState();
    if (current.cursor !== null || Object.keys(current.records).length > 0) return;
    try {
      await remote.bootstrap([...REMOTE_BOOTSTRAP_ENTITIES]);
      await load(remote);
    } catch (caught) {
      assertAccount(accountAtStart, ACCOUNT_CHANGED_OPENING);
      await load(remote);
      const after = await remote.readState();
      if (!Object.keys(after.records).length && !after.outbox.length) throw caught;
      setConnectionMessage(caught instanceof Error
        ? `Cache local aberto; sincronização pendente: ${caught.message}`
        : "Cache local aberto; a conexão aguarda rede.");
    }
  }, [assertAccount, load]);

  const connectCampaign = useCallback<Ctx["connectCampaign"]>(async (requestedId) => {
    if (!user) throw new Error("Entre em uma conta existente antes de escolher uma campanha.");
    const selected = campaigns.find((campaign) => campaign.id === requestedId)
      ?? (await refreshCampaigns()).find((campaign) => campaign.id === requestedId);
    if (!selected) throw new Error("A campanha não está na lista recebida da API.");
    const accountAtStart = user.id;
    const transport = transportForAccount(accountAtStart);
    const caps = await loadCapabilities(accountAtStart, requestedId, transport);
    assertAccount(accountAtStart, ACCOUNT_CHANGED_OPENING);
    if (!validCapabilities(caps, requestedId)) throw new Error("Não há capacidades válidas em cache para esta campanha.");
    const opened = await openConnectedEngine(user.id, requestedId, caps, transport, () => {
      assertAccount(accountAtStart, ACCOUNT_CHANGED_OPENING);
      return true;
    });
    if (!opened) return;
    const { remote, device } = opened;
    activate({ engine: remote, mode: "connected", accountId: user.id, campaignId: requestedId, campaignName: selected.name, capabilities: caps, deviceId: device });
    setError(null);
    await accountCache.selectCampaign(user.id, requestedId);
    assertAccount(accountAtStart, ACCOUNT_CHANGED_OPENING);
    await load(remote);
    if (transport) await bootstrapIfEmpty(remote, accountAtStart);
    assertAccount(accountAtStart, ACCOUNT_CHANGED_OPENING);
    setConnectionMessage((prior) => prior || `Campanha ${selected.name} carregada com regras de acesso do servidor.`);
  }, [activate, assertAccount, bootstrapIfEmpty, campaigns, load, loadCapabilities, openConnectedEngine, refreshCampaigns, transportForAccount, user]);

  const syncNow = useCallback<Ctx["syncNow"]>(async () => {
    const active = engineRef.current;
    if (!active || modeRef.current !== "connected") throw new Error("Escolha uma campanha conectada antes de sincronizar.");
    const assertSamePartition = () => {
      if (engineRef.current !== active) throw new Error(PARTITION_CHANGED_SYNCING);
    };
    const report = await active.sync();
    if (report.reason === "revoked") await blockTableCampaign(active.partition.accountId, active.partition.campaignId);
    await load(active);
    assertSamePartition();
    if (report.reason === "revoked") throw new Error("A campanha recusou o acesso. O cache autorizado foi limpo.");
    if (report.reason === "reauth_required") throw new Error("A sessão expirou. Entre novamente para sincronizar.");
    if (report.reason === "network" || report.reason === "retry_later") {
      setConnectionMessage(report.reason === "retry_later"
        ? "A API pediu nova tentativa mais tarde; alterações continuam na fila local."
        : "Sem rede; alterações mantidas na fila local.");
      return;
    }
    try {
      await active.pull();
    } catch (caught) {
      await load(active);
      assertSamePartition();
      if (httpStatusOf(caught) === 403) {
        setConnectionMessage("O acesso à campanha foi revogado. O cache autorizado foi limpo e rascunhos pendentes foram preservados.");
        throw new Error("A campanha recusou o acesso. O cache autorizado foi limpo.");
      }
      throw caught;
    } finally {
      await load(active);
    }
    assertSamePartition();
    setConnectionMessage(`${report.applied} operação(ões) aceita(s); alterações remotas carregadas.`);
  }, [load]);

  useAutoSync({
    auth,
    connected: mode === "connected",
    userId: user?.id,
    campaignId,
    engineRef,
    authAccountRef,
    load,
    onIdleError: setConnectionMessage,
  });

  const setLocalMode = useCallback<Ctx["setLocalMode"]>(async () => {
    if (!storeRef.current) throw new Error("O armazenamento local ainda não abriu.");
    await accountCache.setDemoSeedDisabled(false);
    const local = await openLocalEngine(storeRef.current);
    localEngineRef.current = local;
    activate({ ...LOCAL_PARTITION, engine: local, deviceId: local.partition.deviceId });
    setError(null);
    await load(local);
  }, [activate, load]);

  const wipeLocal = useCallback(async () => {
    const active = engineRef.current;
    if (!active) return;
    setRecords(new Map());
    setState(null);
    try {
      await active.logout();
      if (modeRef.current === "local") await accountCache.setDemoSeedDisabled(true);
      await load(active);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível limpar o armazenamento local.");
      throw caught;
    }
  }, [load]);

  const connectionConfigured = useMemo(() => {
    const status = connectionStatus(mode);
    return Boolean(auth && apiBase) && status.apiUrlConfigured && status.supabaseUrlConfigured && status.publishableKeyConfigured;
  }, [auth, apiBase, mode]);

  const value = useMemo<Ctx>(() => ({
    ready: !!engine && !!state,
    error,
    engine,
    state,
    deviceId,
    mode,
    accountId,
    campaignId,
    campaignName,
    user,
    campaigns,
    capabilities,
    connectionMessage,
    list,
    get,
    create,
    update,
    remove,
    refresh,
    wipeLocal,
    signIn,
    signOut,
    refreshCampaigns,
    connectCampaign,
    syncNow,
    setLocalMode,
    connectionConfigured,
  }), [
    engine, state, deviceId, error, mode, accountId, campaignId, campaignName, user, campaigns, capabilities,
    connectionMessage, list, get, create, update, remove, refresh, wipeLocal, signIn, signOut, refreshCampaigns,
    connectCampaign, syncNow, setLocalMode, connectionConfigured,
  ]);
  return <NexusContext.Provider value={value}>{children}</NexusContext.Provider>;
}

export function useNexus(): Ctx {
  const context = useContext(NexusContext);
  if (!context) throw new Error("useNexus must be used inside NexusProvider");
  return context;
}
