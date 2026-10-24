"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "../../lib/supabase/client";
import {
  houseStructures, MAX_POINTS, newMapId, parseMapDocument, redactForPlayers, removeElement, validateMapDocument,
  type MapDocumentV2, type MapPin, type MapStructure,
} from "../../lib/map-document";
import {
  distance, nearestOnPolyline, pointAlongPolyline, pointInPolygon, rectanglePoints, snapAngle, snapToGrid, snapToPoints, translatePoints, type Point,
} from "../../lib/map-geometry";
import { findProp, kitForSystem, type MapKit } from "../../lib/map-kits";
import { usePortraitUrls } from "../portrait-picker";
import { ALL_LAYERS, MapCanvas, PIN_RADIUS, type CanvasDraft, type CanvasPointer, type LayerVisibility } from "./map-canvas";
import { PinCreator, type EntityOption, type SheetOption } from "./pin-creator";
import styles from "./map-editor.module.css";

export type EditableMap = {
  id: string;
  campaign_id: string;
  name: string;
  document: Record<string, unknown>;
  version: number;
  system_key: string | null;
  shared_with_players: boolean;
  updated_at: string;
};

type Tool = "select" | "pan" | "wall" | "house" | "door" | "shadow" | "prop" | "pin" | "erase";
const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Selecionar", hint: "Clique para escolher, arraste para mover. Delete apaga." },
  { id: "pan", label: "Mover vista", hint: "Arraste para navegar. Use a roda do mouse ou dois dedos para zoom." },
  { id: "wall", label: "Muro", hint: "Clique para cada canto. Duplo clique ou Enter termina; Shift trava o ângulo em 15°." },
  { id: "house", label: "Casa", hint: "Arraste um retângulo (ou clique os cantos no modo polígono). Cria piso e muros fechados." },
  { id: "door", label: "Porta", hint: "Clique sobre um muro: a porta encaixa no ponto mais próximo." },
  { id: "shadow", label: "Sombra", hint: "Clique os cantos da área escura. Duplo clique ou Enter termina." },
  { id: "prop", label: "Objeto", hint: "Escolha um objeto do kit e clique onde colocá-lo." },
  { id: "pin", label: "Pin", hint: "Clique no mapa para criar um pin de personagem, NPC ou item." },
  { id: "erase", label: "Borracha", hint: "Clique em qualquer elemento para removê-lo." },
];
const SYSTEMS = [
  { id: "one-ring", label: "O Um Anel (medieval)" },
  { id: "vampire-v5", label: "Vampiro V5 (cidade moderna)" },
  { id: "hunter", label: "Caçador (cidade moderna)" },
];
const HISTORY_LIMIT = 100;
const SNAP_RADIUS = 140;
const HIT_RADIUS = 160;

type Drag = { id: string; from: Point; base: MapDocumentV2; moved: boolean };
type PinDraft = { pin: MapPin; isNew: boolean };

function hitTest(document: MapDocumentV2, point: Point, kit: MapKit): string | null {
  for (const pin of [...document.pins].reverse()) {
    if (distance(point, [pin.x, pin.y]) <= PIN_RADIUS[pin.size ?? "medium"] + 40) return pin.id;
  }
  const structures = [...document.structures].reverse();
  for (const item of structures) {
    if (item.type === "prop") {
      const size = ((findProp(kit, item.kind)?.size ?? 200) * item.scale) / 2;
      if (distance(point, [item.x, item.y]) <= size) return item.id;
    }
  }
  const walls = new Map(document.structures.filter((item) => item.type === "wall").map((item) => [item.id, item]));
  for (const item of structures) {
    if (item.type !== "door") continue;
    const wall = walls.get(item.wall_id);
    if (wall?.type === "wall" && distance(point, pointAlongPolyline(wall.points, item.at).point) <= item.width / 2 + 60) return item.id;
  }
  for (const item of structures) {
    if (item.type === "wall" && nearestOnPolyline(point, item.points).distance <= item.thickness / 2 + HIT_RADIUS / 2) return item.id;
  }
  for (const item of structures) {
    if ((item.type === "shadow" || item.type === "area") && pointInPolygon(point, item.points)) return item.id;
  }
  return null;
}

