"use client";

import { PointerEvent, useEffect, useId, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { downloadText } from "../lib/download";
import styles from "./saved-maps-panel.module.css";

type MarkerType = "location" | "character" | "threat" | "objective" | "secret";
type TerrainCell = { x: number; y: number; kind: string };
type TerrainLayer = { id: string; cells?: TerrainCell[]; [key: string]: unknown };
type SavedMarker = { id: string; label: string; x: number; y: number; type: MarkerType; color: string; description: string };
type MapDocument = { width: number | null; height: number | null; layers: TerrainLayer[]; seed: number | string | null; grid_enabled: boolean; markers: SavedMarker[]; raw: Record<string, unknown> };
type SavedMap = { id: string; campaign_id: string; name: string; document: Record<string, unknown>; grid_kind: string; isometric: boolean; version: number; updated_at: string };
type MarkerDraft = { id: string | null; label: string; description: string; type: MarkerType; color: string; x: number | null; y: number | null };

const MARKER_TYPES: Record<MarkerType, string> = {
  location: "Local",
  character: "Personagem",
  threat: "Ameaça",
  objective: "Objetivo",
  secret: "Segredo",
};
const MARKER_COLORS = ["#b55b32", "#83a89a", "#d6b15d", "#a16b8d", "#7397b5"];
const MAX_MARKERS = 100;
const MAP_MAX = 10_000;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseMapDocument(value: unknown): { document: MapDocument | null; error: string } {
  if (!record(value)) return { document: null, error: "O documento do mapa não tem um formato reconhecido." };
  if (value.layers !== undefined && !Array.isArray(value.layers)) return { document: null, error: "A lista de camadas deste mapa está inválida." };
  let layers: TerrainLayer[];
  try {
    layers = (Array.isArray(value.layers) ? value.layers : []).map((layer) => {
      if (!record(layer) || typeof layer.id !== "string") throw new Error();
      if (layer.cells !== undefined && !Array.isArray(layer.cells)) throw new Error();
      const cells = (Array.isArray(layer.cells) ? layer.cells : []).map((cell) => {
        if (!record(cell) || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || typeof cell.kind !== "string") throw new Error();
        return { x: cell.x as number, y: cell.y as number, kind: cell.kind };
      });
      return { ...layer, cells } as TerrainLayer;
    });
  } catch {
    return { document: null, error: "As camadas ou células deste mapa estão inválidas." };
  }

  const width = value.width === undefined ? null : value.width;
  const height = value.height === undefined ? null : value.height;
  if ((width !== null && (!Number.isInteger(width) || (width as number) < 1 || (width as number) > 128)) || (height !== null && (!Number.isInteger(height) || (height as number) < 1 || (height as number) > 128))) {
    return { document: null, error: "As dimensões salvas precisam ser inteiros entre 1 e 128." };
  }
  if ((width === null) !== (height === null)) return { document: null, error: "O mapa tem só uma das dimensões necessárias para desenhar o terreno." };
  if (typeof width === "number" && typeof height === "number" && width * height > 16384) return { document: null, error: "O terreno excede o limite de células aceito pelo painel." };

  const rawSeed = value.seed;
  if (rawSeed !== undefined && rawSeed !== null && !((typeof rawSeed === "string" && rawSeed.length <= 128) || (typeof rawSeed === "number" && Number.isSafeInteger(rawSeed) && rawSeed >= 0))) {
    return { document: null, error: "A seed salva neste mapa está inválida." };
  }

  const markersValue = value.markers === undefined ? [] : value.markers;
  if (!Array.isArray(markersValue) || markersValue.length > MAX_MARKERS) return { document: null, error: `O mapa pode ter no máximo ${MAX_MARKERS} marcadores.` };
  const seen = new Set<string>();
  const markers: SavedMarker[] = [];
  for (const candidate of markersValue) {
    if (!record(candidate)) return { document: null, error: "Um marcador salvo tem formato inválido." };
    const type = candidate.type;
    if (typeof candidate.id !== "string" || !candidate.id || seen.has(candidate.id) || typeof candidate.label !== "string" || candidate.label.length < 1 || candidate.label.length > 120 || !Number.isInteger(candidate.x) || (candidate.x as number) < 0 || (candidate.x as number) > MAP_MAX || !Number.isInteger(candidate.y) || (candidate.y as number) < 0 || (candidate.y as number) > MAP_MAX || typeof type !== "string" || !(type in MARKER_TYPES) || typeof candidate.color !== "string" || !/^#[\da-f]{6}$/i.test(candidate.color) || typeof candidate.description !== "string" || candidate.description.length > 2000) {
      return { document: null, error: "Um marcador salvo contém valores fora do formato aceito." };
    }
    seen.add(candidate.id);
    markers.push({ id: candidate.id, label: candidate.label, x: candidate.x as number, y: candidate.y as number, type: type as MarkerType, color: candidate.color, description: candidate.description });
  }
  if (layers.some((layer) => layer.cells?.some((cell) => typeof width === "number" && typeof height === "number" && (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height)))) {
    return { document: null, error: "Uma célula do terreno está fora das dimensões salvas." };
  }

  return {
    document: {
      width: width as number | null,
      height: height as number | null,
      layers,
      seed: (rawSeed ?? null) as number | string | null,
      grid_enabled: typeof value.grid_enabled === "boolean" ? value.grid_enabled : true,
      markers,
      raw: value,
    },
    error: "",
  };
}

function drawMap(canvas: HTMLCanvasElement, document: MapDocument, includeMarkers = false) {
  if (document.width === null || document.height === null) return;
  const cellSize = 28;
  const width = document.width;
  const height = document.height;
  canvas.width = width * cellSize;
  canvas.height = height * cellSize;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Seu navegador não disponibilizou o canvas.");

  context.fillStyle = "#111714";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const terrain = document.layers.find((layer) => layer.id === "terrain");
  const terrainColors: Record<string, string> = { room: "#536b59", corridor: "#947a55", wall: "#252b28", water: "#365f69", forest: "#345541", mountain: "#77776c" };
  for (const cell of terrain?.cells ?? []) {
    const color = terrainColors[cell.kind];
    if (!color) continue;
    context.fillStyle = color;
    context.fillRect(cell.x * cellSize, cell.y * cellSize, cellSize, cellSize);
  }

  if (document.grid_enabled) {
    context.strokeStyle = "rgba(220, 232, 218, 0.24)";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= width; x += 1) { context.moveTo(x * cellSize + 0.5, 0); context.lineTo(x * cellSize + 0.5, height * cellSize); }
    for (let y = 0; y <= height; y += 1) { context.moveTo(0, y * cellSize + 0.5); context.lineTo(width * cellSize, y * cellSize + 0.5); }
    context.stroke();
  }

  if (includeMarkers) {
    for (const marker of document.markers) {
      const x = (marker.x / MAP_MAX) * canvas.width;
      const y = (marker.y / MAP_MAX) * canvas.height;
      context.beginPath();
      context.arc(x, y, 8, 0, Math.PI * 2);
      context.fillStyle = marker.color;
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = "#111714";
      context.stroke();
    }
  }
}

