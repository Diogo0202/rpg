"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { parseMapDocument, type MapDocumentV2 } from "../lib/map-document";
import { distance } from "../lib/map-geometry";
import { kitForSystem } from "../lib/map-kits";
import { MapCanvas, PIN_RADIUS, type CanvasPointer } from "./map-editor/map-canvas";
import { usePortraitUrls } from "./portrait-picker";
import styles from "./saved-maps-panel.module.css";
import editorStyles from "./map-editor/map-editor.module.css";

type SharedMap = { id: string; name: string; version: number; system_key: string | null; updated_at: string };
type LoadedMap = { id: string; name: string; version: number; system_key: string | null; document: MapDocumentV2 };

/**
 * Players read maps only through get_player_map (GM-only pins, shadows and
 * notes are stripped in the database) and may drag the pin of their own sheet.
 */
export function PlayerMapView({ campaignId, viewerId }: { campaignId: string; viewerId: string }) {
  const uid = useId();
  const [maps, setMaps] = useState<SharedMap[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedMap | null>(null);
  const [ownSheetIds, setOwnSheetIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const dragging = useRef<{ pinId: string; moved: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    const client = createClient();
    void Promise.all([
      client.rpc("list_player_maps", { p_campaign_id: campaignId }),
      client.from("character_sheets").select("id").eq("campaign_id", campaignId).eq("owner_id", viewerId),
    ]).then(([mapResult, sheetResult]) => {
      if (!active) return;
      if (mapResult.error) { setMessage("Não foi possível listar os mapas compartilhados."); return; }
      const rows = (mapResult.data ?? []) as SharedMap[];
      setMaps(rows);
      setSelectedId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? null);
      setOwnSheetIds(new Set((sheetResult.data ?? []).map((row) => row.id as string)));
    });
    return () => { active = false; };
  }, [campaignId, viewerId, revision]);

  // Realtime carries only an invalidation marker; the content is re-read through the RPC.
  useEffect(() => {
    const client = createClient();
    const channel = client.channel(`player-maps-${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "map_notifications", filter: `campaign_id=eq.${campaignId}` }, () => { if (!dragging.current) setRevision((value) => value + 1); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [campaignId]);

  useEffect(() => {
    let active = true;
    if (!selectedId) { setLoaded(null); return; }
    void createClient().rpc("get_player_map", { p_map_id: selectedId }).then(({ data, error }) => {
      if (!active) return;
      if (error || !data) { setLoaded(null); setMessage("Este mapa não está mais compartilhado."); return; }
      const row = data as { id: string; name: string; version: number; system_key: string | null; document: unknown };
      const parsed = parseMapDocument(row.document, row.system_key);
      if (!parsed.document) { setMessage(parsed.error); return; }
      setLoaded({ id: row.id, name: row.name, version: row.version, system_key: row.system_key, document: parsed.document });
    });
    return () => { active = false; };
  }, [selectedId, revision]);

  const movable = useMemo(() => new Set((loaded?.document.pins ?? []).filter((pin) => pin.kind === "character" && pin.sheet_id && ownSheetIds.has(pin.sheet_id)).map((pin) => pin.id)), [loaded, ownSheetIds]);
  const portraitUrls = usePortraitUrls((loaded?.document.pins ?? []).map((pin) => pin.portrait_path));

  function onPointer(event: CanvasPointer) {
    if (!loaded) return;
    if (event.kind === "down") {
      const pin = [...loaded.document.pins].reverse().find((item) => movable.has(item.id) && distance(event.point, [item.x, item.y]) <= PIN_RADIUS[item.size ?? "medium"] + 40);
      dragging.current = pin ? { pinId: pin.id, moved: false } : null;
      return;
    }
    if (event.kind === "move" && dragging.current) {
      const pinId = dragging.current.pinId;
      dragging.current.moved = true;
      const [x, y] = event.point.map(Math.round);
      setLoaded({ ...loaded, document: { ...loaded.document, pins: loaded.document.pins.map((pin) => pin.id === pinId ? { ...pin, x, y } : pin) } });
      return;
    }
    if (event.kind === "up" && dragging.current) {
      const { pinId, moved } = dragging.current;
      dragging.current = null;
      if (!moved) return;
      const pin = loaded.document.pins.find((item) => item.id === pinId);
      if (!pin) return;
      void createClient().rpc("move_own_pin", { p_map_id: loaded.id, p_pin_id: pinId, p_x: pin.x, p_y: pin.y }).then(({ error }) => {
        setMessage(error ? "Não foi possível mover o pin; o mapa foi recarregado." : "Posição do seu personagem salva.");
        setRevision((value) => value + 1);
      });
    }
  }

  const titleId = `${uid}-title`;
  return <section className={styles.panel} aria-labelledby={titleId}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>MAPA DA MESA</p><h2 id={titleId}>Mapas compartilhados</h2>
        <p className={styles.intro}>O narrador desenha o mapa. Você pode arrastar o pin do seu personagem.</p></div>
      {maps.length > 0 && <label className={styles.mapSelectLabel} htmlFor={`${uid}-select`}>Mapa
        <select id={`${uid}-select`} value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
          {maps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
    </header>
    <p className={styles.message} role="status" aria-live="polite">{message}</p>
    {maps.length === 0 ? <p className={styles.empty}>O narrador ainda não compartilhou nenhum mapa.</p>
      : loaded ? <div className={editorStyles.stage}>
        <MapCanvas document={loaded.document} kit={kitForSystem(loaded.system_key ?? loaded.document.system_key)} portraitUrls={portraitUrls}
          mode="player" movablePinIds={movable} label={`Mapa ${loaded.name}, visto de cima`} onPointer={onPointer} />
      </div> : <p className={styles.empty}>Carregando mapa…</p>}
  </section>;
}
