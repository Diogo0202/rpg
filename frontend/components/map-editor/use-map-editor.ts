"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  houseStructures, MAX_FOG_REGIONS, MAX_POINTS, newMapId, parseMapDocument, removeElement, validateMapDocument,
  type MapDocumentV2, type MapFog, type MapPin, type MapStructure,
} from "../../lib/map-document";
import { distance, rectanglePoints, snapAngle, snapToGrid, snapToPoints, type Point } from "../../lib/map-geometry";
import { kitForSystem } from "../../lib/map-kits";
import { fogCellRect, redactForViewer, viewerMasks } from "../../lib/map-visibility";
import { buildUniversalVtt, vttImageSize } from "../../lib/map-transfer";
import { connectRooms, duplicateSelection, findRoom, moveSelection } from "../../lib/map-editing";
import { blobToBase64, downloadBlob, rasterizeMapSvg } from "../../lib/map-raster";
import { usePortraitUrls } from "../portrait-picker";
import { ALL_LAYERS, type CanvasDraft, type CanvasPointer, type LayerVisibility } from "./map-canvas";
import type { EditableMap, MapEditorData } from "./map-editor-data";
import {
  chosenMove, EMPTY_FOG, fogPlayers, fogRegion, HISTORY_LIMIT, hitTest, mapFilePart, nearestWall, regionTargets, SNAP_RADIUS, wholeMap,
  type Tool,
} from "./editor-model";
import type { EntityOption, SheetOption } from "./pin-creator";

type Drag = { id: string; from: Point; base: MapDocumentV2; moved: boolean };
type PinDraft = { pin: MapPin; isNew: boolean };
type Rect = { from: Point; to: Point };

/** Histórico de desfazer/refazer do documento, limitado a HISTORY_LIMIT passos. */
function useDocumentHistory(initial: MapDocumentV2 | null) {
  const [document, setDocument] = useState<MapDocumentV2 | null>(initial);
  const [past, setPast] = useState<MapDocumentV2[]>([]);
  const [future, setFuture] = useState<MapDocumentV2[]>([]);
  const [dirty, setDirty] = useState(false);

  function remember(previous: MapDocumentV2) {
    setPast((items) => [...items.slice(-(HISTORY_LIMIT - 1)), previous]);
    setFuture([]);
    setDirty(true);
  }

  return {
    document, past, future, dirty, setDirty,
    /** Mostra um estado intermediário (arrasto) sem entrar no histórico. */
    preview: setDocument,
    commit(next: MapDocumentV2) {
      if (document) remember(document);
      setDocument(next);
    },
    /** Fecha um arrasto: o estado de antes vira um passo do histórico. */
    settle: remember,
    undo(): boolean {
      if (!document || past.length === 0) return false;
      setFuture((items) => [document, ...items].slice(0, HISTORY_LIMIT));
      setDocument(past[past.length - 1]);
      setPast((items) => items.slice(0, -1));
      setDirty(true);
      return true;
    },
    redo() {
      if (!document || future.length === 0) return;
      setPast((items) => [...items, document].slice(-HISTORY_LIMIT));
      setDocument(future[0]);
      setFuture((items) => items.slice(1));
      setDirty(true);
    },
    reset(next: MapDocumentV2 | null) {
      setDocument(next); setPast([]); setFuture([]); setDirty(false);
    },
  };
}

