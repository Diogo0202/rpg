import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { MapEditor, type EditableMap, type MapEditorData } from "../../../../frontend/components/map-editor/map-editor";
import { MapCanvas } from "../../../../frontend/components/map-editor/map-canvas";
import { parseMapDocument, createEmptyDocument, type MapDocumentV2 } from "../../../../frontend/lib/map-document";
import { kitForSystem } from "../../../../frontend/lib/map-kits";
import type { CanvasPointer } from "../../../../frontend/components/map-editor/map-canvas";
import { getSupabaseAuth } from "@/lib/nexus/auth";
import { useNexus, type Entity } from "@/lib/nexus/store";
import type { JsonValue } from "@/lib/mobile-sync/index.ts";
import { Btn, Empty, Panel } from "./ui";

type MapRecord = { name?: string; document?: unknown; system_key?: string | null; shared_with_players?: boolean; updated_at?: string };
type PlayerMap = { id: string; name: string; version: number; system_key: string | null; updated_at?: string };
type PlayerLoaded = PlayerMap & { document: MapDocumentV2 };

function editable(entity: Entity<MapRecord>, campaignId: string): EditableMap {
  return {
    id: entity.id,
    campaign_id: campaignId,
    name: entity.data.name ?? "Mapa sem nome",
    document: (entity.data.document ?? {}) as Record<string, unknown>,
    version: Math.max(1, entity.version),
    system_key: entity.data.system_key ?? null,
    shared_with_players: entity.data.shared_with_players === true,
    updated_at: entity.data.updated_at ?? "",
  };
}