function moveElement(document: MapDocumentV2, id: string, dx: number, dy: number, point: Point): MapDocumentV2 {
  const pins = document.pins.map((pin) => pin.id === id ? { ...pin, x: Math.round(Math.min(10_000, Math.max(0, pin.x + dx))), y: Math.round(Math.min(document.height, Math.max(0, pin.y + dy))) } : pin);
  const structures = document.structures.map((item): MapStructure => {
    if (item.id !== id) return item;
    if (item.type === "prop") return { ...item, x: Math.round(Math.min(10_000, Math.max(0, item.x + dx))), y: Math.round(Math.min(document.height, Math.max(0, item.y + dy))) };
    if (item.type === "door") {
      const wall = document.structures.find((candidate) => candidate.id === item.wall_id);
      return wall?.type === "wall" ? { ...item, at: Number(nearestOnPolyline(point, wall.points).at.toFixed(4)) } : item;
    }
    return { ...item, points: translatePoints(item.points, dx, dy) };
  });
  return { ...document, pins, structures };
}

const MAP_COLUMNS = "id,campaign_id,name,document,version,system_key,shared_with_players,updated_at";
type MapPatch = Pick<EditableMap, "name" | "system_key" | "shared_with_players"> & { document: MapDocumentV2 };

/** Data access used by the editor; Supabase by default, replaceable by the dev fixture. */
export type MapEditorData = {
  loadReferences: (campaignId: string) => Promise<{ sheets: SheetOption[]; entities: EntityOption[] }>;
  createEntity: (campaignId: string, viewerId: string, kind: "npc" | "item", name: string) => Promise<EntityOption>;
  /** Resolves to null when the stored version moved on (optimistic lock). */
  saveMap: (map: EditableMap, patch: MapPatch) => Promise<EditableMap | null>;
  /** Fixed portrait URLs; when set, Storage is never queried. */
  portraitUrls?: Record<string, string>;
};

export const supabaseMapData: MapEditorData = {
  async loadReferences(campaignId) {
    const client = createClient();
    const [sheetResult, entityResult] = await Promise.all([
      client.from("character_sheets").select("id,name,portrait_path").eq("campaign_id", campaignId).order("name"),
      client.from("world_entities").select("id,name,kind").eq("campaign_id", campaignId).in("kind", ["npc", "item"]).order("name"),
    ]);
    return { sheets: (sheetResult.data ?? []) as SheetOption[], entities: (entityResult.data ?? []) as EntityOption[] };
  },
  async createEntity(campaignId, viewerId, kind, name) {
    const { data, error } = await createClient().from("world_entities")
      .insert({ campaign_id: campaignId, kind, name: name.slice(0, 160), body: {}, created_by: viewerId })
      .select("id,name,kind").single();
    if (error || !data) throw new Error("Não foi possível criar a entidade no mundo da campanha.");
    return data as EntityOption;
  },
  async saveMap(map, patch) {
    const { data, error } = await createClient().from("maps").update(patch)
      .eq("id", map.id).eq("campaign_id", map.campaign_id).eq("version", map.version)
      .select(MAP_COLUMNS).maybeSingle();
    if (error) throw new Error("O banco recusou o mapa. Confira estruturas e pins.");
    return (data as EditableMap | null) ?? null;
  },
};

type Props = {
  campaignId: string;
  viewerId: string;
  map: EditableMap;
  onSaved: (map: EditableMap) => void;
  onDelete: () => void;
  data?: MapEditorData;
};