/** Estado e comandos do editor de mapas do narrador. A vista só lê o que este hook devolve. */
export function useMapEditor({ campaignId, viewerId, map, onSaved, data }: {
  campaignId: string; viewerId: string; map: EditableMap; onSaved: (map: EditableMap) => void; data: MapEditorData;
}) {
  // A new version of the same map is a new document.
  const initial = useMemo(() => parseMapDocument(map.document, map.system_key), [map.id, map.version]);
  const history = useDocumentHistory(initial.document);
  const { document, commit } = history;
  const [name, setName] = useState(map.name);
  const [shared, setShared] = useState(map.shared_with_players);
  const [tool, setTool] = useState<Tool>("select");
  const [houseShape, setHouseShape] = useState<"rect" | "polygon">("rect");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [corridorWidth, setCorridorWidth] = useState(500);
  const [roomVertex, setRoomVertex] = useState(0);
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [rect, setRectState] = useState<Rect | null>(null);
  // Pointer events can arrive faster than React re-renders; read the live rectangle from a ref.
  const rectRef = useRef<Rect | null>(null);
  const setRect = (next: Rect | null) => { rectRef.current = next; setRectState(next); };
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>(ALL_LAYERS);
  const [snapGrid, setSnapGrid] = useState(false);
  const [previewPlayers, setPreviewPlayers] = useState(false);
  const [previewViewer, setPreviewViewer] = useState<string>("all");
  const [sheets, setSheets] = useState<SheetOption[]>([]);
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState(initial.error);
  const drag = useRef<Drag | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const kit = kitForSystem(document?.system_key ?? map.system_key);
  const [wallMaterial, setWallMaterial] = useState(kit.walls[0].id);
  const [wallThickness, setWallThickness] = useState(kit.walls[0].thickness);
  const [floorMaterial, setFloorMaterial] = useState(kit.houseFloor);
  const [doorStyle, setDoorStyle] = useState(kit.doors[0].id);
  const [propKind, setPropKind] = useState(kit.props[0].id);
  const [shadowOpacity, setShadowOpacity] = useState(0.55);
  const [shadowGmOnly, setShadowGmOnly] = useState(false);
  const [fogMode, setFogMode] = useState<"reveal" | "hide">("reveal");
  const [fogTarget, setFogTarget] = useState<string>("all");

  useEffect(() => {
    history.reset(initial.document); setName(map.name); setShared(map.shared_with_players);
    setSelectedId(null); setDraftPoints([]); setRect(null); setPinDraft(null); setMessage(initial.error);
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
  const players = useMemo(() => fogPlayers(sheets), [sheets]);
  const preview = useMemo(() => {
    if (!previewPlayers || !document) return null;
    const player = players.find((item) => item.id === previewViewer);
    const viewer = { userId: player?.id ?? null, ownSheetIds: player?.sheetIds ?? new Set<string>() };
    const shown = redactForViewer(document, viewer);
    return { shown, vision: viewerMasks(shown, viewer) };
  }, [previewPlayers, previewViewer, document, players]);
  const signedUrls = usePortraitUrls(data.portraitUrls ? [] : sheets.map((sheet) => sheet.portrait_path));
  const portraitUrls = data.portraitUrls ?? signedUrls;

  function undo() {
    if (history.undo()) setSelectedId(null);
  }

  function addStructures(...structures: MapStructure[]) {
    if (document) commit({ ...document, structures: [...document.structures, ...structures] });
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
      addStructures({ id: newMapId(), type: "wall", points: draftPoints, material: wallMaterial, thickness: wallThickness });
      setMessage("Muro criado.");
    } else if (tool === "shadow" && draftPoints.length >= 3) {
      addStructures({ id: newMapId(), type: "shadow", points: draftPoints, opacity: shadowOpacity, ...(shadowGmOnly ? { gm_only: true } : {}) });
      setMessage("Sombra criada.");
    } else if (tool === "house" && draftPoints.length >= 3) {
      addStructures(...houseStructures(draftPoints, wallMaterial, floorMaterial, wallThickness));
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

  function pointerDown(document: MapDocumentV2, event: CanvasPointer) {
    const point = event.point;
    switch (tool) {
      case "select": {
        const id = hitTest(document, point, kit);
        const chosen = (event.shift || multiSelectMode) && id ? [...new Set([...selectedIds, id])] : id && selectedIds.includes(id) ? selectedIds : id ? [id] : [];
        setSelectedIds(chosen); setSelectedId(id);
        drag.current = id ? { id, from: point, base: document, moved: false } : null;
        return;
      }
      case "wall": case "shadow": addPoint(snap(point, event.shift)); return;
      case "house":
        if (houseShape === "rect") { const start = snapGrid ? snapToGrid(point, document.grid.size) : point; setRect({ from: start, to: start }); }
        else addPoint(snap(point, event.shift));
        return;
      case "door": {
        const wall = nearestWall(document, point);
        if (!wall) { setMessage("Clique mais perto de um muro para colocar a porta."); return; }
        const door: MapStructure = { id: newMapId(), type: "door", wall_id: wall.id, at: Number(wall.at.toFixed(4)), width: 320, style: doorStyle, state: "closed" };
        addStructures(door);
        setSelectedId(door.id);
        setMessage("Porta encaixada no muro. Ajuste o estado no painel ao lado.");
        return;
      }
      case "prop": {
        const prop: MapStructure = { id: newMapId(), type: "prop", kind: propKind, x: Math.round(point[0]), y: Math.round(point[1]), rotation: 0, scale: 1 };
        addStructures(prop);
        setSelectedId(prop.id);
        return;
      }
      case "fog":
        setRect({ from: point, to: point });
        return;
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

  function pointerMove(document: MapDocumentV2, event: CanvasPointer) {
    const point = event.point;
    if (drag.current) {
      const current = drag.current;
      const dx = Math.round(point[0] - current.from[0]);
      const dy = Math.round(point[1] - current.from[1]);
      if (!current.moved && Math.hypot(dx, dy) < 20) return;
      current.moved = true;
      history.preview(chosenMove(current.base, selectedIds, current.id, dx, dy, point));
      return;
    }
    if (rectRef.current) { setRect({ ...rectRef.current, to: snapGrid && tool !== "fog" ? snapToGrid(point, document.grid.size) : point }); return; }
    if (draftPoints.length) setCursor(snap(point, event.shift));
  }

  function pointerUp(document: MapDocumentV2, point: Point) {
    if (drag.current) {
      if (drag.current.moved) history.settle(drag.current.base);
      drag.current = null;
    }
    const finished = rectRef.current;
    if (!finished) return;
    setRect(null);
    if (tool === "fog") {
      addFogRegion(fogCellRect(finished.from, point, document.grid.size, document.width, document.height));
      return;
    }
    const end = snapGrid ? snapToGrid(point, document.grid.size) : point;
    if (Math.abs(end[0] - finished.from[0]) >= 150 && Math.abs(end[1] - finished.from[1]) >= 150) {
      addStructures(...houseStructures(rectanglePoints(finished.from, end), wallMaterial, floorMaterial, wallThickness));
      setMessage("Casa criada com piso e muros. Use a ferramenta Porta para abrir entradas.");
    }
  }

  function onPointer(event: CanvasPointer) {
    if (!document || previewPlayers) return;
    if (event.kind === "double") { if (tool === "wall" || tool === "shadow" || (tool === "house" && houseShape === "polygon")) finishPolyline(); return; }
    if (event.kind === "down") pointerDown(document, event);
    else if (event.kind === "move") pointerMove(document, event);
    else if (event.kind === "up") pointerUp(document, event.point);
  }

  function removeSelected(id: string) {
    if (!document) return;
    commit(removeElement(document, id));
    setSelectedId(null);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) history.redo(); else undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); history.redo(); return; }
      if (event.key === "Enter" && draftPoints.length) { event.preventDefault(); finishPolyline(); return; }
      if (event.key === "Escape") { setDraftPoints([]); setCursor(null); setRect(null); setSelectedId(null); setPinDraft(null); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && document) {
        event.preventDefault();
        removeSelected(selectedId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function changeTool(next: Tool) {
    setTool(next);
    setDraftPoints([]); setCursor(null); setRect(null);
    if (next !== "select") { setSelectedId(null); setSelectedIds([]); }
    setMessage("");
  }

  function toggleMultiSelect() {
    setMultiSelectMode(!multiSelectMode);
    if (!multiSelectMode) setSelectedIds(selectedId ? [selectedId] : []);
  }

  function updateSelected(patch: Partial<MapStructure>) {
    if (!document || !selectedId) return;
    commit({ ...document, structures: document.structures.map((item) => item.id === selectedId ? { ...item, ...patch } as MapStructure : item) });
  }

  function moveSelectionBy(dx: number, dy: number) {
    if (!document || selectedIds.length === 0) return;
    commit(moveSelection(document, new Set(selectedIds), dx, dy));
  }

  function makeCorridor() {
    if (!document || selectedIds.length < 2) return;
    const first = findRoom(document, selectedIds[0]), second = findRoom(document, selectedIds[1]);
    if (!first || !second) { setMessage("Selecione duas salas pelo piso ou muro."); return; }
    commit(connectRooms(document, first, second, corridorWidth));
    setMessage("Corredor criado, com vãos abertos nas duas paredes.");
  }

  function duplicateRooms() {
    if (!document || !selectedIds.length) return;
    const result = duplicateSelection(document, new Set(selectedIds), 300, 300);
    commit(result.document); setSelectedIds(result.ids); setSelectedId(result.ids[0] ?? null);
  }

  function submitPin(pin: MapPin) {
    if (!document || !pinDraft) return;
    const pins = pinDraft.isNew ? [...document.pins, pin] : document.pins.map((item) => item.id === pin.id ? pin : item);
    commit({ ...document, pins });
    setPinDraft(null);
    setSelectedId(pin.id);
    setMessage(pinDraft.isNew ? "Pin colocado no mapa." : "Pin atualizado.");
  }

  function updateFog(patch: Partial<MapFog>) {
    if (!document) return;
    commit({ ...document, fog: { ...(document.fog ?? EMPTY_FOG), ...patch } });
  }

  function targetLabel(): string {
    return fogTarget === "all" ? "todos os jogadores" : players.find((item) => item.id === fogTarget)?.label ?? "o jogador";
  }

  function addFogRegion(points: Point[]) {
    if (!document) return;
    const fog = document.fog ?? { ...EMPTY_FOG, enabled: true };
    if (fog.regions.length >= MAX_FOG_REGIONS) { setMessage(`A névoa aceita até ${MAX_FOG_REGIONS} regiões. Use "Limpar" ou regiões maiores.`); return; }
    commit({ ...document, fog: { ...fog, regions: [...fog.regions, fogRegion(fogMode, points, fogTarget)] } });
    setMessage(`${fogMode === "reveal" ? "Área revelada" : "Área coberta de névoa"} para ${targetLabel()}.${fog.enabled ? "" : " Ative a névoa para valer na mesa."}`);
  }

  function clearTargetRegions() {
    if (!document?.fog) return;
    updateFog({ regions: document.fog.regions.filter((region) => !regionTargets(region, fogTarget)) });
    setMessage("Regiões de névoa deste alvo removidas.");
  }

  function fillTarget(mode: "reveal" | "hide") {
    if (!document) return;
    const fog = document.fog ?? { ...EMPTY_FOG, enabled: true };
    // A whole-map region overrides everything before it for this target, so those can go.
    commit({ ...document, fog: { ...fog, regions: [...fog.regions.filter((item) => !regionTargets(item, fogTarget)), fogRegion(mode, wholeMap(document), fogTarget)] } });
    setMessage(mode === "reveal" ? "Mapa inteiro revelado para o alvo." : "Mapa inteiro coberto de névoa para o alvo.");
  }

  /** Rasteriza o SVG do palco no tamanho do VTT e entrega o arquivo montado por `build`. */
  async function exportFile(fallback: string, build: (png: Blob, document: MapDocumentV2) => Promise<{ filename: string; blob: Blob; done: string }>) {
    const svg = stageRef.current?.querySelector("svg");
    if (!svg || !document || exporting) return;
    setExporting(true);
    try {
      const size = vttImageSize(document);
      const png = await rasterizeMapSvg(svg, document.width, document.height, size.width, size.height);
      const file = await build(png, document);
      downloadBlob(file.filename, file.blob);
      setMessage(file.done);
    } catch (problem) {
      setMessage(problem instanceof Error ? problem.message : fallback);
    } finally { setExporting(false); }
  }

  const exportPng = () => exportFile("Não foi possível exportar o PNG.", async (png) => ({ filename: `${mapFilePart(name)}.png`, blob: png, done: "PNG do mapa salvo." }));

  const exportVtt = () => exportFile("Não foi possível exportar o Universal VTT.", async (png, current) => {
    const vtt = buildUniversalVtt(current, await blobToBase64(png));
    return {
      filename: `${mapFilePart(name)}.dd2vtt`,
      blob: new Blob([JSON.stringify(vtt)], { type: "application/json" }),
      done: `Universal VTT salvo: ${vtt.line_of_sight.length} trechos de muro e ${vtt.portals.length} portas.`,
    };
  });

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
      history.setDirty(false);
      setMessage(shared ? "Mapa salvo e visível para os jogadores." : "Mapa salvo.");
      onSaved(saved);
    } catch (problemError) {
      setMessage(problemError instanceof Error ? problemError.message : "Não foi possível salvar o mapa.");
    } finally { setSaving(false); }
  }

  const draft: CanvasDraft = rect ? { type: "rect", from: rect.from, to: rect.to }
    : draftPoints.length ? { type: "polyline", points: draftPoints, cursor, closed: tool !== "wall" } : null;

  return {
    initialError: initial.error, document, kit, history, commit, undo, redo: history.redo, stageRef, message, draft,
    map: {
      name, setName: (value: string) => { setName(value); history.setDirty(true); },
      shared, setShared: (value: boolean) => { setShared(value); history.setDirty(true); },
      saving, save, exporting, exportPng, exportVtt,
    },
    tool, changeTool, houseShape, setHouseShape, draftPoints, setDraftPoints, finishPolyline, onPointer,
    selection: {
      selectedId, setSelectedId, selectedIds, multiSelectMode, toggleMultiSelect, roomVertex, setRoomVertex, corridorWidth, setCorridorWidth,
      updateSelected, removeSelected, moveSelectionBy, makeCorridor, duplicateRooms,
    },
    options: {
      wallMaterial, setWallMaterial, wallThickness, setWallThickness, floorMaterial, setFloorMaterial, doorStyle, setDoorStyle,
      propKind, setPropKind, shadowOpacity, setShadowOpacity, shadowGmOnly, setShadowGmOnly,
    },
    fog: { mode: fogMode, setMode: setFogMode, target: fogTarget, setTarget: setFogTarget, update: updateFog, clearTarget: clearTargetRegions, fillTarget },
    view: { layers, setLayers, snapGrid, setSnapGrid, previewPlayers, setPreviewPlayers, previewViewer, setPreviewViewer, preview },
    pins: { pinDraft, setPinDraft, submitPin, createEntity, sheets, entities, portraitUrls, portraitPaths },
    players,
  };
}

export type MapEditorState = ReturnType<typeof useMapEditor>;
