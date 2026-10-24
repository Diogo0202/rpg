import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FastApiSyncTransport,
  IndexedDbSyncStore,
  SyncEngine,
  SyncHttpError,
  fieldValuesEqual,
  openSyncStore,
  type JsonValue,
  type SyncCampaign,
  type SyncCapabilities,
  type SyncChange,
  type SyncState,
  type SyncTransport,
} from "@/lib/mobile-sync/index.ts";
import {
  LOCAL_ACCOUNT_ID,
  LOCAL_CAMPAIGN_ID,
  LOCAL_CAMPAIGN_NAME,
  LOCAL_ENTITY_FIELDS,
  REMOTE_BOOTSTRAP_ENTITIES,
  LocalOnlyTransport,
  connectionStatus,
} from "./config";
import { getSupabaseAuth, getSupabaseConfigProblem, accessTokenProvider } from "./auth";
import { fromRemoteRecord, remoteEntityType, toRemoteCreate, toRemotePath } from "./remote-adapter";
import { seedDemo } from "./seed";
import { prefGet, prefSet } from "./prefs";
import {
  NexusContext,
  type Entity,
  type NexusContextValue as Ctx,
  type NexusUser,
  type PathSet,
} from "./context";

export type { Entity, NexusUser, PathSet };
export type NexusStoreValue = Ctx;
export { NexusContext } from "./context";
const entityKey = (type: string, id: string) => `${type}\u0000${id}`;
const CAMPAIGN_CACHE = "nexus-cached-campaigns-v1:";
const CAPABILITIES_CACHE = "nexus-cached-capabilities-v1:";
const SELECTED_CAMPAIGN = "nexus-selected-campaign-v1:";
const DEMO_SEED_DISABLED = "nexus-local-demo-seed-disabled-v1";
const remoteToUi: Record<string, string> = {
  campaign_sessions: "journal_sessions",
  campaign_events: "journal_notes",
};
const seedLocks = new Map<string, Promise<void>>();

function readPath(
  data: Record<string, JsonValue> | undefined,
  path: string[],
): { exists: false } | { exists: true; value: JsonValue } {
  let node: JsonValue | undefined = data;
  for (const part of path) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      !Object.prototype.hasOwnProperty.call(node, part)
    )
      return { exists: false };
    node = node[part];
  }
  return node === undefined ? { exists: false } : { exists: true, value: node };
}
function clean(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
function statusOf(error: unknown): number | undefined {
  return error instanceof SyncHttpError ? error.status : undefined;
}
function isOnlineTransportError(error: unknown): boolean {
  return (
    statusOf(error) === 0 || (error instanceof TypeError && /fetch|network/i.test(error.message))
  );
}

async function withSeedLock(name: string, task: () => Promise<void>): Promise<void> {
  const lockManager =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { locks?: LockManager }).locks;
  if (lockManager) {
    await lockManager.request(name, { mode: "exclusive" }, task);
    return;
  }
  const prior = seedLocks.get(name) ?? Promise.resolve();
  const next = prior.then(task);
  seedLocks.set(name, next);
  try {
    await next;
  } finally {
    if (seedLocks.get(name) === next) seedLocks.delete(name);
  }
}