function saveFile(filename: string, value: BlobPart, mime: string) {
  const url = URL.createObjectURL(new Blob([value], { type: mime }));
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mapFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mapa";
}

export function SavedMapsPanel({ campaignId, viewerId: _viewerId, canManage }: { campaignId: string; viewerId: string; canManage: boolean }) {
  const uid = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const campaignRef = useRef(campaignId);
  const refreshRef = useRef<() => void>(() => undefined);
  campaignRef.current = campaignId;
  const [maps, setMaps] = useState<SavedMap[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [gridDraft, setGridDraft] = useState(true);
  const [markerDraft, setMarkerDraft] = useState<MarkerDraft | null>(null);
  const [markerFormOpen, setMarkerFormOpen] = useState(false);

  useEffect(() => {
    let active = true;
    let requestId = 0;
    const requestCampaignId = campaignId;
    setMaps([]);
    setSelectedId(null);
    setNameDraft("");
    setGridDraft(true);
    setMarkerDraft(null);
    setMarkerFormOpen(false);
    setSaving(false);
    setMessage("");
    setLoading(true);

    async function loadMaps() {
      const currentRequest = ++requestId;
      try {
        if (!canManage) {
          if (active && currentRequest === requestId) setMaps([]);
          return;
        }
        const { data, error } = await createClient().from("maps").select("id, campaign_id, name, document, grid_kind, isometric, version, updated_at").eq("campaign_id", requestCampaignId).order("updated_at", { ascending: false });
        if (!active || currentRequest !== requestId) return;
        if (error) throw error;
        const rows = (data ?? []) as SavedMap[];
        setMaps(rows);
        setSelectedId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? null);
      } catch {
        if (active && currentRequest === requestId) setMessage("Não foi possível carregar os mapas salvos desta campanha.");
      } finally {
        if (active && currentRequest === requestId) setLoading(false);
      }
    }

    refreshRef.current = () => void loadMaps();
    void loadMaps();
    return () => { active = false; refreshRef.current = () => undefined; };
  }, [campaignId, canManage]);

  const selectedMap = maps.find((item) => item.id === selectedId) ?? null;
  const parsed = selectedMap ? parseMapDocument(selectedMap.document) : { document: null, error: "" };
  const mapDocument = parsed.document;

  useEffect(() => {
    if (!selectedMap || !mapDocument || !canvasRef.current) return;
    try { drawMap(canvasRef.current, mapDocument); }
    catch { setMessage("Não foi possível desenhar este mapa neste navegador."); }
  }, [selectedMap?.id, selectedMap?.version, mapDocument]);

  useEffect(() => {
    if (!selectedMap) return;
    setNameDraft(selectedMap.name);
    setGridDraft(mapDocument?.grid_enabled ?? true);
    setMarkerDraft(null);
    setMarkerFormOpen(false);
    setMessage(parsed.error);
  }, [selectedMap?.id, selectedMap?.version]);

  function currentCampaign(requestCampaignId: string) { return campaignRef.current === requestCampaignId; }

  function stagePoint(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.min(MAP_MAX, Math.max(0, Math.round(((event.clientX - rect.left) / rect.width) * MAP_MAX))),
      y: Math.min(MAP_MAX, Math.max(0, Math.round(((event.clientY - rect.top) / rect.height) * MAP_MAX))),
    };
  }

  function placeDraft(event: PointerEvent<HTMLDivElement>) {
    if (!canManage || !mapDocument || mapDocument.width === null || !selectedMap || saving) return;
    const point = stagePoint(event);
    if (!point) return;
    setMarkerDraft({ id: null, label: "", description: "", type: "location", color: MARKER_COLORS[0], ...point });
    setMarkerFormOpen(true);
    setMessage("Posição do marcador escolhida. Preencha os dados e salve.");
  }

  async function saveMapSettings() {
    if (!canManage || !selectedMap || !mapDocument) return;
    const requestCampaignId = campaignId;
    const name = nameDraft.trim();
    if (!name || name.length > 160) { setMessage("O nome do mapa deve ter entre 1 e 160 caracteres."); return; }
    setSaving(true);
    setMessage("");
    try {
      const nextDocument = { ...mapDocument.raw, grid_enabled: gridDraft };
      const { data, error } = await createClient().from("maps").update({ name, document: nextDocument }).eq("id", selectedMap.id).eq("campaign_id", requestCampaignId).eq("version", selectedMap.version).select("id").maybeSingle();
      if (!currentCampaign(requestCampaignId)) return;
      if (error || !data) throw error ?? new Error("stale map");
      setMessage("Nome e grade do mapa salvos.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível salvar. Atualize a lista para receber a versão atual do mapa.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function saveMarker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !selectedMap || !mapDocument || !markerDraft) return;
    const requestCampaignId = campaignId;
    const label = markerDraft.label.trim();
    if (!label || label.length > 120 || markerDraft.description.length > 2000 || markerDraft.x === null || markerDraft.y === null) {
      setMessage("Escolha uma posição e informe um nome de até 120 caracteres.");
      return;
    }
    if (!/^#[\da-f]{6}$/i.test(markerDraft.color)) { setMessage("Selecione uma cor hexadecimal válida."); return; }
    const exists = markerDraft.id ? mapDocument.markers.some((item) => item.id === markerDraft.id) : false;
    if (markerDraft.id && !exists) { setMessage("Este marcador mudou. Atualize o mapa antes de salvar."); return; }
    if (!markerDraft.id && mapDocument.markers.length >= MAX_MARKERS) { setMessage(`Este mapa já atingiu o limite de ${MAX_MARKERS} marcadores.`); return; }

    const marker: SavedMarker = { id: markerDraft.id ?? crypto.randomUUID(), label, description: markerDraft.description.trim(), type: markerDraft.type, color: markerDraft.color, x: markerDraft.x, y: markerDraft.y };
    const markers = markerDraft.id ? mapDocument.markers.map((item) => item.id === marker.id ? marker : item) : [...mapDocument.markers, marker];
    setSaving(true);
    setMessage("");
    try {
      const { data, error } = await createClient().from("maps").update({ document: { ...mapDocument.raw, markers } }).eq("id", selectedMap.id).eq("campaign_id", requestCampaignId).eq("version", selectedMap.version).select("id").maybeSingle();
      if (!currentCampaign(requestCampaignId)) return;
      if (error || !data) throw error ?? new Error("stale map");
      setMessage(markerDraft.id ? "Marcador atualizado." : "Marcador salvo no mapa.");
      setMarkerDraft(null);
      setMarkerFormOpen(false);
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível salvar o marcador. Atualize o mapa antes de tentar novamente.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function deleteMarker(marker: SavedMarker) {
    if (!canManage || !selectedMap || !mapDocument || !window.confirm(`Remover o marcador ${marker.label}?`)) return;
    const requestCampaignId = campaignId;
    setSaving(true);
    try {
      const markers = mapDocument.markers.filter((item) => item.id !== marker.id);
      const { data, error } = await createClient().from("maps").update({ document: { ...mapDocument.raw, markers } }).eq("id", selectedMap.id).eq("campaign_id", requestCampaignId).eq("version", selectedMap.version).select("id").maybeSingle();
      if (!currentCampaign(requestCampaignId)) return;
      if (error || !data) throw error ?? new Error("stale map");
      setMessage("Marcador removido.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível remover o marcador. Atualize o mapa antes de tentar novamente.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  async function deleteMap() {
    if (!canManage || !selectedMap || !window.confirm(`Excluir o mapa ${selectedMap.name} e seus marcadores?`)) return;
    const requestCampaignId = campaignId;
    setSaving(true);
    try {
      const { data, error } = await createClient().from("maps").delete().eq("id", selectedMap.id).eq("campaign_id", requestCampaignId).eq("version", selectedMap.version).select("id").maybeSingle();
      if (!currentCampaign(requestCampaignId)) return;
      if (error || !data) throw error ?? new Error("stale map");
      setMessage("Mapa excluído.");
      refreshRef.current();
    } catch {
      if (currentCampaign(requestCampaignId)) setMessage("Não foi possível excluir o mapa. Atualize a lista e tente novamente.");
    } finally {
      if (currentCampaign(requestCampaignId)) setSaving(false);
    }
  }

  function exportJson() {
    if (!selectedMap) return;
    try {
      downloadText(`${mapFilePart(selectedMap.name)}.json`, JSON.stringify({ name: selectedMap.name, grid_kind: selectedMap.grid_kind, isometric: selectedMap.isometric, document: selectedMap.document }, null, 2));
      setMessage("JSON do mapa salvo.");
    } catch {
      setMessage("Não foi possível exportar o JSON do mapa.");
    }
  }

  function exportPng() {
    if (!selectedMap || !mapDocument || mapDocument.width === null || mapDocument.height === null) return;
    try {
      const exportCanvas = window.document.createElement("canvas");
      drawMap(exportCanvas, mapDocument, true);
      exportCanvas.toBlob((blob) => {
        if (!blob) { setMessage("O navegador não conseguiu gerar o PNG."); return; }
        saveFile(`${mapFilePart(selectedMap.name)}.png`, blob, "image/png");
        setMessage("PNG do mapa salvo.");
      }, "image/png");
    } catch {
      setMessage("Não foi possível exportar o PNG deste mapa.");
    }
  }

  const titleId = `${uid}-title`;

  return (
    <section className={styles.panel} aria-labelledby={titleId} aria-busy={loading || saving}>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>CARTOGRAFIA DA CAMPANHA</p><h2 id={titleId}>Mapas salvos</h2><p className={styles.intro}>Mapas e marcadores persistidos nesta campanha.</p></div>
        <button type="button" className={styles.secondaryButton} disabled={loading || saving || !canManage} onClick={() => refreshRef.current()}>Atualizar</button>
        {canManage && maps.length > 0 && <label className={styles.mapSelectLabel} htmlFor={`${uid}-map-select`}>Mapa<select id={`${uid}-map-select`} value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>{maps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      </header>

      <p className={styles.message} role="status" aria-live="polite">{message}</p>
      {loading ? <p className={styles.empty}>Carregando mapas…</p> : !canManage ? <p className={styles.empty}>Mapas salvos ficam disponíveis ao narrador desta campanha.</p> : maps.length === 0 ? <p className={styles.empty}>Nenhum mapa salvo nesta campanha. Use o gerador de mapas para criar o primeiro.</p> : selectedMap && mapDocument ? (
        <div className={styles.workspace}>
          <div className={styles.mapColumn}>
            <div className={styles.toolbar}>
              <label htmlFor={`${uid}-map-name`}>Nome do mapa<input id={`${uid}-map-name`} value={nameDraft} maxLength={160} onChange={(event) => setNameDraft(event.target.value)} /></label>
              <label className={styles.gridToggle} htmlFor={`${uid}-grid`}><input id={`${uid}-grid`} type="checkbox" checked={gridDraft} onChange={(event) => setGridDraft(event.target.checked)} />Grade visível</label>
              <button type="button" className={styles.primaryButton} disabled={saving || !nameDraft.trim()} onClick={() => void saveMapSettings()}>Salvar ajustes</button>
              <button type="button" className={styles.secondaryButton} disabled={saving} onClick={exportJson}>Exportar JSON</button>
              <button type="button" className={styles.secondaryButton} disabled={saving || mapDocument.width === null} onClick={exportPng}>Exportar PNG</button>
              <button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void deleteMap()}>Excluir mapa</button>
            </div>

            {mapDocument.width !== null && mapDocument.height !== null ? <div className={styles.mapStage} style={{ aspectRatio: `${mapDocument.width} / ${mapDocument.height}` }} role="group" aria-label={`Terreno de ${mapDocument.width} por ${mapDocument.height} células. ${canManage ? "Clique para marcar uma posição." : ""}`} onClick={(event) => placeDraft(event as unknown as PointerEvent<HTMLDivElement>)} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && canManage) { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setMarkerDraft({ id: null, label: "", description: "", type: "location", color: MARKER_COLORS[0], x: MAP_MAX / 2, y: MAP_MAX / 2 }); setMarkerFormOpen(true); } }} tabIndex={canManage ? 0 : -1}>
              <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
              {mapDocument.markers.map((marker) => <span className={styles.markerPin} key={marker.id} style={{ left: `${marker.x / 100}%`, top: `${marker.y / 100}%`, backgroundColor: marker.color }} aria-hidden="true" />)}
              {markerDraft && markerDraft.id === null && markerDraft.x !== null && markerDraft.y !== null && <span className={styles.pendingPin} style={{ left: `${markerDraft.x / 100}%`, top: `${markerDraft.y / 100}%` }} aria-hidden="true" />}
            </div> : <div className={styles.noTerrain}>Este mapa salvo não contém dimensões de terreno. A prévia e o PNG ficam indisponíveis até que um gerador salve um terreno compatível.</div>}
            <p className={styles.mapMeta}>{mapDocument.width === null ? "Terreno sem dimensões" : `${mapDocument.width} × ${mapDocument.height} células`}{mapDocument.seed !== null ? ` · seed ${mapDocument.seed}` : ""} · {mapDocument.markers.length} marcador(es)</p>
          </div>

          <aside className={styles.markerPanel} aria-labelledby={`${uid}-markers-title`}>
            <div className={styles.markerHeading}><div><p className={styles.eyebrow}>PONTOS DE INTERESSE</p><h3 id={`${uid}-markers-title`}>Marcadores</h3></div><span className={styles.count}>{mapDocument.markers.length}/{MAX_MARKERS}</span></div>
            <p className={styles.hint}>Clique no terreno para preparar um marcador. As posições são salvas em coordenadas normalizadas.</p>
            {markerFormOpen && markerDraft && <form className={styles.markerForm} onSubmit={saveMarker}>
              <label htmlFor={`${uid}-marker-label`}>Identificação<input id={`${uid}-marker-label`} autoFocus maxLength={120} required value={markerDraft.label} onChange={(event) => setMarkerDraft({ ...markerDraft, label: event.target.value })} /></label>
              <label htmlFor={`${uid}-marker-type`}>Tipo<select id={`${uid}-marker-type`} value={markerDraft.type} onChange={(event) => setMarkerDraft({ ...markerDraft, type: event.target.value as MarkerType })}>{Object.entries(MARKER_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label htmlFor={`${uid}-marker-description`}>Nota<textarea id={`${uid}-marker-description`} rows={3} maxLength={2000} value={markerDraft.description} onChange={(event) => setMarkerDraft({ ...markerDraft, description: event.target.value })} /></label>
              <fieldset className={styles.colorChoices}><legend>Cor do marcador</legend>{MARKER_COLORS.map((color) => <button key={color} type="button" aria-label={`Selecionar cor ${color}`} aria-pressed={markerDraft.color === color} style={{ backgroundColor: color }} onClick={() => setMarkerDraft({ ...markerDraft, color })} />)}</fieldset>
              <p className={styles.hint}>{markerDraft.x === null || markerDraft.y === null ? "Escolha a posição no mapa." : `Posição: ${markerDraft.x}, ${markerDraft.y}`}</p>
              <div className={styles.actions}><button className={styles.primaryButton} disabled={saving || markerDraft.x === null || markerDraft.y === null}>{markerDraft.id ? "Salvar marcador" : "Adicionar marcador"}</button><button type="button" className={styles.secondaryButton} onClick={() => { setMarkerDraft(null); setMarkerFormOpen(false); }}>Cancelar</button></div>
            </form>}
            {mapDocument.markers.length ? <ul className={styles.markerList}>{mapDocument.markers.map((marker) => <li className={styles.markerItem} key={marker.id}>
              <span className={styles.swatch} style={{ backgroundColor: marker.color }} aria-hidden="true" />
              <div className={styles.markerInfo}><strong>{marker.label}</strong><small>{MARKER_TYPES[marker.type]}</small>{marker.description && <p>{marker.description}</p>}<small>Posição {marker.x}, {marker.y}</small></div>
              <div className={styles.markerActions}><button type="button" className={styles.textButton} disabled={saving} onClick={() => { setMarkerDraft({ id: marker.id, label: marker.label, description: marker.description, type: marker.type, color: marker.color, x: marker.x, y: marker.y }); setMarkerFormOpen(true); }}>Editar</button><button type="button" className={styles.dangerButton} disabled={saving} aria-label={`Remover ${marker.label}`} onClick={() => void deleteMarker(marker)}>Remover</button></div>
            </li>)}</ul> : <p className={styles.empty}>Nenhum marcador neste mapa.</p>}
          </aside>
        </div>
      ) : selectedMap ? <p className={styles.error} role="alert">{parsed.error}</p> : <p className={styles.empty}>Selecione um mapa salvo.</p>}
    </section>
  );
}
