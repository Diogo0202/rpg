/** Ferramentas, seleção por clique e regras de névoa do editor de mapas. Sem React. */

import { newMapId, type FogRegion, type MapDocumentV2, type MapFog, type MapStructure } from "../../lib/map-document";
import { distance, nearestOnPolyline, pointAlongPolyline, pointInPolygon, translatePoints, type Point } from "../../lib/map-geometry";
import { findProp, type MapKit } from "../../lib/map-kits";
import { moveSelection } from "../../lib/map-editing";
import { PIN_RADIUS } from "./map-canvas";
import type { SheetOption } from "./pin-creator";

export type Tool = "select" | "pan" | "wall" | "house" | "door" | "shadow" | "prop" | "pin" | "fog" | "erase";

export const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Selecionar", hint: "Clique para escolher, arraste para mover. Delete apaga." },
  { id: "pan", label: "Mover vista", hint: "Arraste para navegar. Use a roda do mouse ou dois dedos para zoom." },
  { id: "wall", label: "Muro", hint: "Clique para cada canto. Duplo clique ou Enter termina; Shift trava o ângulo em 15°." },
  { id: "house", label: "Casa", hint: "Arraste um retângulo (ou clique os cantos no modo polígono). Cria piso e muros fechados." },
  { id: "door", label: "Porta", hint: "Clique sobre um muro: a porta encaixa no ponto mais próximo." },
  { id: "shadow", label: "Sombra", hint: "Clique os cantos da área escura. Duplo clique ou Enter termina." },
  { id: "prop", label: "Objeto", hint: "Escolha um objeto do kit e clique onde colocá-lo." },
  { id: "pin", label: "Pin", hint: "Clique no mapa para criar um pin de personagem, NPC ou item." },
  { id: "fog", label: "Névoa", hint: "Clique numa célula ou arraste um retângulo para revelar ou ocultar, para todos ou para um jogador." },
  { id: "erase", label: "Borracha", hint: "Clique em qualquer elemento para removê-lo." },
];

export const SYSTEMS = [
  { id: "one-ring", label: "O Um Anel (medieval)" },
  { id: "vampire-v5", label: "Vampiro V5 (cidade moderna)" },
  { id: "vampire-v3", label: "Vampiro V3 (cidade moderna)" },
  { id: "hunter", label: "Caçador (cidade moderna)" },
  { id: "shadow-demon-lord", label: "Shadow of the Demon Lord (medieval)" },
];

export const HISTORY_LIMIT = 100;
export const SNAP_RADIUS = 140;
export const EMPTY_FOG: MapFog = { enabled: false, line_of_sight: false, regions: [] };
const HIT_RADIUS = 160;
const DOOR_REACH = 220;

export function mapFilePart(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mapa";
}

/** O elemento sob o ponto, na ordem em que aparece por cima: pins, objetos, portas, muros e áreas. */
export function hitTest(document: MapDocumentV2, point: Point, kit: MapKit): string | null {
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

/** Ponto do muro mais próximo do clique, dentro do alcance de uma porta. */
export function nearestWall(document: MapDocumentV2, point: Point): { id: string; at: number } | null {
  let best: { id: string; at: number; distance: number } | null = null;
  for (const item of document.structures) {
    if (item.type !== "wall") continue;
    const hit = nearestOnPolyline(point, item.points);
    if (hit.distance <= item.thickness / 2 + DOOR_REACH && (!best || hit.distance < best.distance)) best = { id: item.id, at: hit.at, distance: hit.distance };
  }
  return best && { id: best.id, at: best.at };
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

/** Uma porta sozinha desliza pelo muro; qualquer outra seleção anda junto. */
export function chosenMove(document: MapDocumentV2, ids: string[], activeId: string, dx: number, dy: number, point: Point): MapDocumentV2 {
  const active = document.structures.find((item) => item.id === activeId);
  if (active?.type === "door" && ids.length === 1) return moveElement(document, activeId, dx, dy, point);
  return moveSelection(document, new Set(ids.length ? ids : [activeId]), dx, dy);
}

export type FogPlayer = { id: string; label: string; sheetIds: Set<string> };

/** Um alvo de névoa por dono de ficha, rotulado pelas fichas dele. */
export function fogPlayers(sheets: SheetOption[]): FogPlayer[] {
  const byOwner = new Map<string, string[]>();
  for (const sheet of sheets) if (sheet.owner_id) byOwner.set(sheet.owner_id, [...(byOwner.get(sheet.owner_id) ?? []), sheet.name]);
  return [...byOwner].map(([id, names]) => ({ id, label: names.join(", "), sheetIds: new Set(sheets.filter((sheet) => sheet.owner_id === id).map((sheet) => sheet.id)) }));
}

/** `all` alcança só regiões de todos; um jogador, só as regiões que citam ele. */
export function regionTargets(region: FogRegion, target: string): boolean {
  return target === "all" ? region.players === null : region.players !== null && region.players.includes(target);
}

export function fogRegion(mode: FogRegion["mode"], points: Point[], target: string): FogRegion {
  return { id: newMapId(), mode, points, players: target === "all" ? null : [target] };
}

export function wholeMap(document: MapDocumentV2): Point[] {
  return [[0, 0], [document.width, 0], [document.width, document.height], [0, document.height]];
}

export function structureTitle(selected: MapStructure, kit: MapKit): string {
  if (selected.type === "wall") return "Muro";
  if (selected.type === "area") return "Área / piso";
  if (selected.type === "door") return "Porta";
  if (selected.type === "shadow") return "Sombra";
  return findProp(kit, selected.kind)?.label ?? "Objeto";
}