export async function seedLocalDemoOnce(engine: SyncEngine, disabled = false): Promise<void> {
  const name = `rpg-nexus-demo:${engine.partition.accountId}:${engine.partition.campaignId}`;
  await withSeedLock(name, async () => {
    const current = await engine.readState();
    if (!disabled && current.outbox.length === 0 && Object.keys(current.records).length === 0)
      await seedDemo(engine);
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
  const authAccountRef = useRef<string | null>(null);
  const authStateObservedRef = useRef(false);
  const storeRef = useRef<IndexedDbSyncStore | null>(null);
  const localEngineRef = useRef<SyncEngine | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const modeRef = useRef<"local" | "connected">("local");
  const env = import.meta.env as Record<string, string | undefined>;
  const auth = getSupabaseAuth();
  const apiBase = env.VITE_NEXUS_API_URL?.trim();
  const transportForAccount = useCallback((expectedAccountId: string): SyncTransport | null => {
    if (!auth || !apiBase) return null;
    try {
      return new FastApiSyncTransport({
        baseUrl: apiBase,
        getAccessToken: accessTokenProvider(auth, expectedAccountId),
      });
    } catch {
      return null;
    }
  }, [auth, apiBase]);

  const load = useCallback(async (eng: SyncEngine) => {
    const s = await eng.readState();
    const templateRows = Object.values(s.records).filter(
      (record) => record.entity_type === "system_templates" && !record.deleted,
    );
    const templateById = new Map(templateRows.map((record) => [record.id, record.data]));
    const ids = new Map<string, [string, string]>();
    for (const record of Object.values(s.records))
      ids.set(entityKey(remoteToUi[record.entity_type] ?? record.entity_type, record.id), [
        record.entity_type,
        record.id,
      ]);
    for (const entry of s.outbox)
      ids.set(
        entityKey(
          remoteToUi[entry.mutation.entity_type] ?? entry.mutation.entity_type,
          entry.mutation.entity_id,
        ),
        [entry.mutation.entity_type, entry.mutation.entity_id],
      );
    const next = new Map<string, Entity>();
    await Promise.all(
      [...ids.values()].map(async ([remoteType, id]) => {
        const record = await eng.getRecord(remoteType, id);
        if (!record || record.deleted) return;
        const type = remoteToUi[remoteType] ?? remoteType;
        const adapted = modeRef.current === "connected" ? fromRemoteRecord(type, record) : record;
        const data = { ...adapted.data } as Record<string, JsonValue>;
        if (type === "character_sheets" && modeRef.current === "connected") {
          const template = templateById.get(String(data.template_id));
          if (template) {
            data.system_key =
              typeof template.system_key === "string"
                ? template.system_key
                : String(data.template_id);
            data.template_name =
              typeof template.name === "string" ? template.name : "Modelo da campanha";
            data.template_version = typeof template.version === "number" ? template.version : 1;
            const schema = template.schema;
            if (
              schema &&
              typeof schema === "object" &&
              !Array.isArray(schema) &&
              Array.isArray(schema.fields)
            )
              data.template_fields = schema.fields as JsonValue;
          }
          if (!Array.isArray(data.effects)) data.effects = [];
        }
        const pending = s.outbox.filter(
          (entry) => entry.mutation.entity_type === remoteType && entry.mutation.entity_id === id,
        );
        const adjustmentIntents = (s.adjustments ?? []).filter((intent) => remoteType === "character_sheets" && intent.sheet_id === id);
        next.set(entityKey(type, id), {
          type,
          id,
          version: record.version,
          data,
          pending: pending.length > 0 || adjustmentIntents.some((intent) => intent.state === "queued" || intent.state === "inflight"),
          conflict: pending.some((entry) => entry.state === "conflict") || adjustmentIntents.some((intent) => intent.state === "invalid" || intent.state === "denied"),
        });
      }),
    );
    if (engineRef.current !== eng) return;
    setRecords(next);
    setState(s);
  }, []);

  const makeLocalEngine = useCallback(async (store: IndexedDbSyncStore) => {
    const device = await store.getOrCreateDeviceId(LOCAL_ACCOUNT_ID);
    const local = new SyncEngine(
      {
        accountId: LOCAL_ACCOUNT_ID,
        campaignId: LOCAL_CAMPAIGN_ID,
        deviceId: device,
        entityFields: LOCAL_ENTITY_FIELDS,
      },
      store,
      new LocalOnlyTransport(),
    );
    const disabled = await prefGet<boolean>(DEMO_SEED_DISABLED);
    await seedLocalDemoOnce(local, disabled === true);
    return { engine: local, device };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = openSyncStore();
        storeRef.current = store;
        const { engine: local, device } = await makeLocalEngine(store);
        localEngineRef.current = local;
        if (cancelled) return;
        engineRef.current = local;
        modeRef.current = "local";
        setDeviceId(device);
        setEngine(local);
        setAccountId(LOCAL_ACCOUNT_ID);
        setCampaignId(LOCAL_CAMPAIGN_ID);
        setCampaignName(LOCAL_CAMPAIGN_NAME);
        await load(local);
        if (auth) {
          const session = await auth.auth.getSession();
          const account = session.data.session?.user;
          if (!session.error && account) {
            if (authStateObservedRef.current && authAccountRef.current !== account.id) return;
            authAccountRef.current = account.id;
            const accountTransport = transportForAccount(account.id);
            setUser({ id: account.id, email: account.email ?? null });
            const [cachedCampaigns, requested] = await Promise.all([
              prefGet<SyncCampaign[]>(`${CAMPAIGN_CACHE}${account.id}`),
              prefGet<string>(`${SELECTED_CAMPAIGN}${account.id}`),
            ]);
            if (cancelled || authAccountRef.current !== account.id) return;
            const cached = cachedCampaigns ?? [];
            setCampaigns(cached);
            const selectedId = requested || cached[0]?.id;
            if (selectedId && storeRef.current) {
              const cachedCampaign = cached.find((row) => row.id === selectedId);
              const caps = await prefGet<SyncCapabilities>(
                `${CAPABILITIES_CACHE}${account.id}:${selectedId}`,
              );
              if (cancelled || authAccountRef.current !== account.id) return;
              if (caps?.campaign_id === selectedId && caps.protocol_version === 1) {
                const remoteDevice = await store.getOrCreateDeviceId(account.id);
                if (cancelled || authAccountRef.current !== account.id) return;
                const offlineEngine = new SyncEngine(
                  {
                    accountId: account.id,
                    campaignId: selectedId,
                    deviceId: remoteDevice,
                    entityFields: caps.entity_fields,
                  },
                  store,
                  accountTransport ?? new LocalOnlyTransport(),
                );
                if (cancelled || authAccountRef.current !== account.id) return;
                engineRef.current = offlineEngine;
                modeRef.current = "connected";
                setEngine(offlineEngine);
                setMode("connected");
                setAccountId(account.id);
                setCampaignId(selectedId);
                setCampaignName(cachedCampaign?.name ?? "Campanha em cache");
                setCapabilities(caps);
                setDeviceId(remoteDevice);
                setConnectionMessage(
                  "Cache desta conta reaberto. A sincronização exige uma ação explícita.",
                );
                await load(offlineEngine);
              }
            }
          }
        }
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error ? caught.message : "Falha ao abrir o armazenamento local.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, load, makeLocalEngine, transportForAccount]);

  useEffect(() => {
    if (!auth) return;
    const { data: { subscription } } = auth.auth.onAuthStateChange((_event, session) => {
      authStateObservedRef.current = true;
      const nextUser = session?.user ?? null;
      const nextAccountId = nextUser?.id ?? null;
      const priorAccountId = authAccountRef.current;
      if (nextAccountId === priorAccountId) return;

      // Keep this SDK callback synchronous. Detach the old partition immediately;
      // its IndexedDB rows and queued mutations remain available to that account.
      authAccountRef.current = nextAccountId;
      const local = localEngineRef.current;
      if (engineRef.current && engineRef.current.partition.accountId !== LOCAL_ACCOUNT_ID) {
        modeRef.current = "local";
        engineRef.current = local;
        setMode("local");
        setAccountId(LOCAL_ACCOUNT_ID);
        setCampaignId(LOCAL_CAMPAIGN_ID);
        setCampaignName(LOCAL_CAMPAIGN_NAME);
        setCapabilities(null);
        setRecords(new Map());
        setState(null);
        if (local) {
          setEngine(local);
          setDeviceId(local.partition.deviceId);
          queueMicrotask(() => { void load(local).catch(() => undefined); });
        }
      }
      setUser(nextUser ? { id: nextUser.id, email: nextUser.email ?? null } : null);
      setCampaigns([]);
      setCapabilities(null);
      setConnectionMessage(nextUser
        ? "A conta mudou. O cache anterior foi fechado, e as pendências continuam guardadas na conta original."
        : "Sessão encerrada. As pendências permanecem guardadas na conta original.");
    });
    return () => subscription.unsubscribe();
  }, [auth, load]);

  const refresh = useCallback(async () => {
    if (engineRef.current) await load(engineRef.current);
  }, [load]);

  const list = useCallback(
    <T,>(type: string) =>
      [...records.values()].filter((record) => record.type === type) as unknown as Entity<T>[],
    [records],
  );
  const get = useCallback(
    <T,>(type: string, id: string | undefined | null) =>
      (id ? records.get(entityKey(type, id)) : undefined) as unknown as Entity<T> | undefined,
    [records],
  );

  const create = useCallback<Ctx["create"]>(
    async (type, input, opts) => {
      const active = engineRef.current;
      if (!active) throw new Error("Armazenamento local indisponível.");
      const current = await active.readState();
      let createInput = input;
      if (
        modeRef.current === "connected" &&
        type === "journal_sessions" &&
        input.sequence === undefined
      ) {
        const sequences = Object.values(current.records)
          .filter((record) => record.entity_type === "campaign_sessions" && !record.deleted)
          .map((record) => record.data.sequence)
          .filter(
            (sequence): sequence is number =>
              typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 0,
          );
        for (const entry of current.outbox)
          if (
            entry.mutation.entity_type === "campaign_sessions" &&
            entry.mutation.action !== "delete"
          ) {
            for (const change of entry.mutation.changes)
              if (
                change.path.length === 1 &&
                change.path[0] === "sequence" &&
                change.after.exists &&
                typeof change.after.value === "number" &&
                Number.isSafeInteger(change.after.value) &&
                change.after.value > 0
              )
                sequences.push(change.after.value);
          }
        createInput = {
          ...input,
          sequence: Math.max(0, ...sequences) + 1,
          status: input.status ?? "planned",
        };
      }
      const remote =
        modeRef.current === "connected"
          ? toRemoteCreate(type, createInput)
          : { entityType: type, data: input };
      const dependsOn = (opts?.dependsOnEntities ?? []).flatMap(([t, id]) => {
        const entityType = modeRef.current === "connected" ? remoteEntityType(t) : t;
        return current.outbox
          .filter(
            (entry) =>
              entry.mutation.entity_type === entityType &&
              entry.mutation.entity_id === id &&
              entry.state !== "accepted",
          )
          .map((entry) => entry.mutation.operation_id);
      });
      const changes: SyncChange[] = Object.entries(remote.data)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({
          path: [key],
          before: { exists: false },
          after: { exists: true, value: clean(value) },
        }));
      const mutation = await active.enqueue({
        entityType: remote.entityType,
        action: "create",
        changes,
        dependsOn,
        ...(opts?.id ? { entityId: opts.id } : {}),
      });
      await load(active);
      return mutation.entity_id;
    },
    [load],
  );

  const update = useCallback<Ctx["update"]>(
    async (type, id, sets) => {
      const active = engineRef.current;
      if (!active) throw new Error("Armazenamento local indisponível.");
      const entityType = modeRef.current === "connected" ? remoteEntityType(type) : type;
      const current = await active.getRecord(entityType, id);
      if (!current || current.deleted) throw new Error("Registro não encontrado.");
      const logical = modeRef.current === "connected" ? fromRemoteRecord(type, current) : current;
      const atomicDeltas: { fieldId: string; delta: number }[] = [];
      const changes: SyncChange[] = [];
      for (const set of sets) {
        if (modeRef.current === "connected" && type === "character_sheets" && set.path.length === 1 && set.path[0] === "values"
            && set.value && typeof set.value === "object" && !Array.isArray(set.value)) {
          const priorValues = logical.data.values && typeof logical.data.values === "object" && !Array.isArray(logical.data.values)
            ? logical.data.values as Record<string, JsonValue> : {};
          const nextValues = set.value as Record<string, JsonValue>;
          const templateId = typeof current.data.template_id === "string" ? current.data.template_id : "";
          const template = templateId ? await active.getRecord("system_templates", templateId) : undefined;
          const schema = template?.data.schema && typeof template.data.schema === "object" && !Array.isArray(template.data.schema)
            ? template.data.schema as Record<string, JsonValue> : {};
          const managed = new Set<string>();
          const numericFields = new Set<string>();
          if (Array.isArray(schema.fields)) for (const field of schema.fields)
            if (field && typeof field === "object" && !Array.isArray(field) && typeof field.id === "string" && field.kind === "number") numericFields.add(field.id);
          if (typeof schema.experience_field === "string") managed.add(schema.experience_field);
          if (Array.isArray(schema.meta_currencies)) for (const item of schema.meta_currencies)
            if (item && typeof item === "object" && !Array.isArray(item) && typeof item.field === "string") managed.add(item.field);
          const fieldIds = new Set([...Object.keys(priorValues), ...Object.keys(nextValues)]);
          for (const fieldId of fieldIds) {
            const before = priorValues[fieldId], after = nextValues[fieldId];
            if (before === after || (typeof before === "number" && typeof after === "number" && before === after)) continue;
            if (numericFields.has(fieldId) && !managed.has(fieldId) && (before === undefined || (typeof before === "number" && Number.isSafeInteger(before)))
                && typeof after === "number" && Number.isSafeInteger(after)) {
              const delta = after - (typeof before === "number" ? before : 0);
              if (delta !== 0 && Math.abs(delta) <= 1000) atomicDeltas.push({ fieldId, delta });
              else if (delta !== 0) changes.push({ path: ["values", fieldId], before: before === undefined ? { exists: false } : { exists: true, value: before }, after: { exists: true, value: after } });
            } else if (!fieldValuesEqual(before === undefined ? { exists: false } : { exists: true, value: before }, after === undefined ? { exists: false } : { exists: true, value: after })) {
              changes.push({ path: ["values", fieldId], before: before === undefined ? { exists: false } : { exists: true, value: clean(before) }, after: after === undefined ? { exists: false } : { exists: true, value: clean(after) } });
            }
          }
          continue;
        }
        const mapped =
          modeRef.current === "connected"
            ? toRemotePath(type, set.path, set.value)
            : { entityType, path: set.path, value: set.value };
        if (!mapped) continue;
        const before = readPath(logical.data, set.path);
        const after =
          mapped.value === undefined
            ? { exists: false as const }
            : { exists: true as const, value: clean(mapped.value) };
        if (fieldValuesEqual(before, after)) continue;
        const rawBefore = readPath(current.data, mapped.path);
        changes.push({ path: mapped.path, before: rawBefore, after });
      }
      for (const item of atomicDeltas) await active.enqueueSheetAdjustment(id, item.fieldId, item.delta);
      if (changes.length) await active.enqueue({ entityType, entityId: id, action: "update", changes });
      if (!changes.length && !atomicDeltas.length) return false;
      await load(active);
      return true;
    },
    [load],
  );

  const remove = useCallback<Ctx["remove"]>(
    async (type, id) => {
      const active = engineRef.current;
      if (!active) throw new Error("Armazenamento local indisponível.");
      await active.enqueue({
        entityType: modeRef.current === "connected" ? remoteEntityType(type) : type,
        entityId: id,
        action: "delete",
      });
      await load(active);
    },
    [load],
  );

  const signIn = useCallback<Ctx["signIn"]>(
    async (email, password) => {
      if (!auth)
        throw new Error(
          "Informe VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para habilitar a entrada.",
        );
      const response = await auth.auth.signInWithPassword({ email: email.trim(), password });
      if (response.error) throw response.error;
      if (!response.data.user) throw new Error("A autenticação não retornou uma conta.");
      authAccountRef.current = response.data.user.id;
      authStateObservedRef.current = true;
      setUser({ id: response.data.user.id, email: response.data.user.email ?? null });
      setConnectionMessage(
        "Entrada concluída. Escolha uma campanha para carregar os dados autorizados.",
      );
    },
    [auth],
  );

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
    const local = localEngineRef.current;
    setUser(null);
    setCampaigns([]);
    setCapabilities(null);
    setRecords(new Map());
    setState(null);
    setConnectionMessage("Sessão encerrada. O cache remoto desta conta foi removido.");
    modeRef.current = "local";
    setMode("local");
    setAccountId(LOCAL_ACCOUNT_ID);
    setCampaignId(LOCAL_CAMPAIGN_ID);
    setCampaignName(LOCAL_CAMPAIGN_NAME);
    if (local) {
      engineRef.current = local;
      setEngine(local);
      setDeviceId(local.partition.deviceId);
    }
    let cleanupFailure: unknown;
    try {
      if (account && storeRef.current) await storeRef.current.clearAccount(account);
      if (account) {
        await prefSet(`${CAMPAIGN_CACHE}${account}`, []);
        await prefSet(`${SELECTED_CAMPAIGN}${account}`, "");
        for (const campaign of campaigns)
          await prefSet(`${CAPABILITIES_CACHE}${account}:${campaign.id}`, null);
        if (campaignId) await prefSet(`${CAPABILITIES_CACHE}${account}:${campaignId}`, null);
      }
    } catch (caught) {
      cleanupFailure = caught;
    } finally {
      if (local) await load(local);
    }
    if (cleanupFailure) throw cleanupFailure;
    if (authFailure) throw authFailure;
  }, [auth, campaigns, campaignId, load, user]);

  const refreshCampaigns = useCallback<Ctx["refreshCampaigns"]>(async () => {
    if (!user) throw new Error("Entre em uma conta existente antes de carregar campanhas.");
    const accountAtStart = user.id;
    const accountTransport = transportForAccount(accountAtStart);
    const cacheKey = `${CAMPAIGN_CACHE}${user.id}`;
    if (!accountTransport) {
      const cached = (await prefGet<SyncCampaign[]>(cacheKey)) ?? [];
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante o carregamento.");
      setCampaigns(cached);
      setConnectionMessage("API sem configuração. Lista em cache, se houver.");
      if (cached.length) return cached;
      throw new Error("Informe VITE_NEXUS_API_URL para carregar campanhas.");
    }
    try {
      const rows = await accountTransport.listCampaigns();
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante o carregamento.");
      await prefSet(cacheKey, rows);
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante o carregamento.");
      setCampaigns(rows);
      setConnectionMessage(`${rows.length} campanha(s) autorizada(s) pela API.`);
      return rows;
    } catch (caught) {
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante o carregamento.");
      const cached = (await prefGet<SyncCampaign[]>(cacheKey)) ?? [];
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante o carregamento.");
      setCampaigns(cached);
      if (cached.length && isOnlineTransportError(caught)) {
        setConnectionMessage(
          "Sem rede. Lista de campanhas em cache; a API continua sendo a autoridade de acesso.",
        );
        return cached;
      }
      throw caught;
    }
  }, [transportForAccount, user]);

  const connectCampaign = useCallback<Ctx["connectCampaign"]>(
    async (requestedId) => {
      if (!user) throw new Error("Entre em uma conta existente antes de escolher uma campanha.");
      const selected =
        campaigns.find((campaign) => campaign.id === requestedId) ??
        (await refreshCampaigns()).find((campaign) => campaign.id === requestedId);
      if (!selected) throw new Error("A campanha não está na lista recebida da API.");
      const accountAtStart = user.id;
      const capsKey = `${CAPABILITIES_CACHE}${user.id}:${requestedId}`;
      let caps: SyncCapabilities | undefined;
      const accountTransport = transportForAccount(accountAtStart);
      if (accountTransport) {
        try {
          caps = await accountTransport.capabilities(requestedId);
          if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante a abertura da campanha.");
          await prefSet(capsKey, caps);
        } catch (caught) {
          if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante a abertura da campanha.");
          if (!isOnlineTransportError(caught)) throw caught;
          caps = await prefGet<SyncCapabilities>(capsKey);
          if (!caps) throw new Error("Sem conexão e sem capacidades em cache para esta campanha.");
          setConnectionMessage(
            "Sem rede. Capacidades anteriores em cache; a API valida cada gravação quando voltar.",
          );
        }
      } else caps = await prefGet<SyncCapabilities>(capsKey);
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante a abertura da campanha.");
      if (!caps || caps.campaign_id !== requestedId || caps.protocol_version !== 1)
        throw new Error("Não há capacidades válidas em cache para esta campanha.");
      if (!storeRef.current) throw new Error("O armazenamento local ainda não abriu.");
      const device = await storeRef.current.getOrCreateDeviceId(user.id);
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante a abertura da campanha.");
      const remoteTransport = accountTransport ?? new LocalOnlyTransport();
      const remoteEngine = new SyncEngine(
        {
          accountId: user.id,
          campaignId: requestedId,
          deviceId: device,
          entityFields: caps.entity_fields,
        },
        storeRef.current,
        remoteTransport,
      );
      engineRef.current = remoteEngine;
      modeRef.current = "connected";
      setEngine(remoteEngine);
      setMode("connected");
      setAccountId(user.id);
      setCampaignId(requestedId);
      setCampaignName(selected.name);
      setCapabilities(caps);
      setDeviceId(device);
      setError(null);
      await prefSet(`${SELECTED_CAMPAIGN}${user.id}`, requestedId);
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante a abertura da campanha.");
      await load(remoteEngine);
      const current = await remoteEngine.readState();
      if (accountTransport && current.cursor === null && Object.keys(current.records).length === 0) {
        try {
          await remoteEngine.bootstrap([...REMOTE_BOOTSTRAP_ENTITIES]);
          await load(remoteEngine);
        } catch (caught) {
          if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante a abertura da campanha.");
          await load(remoteEngine);
          const after = await remoteEngine.readState();
          if (!Object.keys(after.records).length && !after.outbox.length) throw caught;
          setConnectionMessage(
            caught instanceof Error
              ? `Cache local aberto; sincronização pendente: ${caught.message}`
              : "Cache local aberto; a conexão aguarda rede.",
          );
        }
      }
      if (authAccountRef.current !== accountAtStart) throw new Error("A conta mudou durante a abertura da campanha.");
      setConnectionMessage(
        (prior) => prior || `Campanha ${selected.name} carregada com regras de acesso do servidor.`,
      );
    },
    [campaigns, load, refreshCampaigns, transportForAccount, user],
  );

  const syncNow = useCallback<Ctx["syncNow"]>(async () => {
    const active = engineRef.current;
    if (!active || modeRef.current !== "connected")
      throw new Error("Escolha uma campanha conectada antes de sincronizar.");
    const report = await active.sync();
    await load(active);
    if (engineRef.current !== active) throw new Error("A conta ou campanha ativa mudou durante a sincronização.");
    if (report.reason === "revoked")
      throw new Error("A campanha recusou o acesso. O cache autorizado foi limpo.");
    if (report.reason === "reauth_required")
      throw new Error("A sessão expirou. Entre novamente para sincronizar.");
    if (report.reason === "network" || report.reason === "retry_later") {
      setConnectionMessage(
        report.reason === "retry_later"
          ? "A API pediu nova tentativa mais tarde; alterações continuam na fila local."
          : "Sem rede; alterações mantidas na fila local.",
      );
      return;
    }
    try {
      await active.pull();
    } catch (caught) {
      await load(active);
      if (engineRef.current !== active) throw new Error("A conta ou campanha ativa mudou durante a sincronização.");
      if (statusOf(caught) === 403) {
        setConnectionMessage(
          "O acesso à campanha foi revogado. O cache autorizado foi limpo e rascunhos pendentes foram preservados.",
        );
        throw new Error("A campanha recusou o acesso. O cache autorizado foi limpo.");
      }
      throw caught;
    } finally {
      await load(active);
    }
    if (engineRef.current !== active) throw new Error("A conta ou campanha ativa mudou durante a sincronização.");
    setConnectionMessage(
      `${report.applied} operação(ões) aceita(s); alterações remotas carregadas.`,
    );
  }, [load]);

  useEffect(() => {
    const active = engineRef.current;
    if (!auth || mode !== "connected" || !user || !campaignId || !active
        || active.partition.accountId !== user.id || active.partition.campaignId !== campaignId) return;
    let alive = true;
    let busy = false;
    let requested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (busy) { requested = true; return; }
      busy = true;
      try {
        do {
          requested = false;
          if (!alive || authAccountRef.current !== user.id || engineRef.current !== active) return;
          const report = await active.sync();
          if (report.reason === "network" || report.reason === "retry_later" || report.reason === "reauth_required" || report.reason === "revoked") {
            await load(active);
            return;
          }
          await active.pull();
          await load(active);
        } while (requested && alive);
      } catch {
        if (alive && engineRef.current === active) setConnectionMessage("A atualização automática aguarda uma conexão válida.");
      } finally {
        busy = false;
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void run(); }, 180);
    };
    const channel = auth.channel(`mobile-sheet-sync-${user.id}-${campaignId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "character_sheet_notifications", filter: `campaign_id=eq.${campaignId}` }, schedule)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "character_sheet_notifications", filter: `campaign_id=eq.${campaignId}` }, schedule)
      .subscribe((status) => { if (alive && status === "SUBSCRIBED") schedule(); });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      void auth.removeChannel(channel);
    };
  }, [auth, mode, user?.id, campaignId, load]);

  const setLocalMode = useCallback<Ctx["setLocalMode"]>(async () => {
    if (!storeRef.current) throw new Error("O armazenamento local ainda não abriu.");
    await prefSet(DEMO_SEED_DISABLED, false);
    const { engine: local, device } = await makeLocalEngine(storeRef.current);
    localEngineRef.current = local;
    engineRef.current = local;
    modeRef.current = "local";
    setMode("local");
    setAccountId(LOCAL_ACCOUNT_ID);
    setCampaignId(LOCAL_CAMPAIGN_ID);
    setCampaignName(LOCAL_CAMPAIGN_NAME);
    setDeviceId(device);
    setEngine(local);
    setCapabilities(null);
    setError(null);
    await load(local);
  }, [load, makeLocalEngine]);

  const wipeLocal = useCallback(async () => {
    const active = engineRef.current;
    if (!active) return;
    setRecords(new Map());
    setState(null);
    try {
      await active.logout();
      if (modeRef.current === "local") await prefSet(DEMO_SEED_DISABLED, true);
      await load(active);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível limpar o armazenamento local.",
      );
      throw caught;
    }
  }, [load]);

  const value = useMemo<Ctx>(
    () => ({
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
      connectionConfigured:
        Boolean(auth && apiBase) &&
        connectionStatus(mode).apiUrlConfigured &&
        connectionStatus(mode).supabaseUrlConfigured &&
        connectionStatus(mode).publishableKeyConfigured,
    }),
    [
      engine,
      state,
      deviceId,
      error,
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
      auth,
      apiBase,
    ],
  );
  return <NexusContext.Provider value={value}>{children}</NexusContext.Provider>;
}

export function useNexus(): Ctx {
  const context = useContext(NexusContext);
  if (!context) throw new Error("useNexus must be used inside NexusProvider");
  return context;
}

export function outboxSummary(state: SyncState | null) {
  const out = state?.outbox ?? [];
  const adjustments = state?.adjustments ?? [];
  return {
    total: out.length + adjustments.length,
    queued: out.filter((entry) => entry.state === "queued" || entry.state === "inflight").length
      + adjustments.filter((intent) => intent.state === "queued" || intent.state === "inflight").length,
    conflicts: out.filter((entry) => entry.state === "conflict").length,
    blocked: out.filter((entry) => ["denied", "invalid", "dependency_failed"].includes(entry.state)).length
      + adjustments.filter((intent) => intent.state === "denied" || intent.state === "invalid").length,
  };
}