/** Master-only top-down editor. Players see the redacted copy via get_player_map. */
export function MapEditor({ campaignId, viewerId, map, onSaved, onDelete, data = supabaseMapData }: Props) {
  const initial = useMemo(() => parseMapDocument(map.document, map.system_key), [map.id, map.version]);
  const [document, setDocument] = useState<MapDocumentV2 | null>(initial.document);
  const [past, setPast] = useState<MapDocumentV2[]>([]);
  const [future, setFuture] = useState<MapDocumentV2[]>([]);
  const [name, setName] = useState(map.name);
  const [shared, setShared] = useState(map.shared_with_players);
  const [tool, setTool] = useState<Tool>("select");
  const [houseShape, setHouseShape] = useState<"rect" | "polygon">("rect");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [rect, setRectState] = useState<{ from: Point; to: Point } | null>(null);
  // Pointer events can arrive faster than React re-renders; read the live rectangle from a ref.
  const rectRef = useRef<{ from: Point; to: Point } | null>(null);
  const setRect = (next: { from: Point; to: Point } | null) => { rectRef.current = next; setRectState(next); };
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>(ALL_LAYERS);
  const [snapGrid, setSnapGrid] = useState(false);
  const [previewPlayers, setPreviewPlayers] = useState(false);
  const [sheets, setSheets] = useState<SheetOption[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(initial.error);
  const [dirty, setDirty] = useState(false);
  const drag = useRef<Drag | null>(null);

  const kit = kitForSystem(document?.system_key ?? map.system_key);
  const [wallMaterial, setWallMaterial] = useState(kit.walls[0].id);
  const [wallThickness, setWallThickness] = useState(kit.walls[0].thickness);
  const [floorMaterial, setFloorMaterial] = useState(kit.houseFloor);
  const [doorStyle, setDoorStyle] = useState(kit.doors[0].id);
  const [propKind, setPropKind] = useState(kit.props[0].id);
  const [shadowOpacity, setShadowOpacity] = useState(0.55);
  const [shadowGmOnly, setShadowGmOnly] = useState(false);

  useEffect(() => {
    setDocument(initial.document); setPast([]); setFuture([]); setName(map.name); setShared(map.shared_with_players);
    setSelectedId(null); setDraftPoints([]); setRect(null); setPinDraft(null); setDirty(false); setMessage(initial.error);
  }, [initial, map.name, map.shared_with_players]);

  useEffect(() => {
    setWallMaterial(kit.walls[0].id); setWallThickness(kit.walls[0].thickness); setFloorMaterial(kit.houseFloor);
    setDoorStyle(kit.doors[0].id); setPropKind(kit.props[0].id);
  }, [kit.theme]);

  useEffect(() => {
    let active = true;
    data.loadReferences(campaignId).then((references) => {
      if (!active) return;
      setSheets(references.sheets);
      setEntities(references.entities);
    }).catch(() => { if (active) setMessage("Não foi possível carregar fichas e entidades da campanha."); });
    return () => { active = false; };
  }, [campaignId, data]);

  const portraitPaths = useMemo(() => Object.fromEntries(sheets.map((sheet) => [sheet.id, sheet.portrait_path])), [sheets]);
  const signedUrls = usePortraitUrls(data.portraitUrls ? [] : sheets.map((sheet) => sheet.portrait_path));
  const portraitUrls = data.portraitUrls ?? signedUrls;

  function commit(next: MapDocumentV2) {
    const previous = document;
    if (previous) setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), previous]);
    setDocument(next);
    setFuture([]);
    setDirty(true);
  }

  function undo() {
    if (!document || past.length === 0) return;
    setFuture((items) => [document, ...items].slice(0, HISTORY_LIMIT));
    setDocument(past[past.length - 1]);
    setPast((items) => items.slice(0, -1));
    setSelectedId(null);
    setDirty(true);
  }

  function redo() {
    if (!document || future.length === 0) return;
    setPast((items) => [...items, document].slice(-HISTORY_LIMIT));
    setDocument(future[0]);
    setFuture((items) => items.slice(1));
    setDirty(true);
  }

  function snap(point: Point, shift: boolean): Point {
    if (!document) return point;
    const anchor = draftPoints[draftPoints.length - 1];
    let next = point;
    if (shift && anchor) next = snapAngle(anchor, point);
    else {
      const endpoints = document.structures.flatMap((item) => item.type === "wall" ? [item.points[0], item.points[item.points.length - 1]] : []);
      next = snapToPoints(point, [...endpoints, ...draftPoints.slice(0, 1)], SNAP_RADIUS);
    }
    return snapGrid && next === point ? snapToGrid(next, document.grid.size) : next;
  }

  function finishPolyline() {
    if (!document) return;
    if (tool === "wall" && draftPoints.length >= 2) {
      commit({ ...document, structures: [...document.structures, { id: newMapId(), type: "wall", points: draftPoints, material: wallMaterial, thickness: wallThickness }] });
      setMessage("Muro criado.");
    } else if (tool === "shadow" && draftPoints.length >= 3) {
      commit({ ...document, structures: [...document.structures, { id: newMapId(), type: "shadow", points: draftPoints, opacity: shadowOpacity, ...(shadowGmOnly ? { gm_only: true } : {}) }] });
      setMessage("Sombra criada.");
    } else if (tool === "house" && draftPoints.length >= 3) {
      commit({ ...document, structures: [...document.structures, ...houseStructures(draftPoints, wallMaterial, floorMaterial, wallThickness)] });
      setMessage("Casa criada com piso e muros.");
    } else if (draftPoints.length > 0) {
      setMessage(tool === "wall" ? "Um muro precisa de pelo menos dois pontos." : "A área precisa de pelo menos três pontos.");
      return;
    }
    setDraftPoints([]);
    setCursor(null);
  }

  function addPoint(point: Point) {
    if (draftPoints.length >= MAX_POINTS) { setMessage(`Cada traço aceita até ${MAX_POINTS} pontos.`); return; }
    const closing = (tool === "shadow" || tool === "house") && draftPoints.length >= 3 && distance(point, draftPoints[0]) <= SNAP_RADIUS;
    if (closing) { finishPolyline(); return; }
    const last = draftPoints[draftPoints.length - 1];
    if (last && distance(last, point) < 1) return;
    setDraftPoints((items) => [...items, point]);
  }

  function onPointer(event: CanvasPointer) {
    if (!document || previewPlayers) return;
    const point = event.point;
    if (event.kind === "double") { if (tool === "wall" || tool === "shadow" || (tool === "house" && houseShape === "polygon")) finishPolyline(); return; }
    if (event.kind === "down") {
      switch (tool) {
        case "select": {
          const id = hitTest(document, point, kit);
          setSelectedId(id);
          drag.current = id ? { id, from: point, base: document, moved: false } : null;
          return;
        }
        case "wall": case "shadow": addPoint(snap(point, event.shift)); return;
        case "house":
          if (houseShape === "rect") { const start = snapGrid ? snapToGrid(point, document.grid.size) : point; setRect({ from: start, to: start }); }
          else addPoint(snap(point, event.shift));
          return;
        case "door": {
          let best: { id: string; at: number; distance: number } | null = null;
          for (const item of document.structures) {
            if (item.type !== "wall") continue;
            const hit = nearestOnPolyline(point, item.points);
            if (hit.distance <= item.thickness / 2 + 220 && (!best || hit.distance < best.distance)) best = { id: item.id, at: hit.at, distance: hit.distance };
          }
          if (!best) { setMessage("Clique mais perto de um muro para colocar a porta."); return; }
          const door: MapStructure = { id: newMapId(), type: "door", wall_id: best.id, at: Number(best.at.toFixed(4)), width: 320, style: doorStyle, state: "closed" };
          commit({ ...document, structures: [...document.structures, door] });
          setSelectedId(door.id);
          setMessage("Porta encaixada no muro. Ajuste o estado no painel ao lado.");
          return;
        }
        case "prop": {
          const prop: MapStructure = { id: newMapId(), type: "prop", kind: propKind, x: Math.round(point[0]), y: Math.round(point[1]), rotation: 0, scale: 1 };
          commit({ ...document, structures: [...document.structures, prop] });
          setSelectedId(prop.id);
          return;
        }
        case "pin":
          setPinDraft({ isNew: true, pin: { id: newMapId(), kind: "character", label: "", x: Math.round(point[0]), y: Math.round(point[1]), gm_only: false, size: "medium" } });
          return;
        case "erase": {
          const id = hitTest(document, point, kit);
          if (id) { commit(removeElement(document, id)); setSelectedId(null); setMessage("Elemento removido."); }
          return;
        }
        default: return;
      }
    }
    if (event.kind === "move") {
      if (drag.current) {
        const current = drag.current;
        const dx = Math.round(point[0] - current.from[0]);
        const dy = Math.round(point[1] - current.from[1]);
        if (!current.moved && Math.hypot(dx, dy) < 20) return;
        current.moved = true;
        setDocument(moveElement(current.base, current.id, dx, dy, point));
        return;
      }
      if (rectRef.current) { setRect({ ...rectRef.current, to: snapGrid ? snapToGrid(point, document.grid.size) : point }); return; }
      if (draftPoints.length) setCursor(snap(point, event.shift));
      return;
    }
    if (event.kind === "up") {
      if (drag.current) {
        const base = drag.current.base;
        if (drag.current.moved) { setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), base]); setFuture([]); setDirty(true); }
        drag.current = null;
      }
      const finished = rectRef.current;
      if (finished) {
        const end = snapGrid ? snapToGrid(point, document.grid.size) : point;
        const corners = rectanglePoints(finished.from, end);
        if (Math.abs(end[0] - finished.from[0]) >= 150 && Math.abs(end[1] - finished.from[1]) >= 150) {
          commit({ ...document, structures: [...document.structures, ...houseStructures(corners, wallMaterial, floorMaterial, wallThickness)] });
          setMessage("Casa criada com piso e muros. Use a ferramenta Porta para abrir entradas.");
        }
        setRect(null);
      }
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); return; }
      if (event.key === "Enter" && draftPoints.length) { event.preventDefault(); finishPolyline(); return; }
      if (event.key === "Escape") { setDraftPoints([]); setCursor(null); setRect(null); setSelectedId(null); setPinDraft(null); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && document) {
        event.preventDefault();
        commit(removeElement(document, selectedId));
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function changeTool(next: Tool) {
    setTool(next);
    setDraftPoints([]); setCursor(null); setRect(null);
    if (next !== "select") setSelectedId(null);
    setMessage("");
  }

  function updateSelected(patch: Partial<MapStructure>) {
    if (!document || !selectedId) return;
    commit({ ...document, structures: document.structures.map((item) => item.id === selectedId ? { ...item, ...patch } as MapStructure : item) });
  }

  function submitPin(pin: MapPin) {
    if (!document || !pinDraft) return;
    const pins = pinDraft.isNew ? [...document.pins, pin] : document.pins.map((item) => item.id === pin.id ? pin : item);
    commit({ ...document, pins });
    setPinDraft(null);
    setSelectedId(pin.id);
    setMessage(pinDraft.isNew ? "Pin colocado no mapa." : "Pin atualizado.");
  }

  async function createEntity(kind: "npc" | "item", entityName: string): Promise<EntityOption> {
    const entity = await data.createEntity(campaignId, viewerId, kind, entityName);
    setEntities((items) => [...items, entity]);
    return entity;
  }

  async function save() {
    if (!document || saving) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 160) { setMessage("O nome do mapa deve ter entre 1 e 160 caracteres."); return; }
    const problem = validateMapDocument(document);
    if (problem) { setMessage(problem); return; }
    setSaving(true);
    try {
      const saved = await data.saveMap(map, { name: trimmed, document, system_key: document.system_key, shared_with_players: shared });
      if (!saved) throw new Error("O mapa foi alterado em outra sessão. Atualize a lista antes de salvar de novo.");
      setDirty(false);
      setMessage(shared ? "Mapa salvo e visível para os jogadores." : "Mapa salvo.");
      onSaved(saved);
    } catch (problemError) {
      setMessage(problemError instanceof Error ? problemError.message : "Não foi possível salvar o mapa.");
    } finally { setSaving(false); }
  }

  if (!document) return <p className={styles.error} role="alert">{initial.error || "Este mapa não pode ser aberto no editor."}</p>;

  const selected = selectedId ? document.structures.find((item) => item.id === selectedId) ?? null : null;
  const selectedPin = selectedId ? document.pins.find((pin) => pin.id === selectedId) ?? null : null;
  const draft: CanvasDraft = rect ? { type: "rect", from: rect.from, to: rect.to }
    : draftPoints.length ? { type: "polyline", points: draftPoints, cursor, closed: tool !== "wall" } : null;
  const shown = previewPlayers ? redactForPlayers(document) : document;
  const activeHint = TOOLS.find((item) => item.id === tool)?.hint ?? "";
  const placedSheetIds = new Set(document.pins.flatMap((pin) => pin.sheet_id ? [pin.sheet_id] : []));

  return <div className={styles.editor}>
    <div className={styles.stageColumn}>
      <div className={styles.toolbar} role="toolbar" aria-label="Ferramentas do mapa">
        <div className={styles.toolGroup}>{TOOLS.map((item) => <button key={item.id} type="button" className={styles.tool} aria-pressed={tool === item.id} disabled={previewPlayers} title={item.hint} onClick={() => changeTool(item.id)}>{item.label}</button>)}</div>
        <div className={styles.toolGroup}>
          <button type="button" className={styles.tool} disabled={past.length === 0} onClick={undo} title="Ctrl+Z">Desfazer</button>
          <button type="button" className={styles.tool} disabled={future.length === 0} onClick={redo} title="Ctrl+Y">Refazer</button>
          {draftPoints.length > 0 && <button type="button" className={styles.tool} onClick={finishPolyline}>Concluir traço</button>}
        </div>
      </div>
      <p className={styles.hint}>{previewPlayers ? "Prévia do que os jogadores veem: pins e sombras só do Mestre ficam ocultos." : activeHint}</p>
      <div className={styles.stage}>
        <MapCanvas document={shown} kit={kit} portraitUrls={portraitUrls} portraitPaths={portraitPaths} mode={previewPlayers ? "player" : "editor"}
          selectedId={previewPlayers ? null : selectedId} draft={draft} layers={layers} label={`Mapa ${name}, visto de cima`}
          onPointer={onPointer} panMode={tool === "pan"} />
      </div>
      <p className={styles.status} role="status" aria-live="polite">{message || (dirty ? "Alterações ainda não salvas." : "")}</p>
    </div>

    <aside className={styles.side}>
      <section className={styles.card} aria-label="Mapa">
        <label>Nome do mapa<input value={name} maxLength={160} onChange={(event) => { setName(event.target.value); setDirty(true); }} /></label>
        <label>Sistema e tema
          <select value={document.system_key ?? "vampire-v5"} onChange={(event) => commit({ ...document, system_key: event.target.value, background: kitForSystem(event.target.value).background })}>
            {SYSTEMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label>Chão de fundo
          <select value={document.background} onChange={(event) => commit({ ...document, background: event.target.value })}>
            {kit.floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.label}</option>)}
          </select>
        </label>
        <label className={styles.check}><input type="checkbox" checked={document.grid.visible} onChange={(event) => commit({ ...document, grid: { ...document.grid, visible: event.target.checked } })} />Grade visível</label>
        <label className={styles.check}><input type="checkbox" checked={snapGrid} onChange={(event) => setSnapGrid(event.target.checked)} />Ímã na grade</label>
        <label className={styles.check}><input type="checkbox" checked={shared} onChange={(event) => { setShared(event.target.checked); setDirty(true); }} />Compartilhar com os jogadores</label>
        <label className={styles.check}><input type="checkbox" checked={previewPlayers} onChange={(event) => { setPreviewPlayers(event.target.checked); setSelectedId(null); }} />Ver como jogador</label>
        <div className={styles.row}>
          <button type="button" className={`${styles.tool} ${styles.primary}`} disabled={saving} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar mapa"}</button>
          <button type="button" className={`${styles.tool} ${styles.danger}`} disabled={saving} onClick={onDelete}>Excluir</button>
        </div>
      </section>

      {pinDraft && <PinCreator key={pinDraft.pin.id} kit={kit} pin={pinDraft.pin} isNew={pinDraft.isNew} sheets={sheets} entities={entities}
        portraitUrls={portraitUrls} placedSheetIds={placedSheetIds} onSubmit={submitPin} onCancel={() => setPinDraft(null)} onCreateEntity={createEntity} />}

      {!pinDraft && (tool === "wall" || tool === "house") && <section className={styles.card} aria-label="Muros">
        <h4>{tool === "house" ? "Casa" : "Muro"}</h4>
        {tool === "house" && <div className={styles.row}>
          <button type="button" className={styles.tool} aria-pressed={houseShape === "rect"} onClick={() => { setHouseShape("rect"); setDraftPoints([]); }}>Retângulo</button>
          <button type="button" className={styles.tool} aria-pressed={houseShape === "polygon"} onClick={() => setHouseShape("polygon")}>Polígono</button>
        </div>}
        <label>Material do muro<select value={wallMaterial} onChange={(event) => { setWallMaterial(event.target.value); setWallThickness(kit.walls.find((item) => item.id === event.target.value)?.thickness ?? 60); }}>{kit.walls.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Espessura ({wallThickness})<input type="range" min={10} max={200} value={wallThickness} onChange={(event) => setWallThickness(Number(event.target.value))} /></label>
        {tool === "house" && <label>Piso<select value={floorMaterial} onChange={(event) => setFloorMaterial(event.target.value)}>{kit.floors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      </section>}

      {!pinDraft && tool === "door" && <section className={styles.card} aria-label="Portas">
        <h4>Porta</h4>
        <label>Estilo<select value={doorStyle} onChange={(event) => setDoorStyle(event.target.value)}>{kit.doors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </section>}

      {!pinDraft && tool === "shadow" && <section className={styles.card} aria-label="Sombras">
        <h4>Sombra</h4>
        <label>Escuridão ({Math.round(shadowOpacity * 100)}%)<input type="range" min={10} max={100} value={Math.round(shadowOpacity * 100)} onChange={(event) => setShadowOpacity(Number(event.target.value) / 100)} /></label>
        <label className={styles.check}><input type="checkbox" checked={shadowGmOnly} onChange={(event) => setShadowGmOnly(event.target.checked)} />Só o Mestre vê</label>
      </section>}

      {!pinDraft && tool === "prop" && <section className={styles.card} aria-label="Objetos">
        <h4>Objetos · {kit.label}</h4>
        <div className={styles.palette}>{kit.props.map((item) => <button key={item.id} type="button" className={styles.paletteItem} aria-pressed={propKind === item.id} onClick={() => setPropKind(item.id)}>
          <svg viewBox="-55 -55 110 110" aria-hidden="true">{item.shapes.map((shape, index) => shape.shape === "rect" ? <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r} fill={shape.fill} stroke={shape.stroke} />
            : shape.shape === "circle" ? <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} stroke={shape.stroke} /> : <line key={index} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={shape.stroke} strokeWidth={shape.width} />)}</svg>
          {item.label}</button>)}</div>
      </section>}

      {!pinDraft && selected && <section className={styles.card} aria-label="Elemento selecionado">
        <h4>{selected.type === "wall" ? "Muro" : selected.type === "area" ? "Área / piso" : selected.type === "door" ? "Porta" : selected.type === "shadow" ? "Sombra" : findProp(kit, selected.kind)?.label ?? "Objeto"}</h4>
        {selected.type === "wall" && <>
          <label>Material<select value={selected.material} onChange={(event) => updateSelected({ material: event.target.value })}>{kit.walls.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Espessura ({selected.thickness})<input type="range" min={10} max={200} value={selected.thickness} onChange={(event) => updateSelected({ thickness: Number(event.target.value) })} /></label>
        </>}
        {selected.type === "area" && <>
          <label>Piso<select value={selected.material} onChange={(event) => updateSelected({ material: event.target.value })}>{kit.floors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Rótulo<input value={selected.label ?? ""} maxLength={120} onChange={(event) => updateSelected({ label: event.target.value || undefined })} placeholder="Ex.: Taverna" /></label>
        </>}
        {selected.type === "door" && <>
          <label>Estilo<select value={selected.style} onChange={(event) => updateSelected({ style: event.target.value })}>{kit.doors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Estado<select value={selected.state} onChange={(event) => updateSelected({ state: event.target.value as "open" | "closed" | "locked" })}><option value="closed">Fechada</option><option value="open">Aberta</option><option value="locked">Trancada</option></select></label>
          <label>Largura ({selected.width})<input type="range" min={100} max={1200} step={20} value={selected.width} onChange={(event) => updateSelected({ width: Number(event.target.value) })} /></label>
        </>}
        {selected.type === "shadow" && <label>Escuridão ({Math.round(selected.opacity * 100)}%)<input type="range" min={10} max={100} value={Math.round(selected.opacity * 100)} onChange={(event) => updateSelected({ opacity: Number(event.target.value) / 100 })} /></label>}
        {selected.type === "prop" && <>
          <label>Rotação ({selected.rotation}°)<input type="range" min={0} max={345} step={15} value={selected.rotation} onChange={(event) => updateSelected({ rotation: Number(event.target.value) })} /></label>
          <label>Tamanho ({Math.round(selected.scale * 100)}%)<input type="range" min={25} max={400} step={5} value={Math.round(selected.scale * 100)} onChange={(event) => updateSelected({ scale: Number(event.target.value) / 100 })} /></label>
        </>}
        <label className={styles.check}><input type="checkbox" checked={selected.gm_only === true} onChange={(event) => updateSelected({ gm_only: event.target.checked || undefined })} />Só o Mestre vê</label>
        <button type="button" className={`${styles.tool} ${styles.danger}`} onClick={() => { commit(removeElement(document, selected.id)); setSelectedId(null); }}>Remover</button>
      </section>}

      {!pinDraft && selectedPin && <section className={styles.card} aria-label="Pin selecionado">
        <h4>{selectedPin.label}</h4>
        <p className={styles.hint}>{selectedPin.kind === "character" ? "Personagem (foto da ficha)" : selectedPin.kind === "npc" ? "NPC" : "Item"}{selectedPin.gm_only ? " · só o Mestre vê" : ""}</p>
        <div className={styles.row}>
          <button type="button" className={styles.tool} onClick={() => setPinDraft({ pin: selectedPin, isNew: false })}>Editar pin</button>
          <button type="button" className={`${styles.tool} ${styles.danger}`} onClick={() => { commit(removeElement(document, selectedPin.id)); setSelectedId(null); }}>Remover</button>
        </div>
      </section>}

      <section className={styles.card} aria-label="Camadas">
        <h4>Camadas</h4>
        {([["areas", "Pisos e casas"], ["shadows", "Sombras"], ["walls", "Muros e portas"], ["props", "Objetos"], ["pins", "Pins"], ["grid", "Grade"]] as const).map(([key, label]) =>
          <label key={key} className={styles.check}><input type="checkbox" checked={layers[key]} onChange={(event) => setLayers({ ...layers, [key]: event.target.checked })} />{label}</label>)}
        <p className={styles.hint}>{document.structures.length} estruturas · {document.pins.length} pins</p>
      </section>
    </aside>
  </div>;
}