export function MapPanel() {
  const { list, create, update, remove, campaignId, mode, user, capabilities, ready } = useNexus();
  const manager = mode === "local" || capabilities?.role === "owner" || capabilities?.role === "master";
  const client = getSupabaseAuth();
  const localMaps = list<MapRecord>("maps").map((entry) => editable(entry, campaignId));
  const rpc = useCallback(async (name: string, args: Record<string, unknown>) => {
    if (!client) return { data: null, error: { message: "Configure a conexão da campanha." } };
    const result = await client.rpc(name, args);
    return { data: result.data as unknown, error: result.error ? { message: result.error.message } : null };
  }, [client]);
  const sheets = list<Record<string, unknown>>("character_sheets").map((entry) => ({ id: entry.id, name: String(entry.data.name ?? "Ficha") }));
  const [remoteMaps, setRemoteMaps] = useState<EditableMap[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ManagerActions, setManagerActions] = useState<ComponentType<any> | null>(null);

  useEffect(() => {
    let live = true;
    import("../../../../frontend/components/map-interactions-panel").then((module) => {
      if (live && "MapInteractionsPanel" in module) setManagerActions(() => module.MapInteractionsPanel as ComponentType<any>);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const reloadManagerMaps = useCallback(async () => {
    if (mode !== "connected" || !manager || !client) return;
    const { data, error: queryError } = await client.from("maps")
      .select("id,campaign_id,name,document,version,system_key,shared_with_players,updated_at")
      .eq("campaign_id", campaignId).order("updated_at", { ascending: false });
    if (queryError) { setError("Não foi possível carregar os mapas da campanha."); return; }
    const rows = (data ?? []) as EditableMap[];
    setRemoteMaps(rows);
    setSelected((current) => rows.some((map) => map.id === current) ? current : rows[0]?.id ?? null);
  }, [campaignId, client, manager, mode]);

  useEffect(() => { void reloadManagerMaps(); }, [reloadManagerMaps]);

  const localData = useMemo<MapEditorData>(() => ({
    portraitUrls: {},
    async loadReferences(id) {
      const sheets = list<Record<string, unknown>>("character_sheets").filter((item) => item.data.campaign_id === id || mode === "local");
      const entities = list<Record<string, unknown>>("world_entities");
      return {
        sheets: sheets.map((item) => ({ id: item.id, name: String(item.data.name ?? "Ficha"), portrait_path: null, owner_id: null })),
        entities: entities.filter((item) => item.data.kind === "npc" || item.data.kind === "item").map((item) => ({ id: item.id, name: String(item.data.name ?? "Entidade"), kind: item.data.kind as "npc" | "item" })),
      };
    },
    async createEntity(_campaign, _viewer, kind, name) {
      const id = await create("world_entities", { kind, name, description: "", tags: [] });
      return { id, name, kind };
    },
    async saveMap(map, patch) {
      if (mode === "connected" && client && navigator.onLine) {
        const { data, error: saveError } = await client.from("maps").update(patch)
          .eq("id", map.id).eq("campaign_id", campaignId).eq("version", map.version)
          .select("id,campaign_id,name,document,version,system_key,shared_with_players,updated_at").maybeSingle();
        if (saveError) throw new Error("O servidor recusou a gravação do mapa.");
        return (data as EditableMap | null) ?? null;
      }
      const sets = [
        { path: ["name"], value: patch.name as JsonValue },
        { path: ["document"], value: patch.document as unknown as JsonValue },
      ];
      await update("maps", map.id, sets);
      return { ...map, ...patch, version: map.version + 1, updated_at: new Date().toISOString() };
    },
  }), [campaignId, client, create, list, mode, update]);

  const maps = mode === "connected" && manager ? remoteMaps : localMaps;
  const activeMap = maps.find((map) => map.id === selected) ?? null;

  const newMap = async () => {
    setError("");
    setBusy(true);
    try {
      const id = await create("maps", {
        name: "Novo mapa",
        document: createEmptyDocument(null) as unknown as JsonValue,
      });
      setSelected(id);
      setMessage(mode === "connected" ? "Mapa adicionado à fila de sincronização." : "Mapa salvo neste aparelho.");
      if (mode === "connected") await reloadManagerMaps();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível criar o mapa."); }
    finally { setBusy(false); }
  };

  const deleteMap = async (map: EditableMap) => {
    if (!window.confirm(`Excluir o mapa “${map.name}”?`)) return;
    try {
      if (mode === "connected" && client && navigator.onLine) {
        const { error: deleteError } = await client.from("maps").delete().eq("id", map.id).eq("campaign_id", campaignId);
        if (deleteError) throw new Error("O servidor recusou a exclusão do mapa.");
        await reloadManagerMaps();
      } else {
        await remove("maps", map.id);
        setSelected(null);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível excluir o mapa."); }
  };

  if (!ready) return <Panel title="Mapas"><p className="text-sm text-ink-muted">Carregando campanha…</p></Panel>;
  if (!manager) return <PlayerMaps campaignId={campaignId} viewerId={user?.id ?? ""} />;

  return <div className="space-y-4">
    <Panel title="Mapas" actions={<Btn type="button" onClick={() => void newMap()} disabled={busy}><Plus className="size-4" aria-hidden />Novo mapa</Btn>}>
      <p className="mb-3 text-sm text-ink-muted">{mode === "local" ? "Mapas locais. A sincronização depende da conexão com a campanha." : "Mapas da campanha, com gravação no servidor e fila móvel para edições sem conexão."}</p>
      {!maps.length ? <Empty>Nenhum mapa cadastrado.</Empty> : <div className="flex flex-wrap gap-2">{maps.map((map) => <Btn key={map.id} type="button" variant={selected === map.id ? "forest" : "outline"} onClick={() => setSelected(map.id)}>{map.name}</Btn>)}</div>}
      {activeMap && <div className="mt-4 space-y-3">
        <div className="flex justify-end"><Btn type="button" variant="outline" onClick={() => void deleteMap(activeMap)}><Trash2 className="size-4" aria-hidden />Excluir mapa</Btn></div>
        <MapEditor key={`${mode}:${campaignId}:${activeMap.id}`} campaignId={campaignId} viewerId={user?.id ?? "local"} map={activeMap} data={localData} onSaved={(map) => {
          setMessage(mode === "connected" && navigator.onLine ? "Mapa sincronizado com a campanha." : "Edição guardada na fila persistente.");
          if (mode === "connected") void reloadManagerMaps();
        }} onDelete={() => void deleteMap(activeMap)} />
        {mode === "connected" && ManagerActions && (() => {
          const parsed = parseMapDocument(activeMap.document, activeMap.system_key);
          return parsed.document ? <ManagerActions key={`${campaignId}:${activeMap.id}:${user?.id ?? ""}`} mapId={activeMap.id} campaignId={campaignId} viewerId={user?.id ?? ""} canManage={true} document={parsed.document} rpc={rpc} sheets={sheets} onChanged={() => void reloadManagerMaps()} /> : null;
        })()}
      </div>}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
      {message && <p role="status" aria-live="polite" className="mt-3 text-sm text-ink-muted">{message}</p>}
    </Panel>
  </div>;
}

function PlayerMaps({ campaignId, viewerId }: { campaignId: string; viewerId: string }) {
  const [maps, setMaps] = useState<PlayerMap[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<PlayerLoaded | null>(null);
  const [ownSheetIds, setOwnSheetIds] = useState<Set<string>>(new Set());
  const [ownSheets, setOwnSheets] = useState<Array<{ id: string; name: string }>>([]);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [ActionsPanel, setActionsPanel] = useState<ComponentType<any> | null>(null);
  const auth = getSupabaseAuth();

  useEffect(() => {
    let live = true;
    if (!auth || !viewerId) return;
    void Promise.all([
      auth.rpc("list_player_maps", { p_campaign_id: campaignId }),
      auth.from("character_sheets").select("id,name").eq("campaign_id", campaignId).eq("owner_id", viewerId),
    ]).then(([mapResult, sheetResult]) => {
      if (!live) return;
      if (mapResult.error) { setMessage("Não foi possível listar os mapas compartilhados."); return; }
      const rows = (mapResult.data ?? []) as PlayerMap[];
      setMaps(rows);
      setSelected((current) => rows.some((map) => map.id === current) ? current : rows[0]?.id ?? null);
      setOwnSheets((sheetResult.data ?? []).map((row) => ({ id: String(row.id), name: String(row.name ?? "Ficha") })));
      setOwnSheetIds(new Set((sheetResult.data ?? []).map((row) => String(row.id))));
    });
    return () => { live = false; };
  }, [auth, campaignId, refresh, viewerId]);

  useEffect(() => {
    let live = true;
    if (!auth || !selected) { setLoaded(null); return; }
    void auth.rpc("get_player_map", { p_map_id: selected }).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) { setLoaded(null); setMessage("Este mapa não está mais compartilhado."); return; }
      const row = data as PlayerMap & { document: unknown };
      const parsed = parseMapDocument(row.document, row.system_key);
      if (!parsed.document) { setMessage(parsed.error); return; }
      setLoaded({ ...row, document: parsed.document });
    });
    return () => { live = false; };
  }, [auth, selected, refresh]);

  useEffect(() => {
    let live = true;
    import("../../../../frontend/components/map-interactions-panel").then((module) => {
      if (live && "MapInteractionsPanel" in module) setActionsPanel(() => module.MapInteractionsPanel as ComponentType<any>);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const movable = useMemo(() => new Set((loaded?.document.pins ?? []).filter((pin) => pin.kind === "character" && pin.sheet_id && ownSheetIds.has(pin.sheet_id)).map((pin) => pin.id)), [loaded, ownSheetIds]);
  const draggingPin = useRef<{ id: string; from: [number, number] } | null>(null);
  const rpc = useCallback(async (name: string, args: Record<string, unknown>) => {
    if (!auth) return { data: null, error: { message: "Configure a conexão da campanha." } };
    const result = await auth.rpc(name, args);
    return { data: result.data as unknown, error: result.error ? { message: result.error.message } : null };
  }, [auth]);

  const onPointer = (event: CanvasPointer) => {
    if (!loaded || !auth) return;
    if (event.kind === "down") {
      const pin = [...loaded.document.pins].reverse().find((item) => movable.has(item.id) && Math.hypot(event.point[0] - item.x, event.point[1] - item.y) < 420);
      draggingPin.current = pin ? { id: pin.id, from: [pin.x, pin.y] } : null;
      return;
    }
    if (event.kind === "move" && draggingPin.current) {
      const id = draggingPin.current.id;
      const [x, y] = event.point.map(Math.round);
      setLoaded({ ...loaded, document: { ...loaded.document, pins: loaded.document.pins.map((pin) => pin.id === id ? { ...pin, x, y } : pin) } });
      return;
    }
    if (event.kind !== "up" || !draggingPin.current) return;
    const drag = draggingPin.current;
    const pin = loaded.document.pins.find((item) => item.id === drag.id);
    draggingPin.current = null;
    if (!pin || Math.hypot(event.point[0] - drag.from[0], event.point[1] - drag.from[1]) < 3) return;
    const [x, y] = event.point.map(Math.round);
    void auth.rpc("move_own_pin", { p_map_id: loaded.id, p_pin_id: pin.id, p_x: x, p_y: y }).then(({ error }) => {
      setMessage(error ? "Não foi possível mover o pin. O mapa será atualizado." : "Posição do personagem salva.");
      setRefresh((value) => value + 1);
    });
  };

  return <Panel title="Mapas compartilhados">
    <p className="mb-3 text-sm text-ink-muted">O jogador recebe somente a versão liberada pelo servidor. Arraste o pin do próprio personagem para movê-lo.</p>
    {maps.length > 0 && <label className="mb-3 block text-sm font-semibold">Mapa<select className="field-input mt-1" value={selected ?? ""} onChange={(event) => setSelected(event.target.value)}>{maps.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}</select></label>}
    {message && <p role="status" aria-live="polite" className="mb-3 text-sm text-ink-muted">{message}</p>}
    {!maps.length ? <Empty>Nenhum mapa compartilhado pelo narrador.</Empty> : loaded && <>
      <div className="overflow-hidden rounded-lg border border-border touch-pan-y">
        <MapCanvas document={loaded.document} kit={kitForSystem(loaded.system_key ?? loaded.document.system_key)} portraitUrls={{}} mode="player" movablePinIds={movable} label={`Mapa ${loaded.name}`} onPointer={onPointer} />
      </div>
      {ActionsPanel && <ActionsPanel key={`${campaignId}:${loaded.id}:${viewerId}`} mapId={loaded.id} campaignId={campaignId} viewerId={viewerId} canManage={false} document={loaded.document} rpc={rpc} sheets={ownSheets} onChanged={() => setRefresh((value) => value + 1)} />}
    </>}
  </Panel>;
}
