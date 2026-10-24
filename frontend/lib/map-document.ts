import { closedOutline, MAP_SIZE, type Point } from "./map-geometry.ts";
import { kitForSystem } from "./map-kits.ts";

/**
 * Map document v2: vector structures and pins in 0..10000 space. The limits
 * here mirror private.validate_map_document so the editor reports problems
 * before Supabase rejects the save.
 */
export const MAX_STRUCTURES = 2000;
export const MAX_PINS = 300;
export const MAX_POINTS = 500;
export const MAP_HEIGHT = 7500;

export type WallStructure = { id: string; type: "wall"; points: Point[]; material: string; thickness: number; gm_only?: boolean };
export type AreaStructure = { id: string; type: "area"; points: Point[]; material: string; label?: string; gm_only?: boolean };
export type DoorStructure = { id: string; type: "door"; wall_id: string; at: number; width: number; style: string; state: "open" | "closed" | "locked"; gm_only?: boolean };
export type ShadowStructure = { id: string; type: "shadow"; points: Point[]; opacity: number; gm_only?: boolean };
export type PropStructure = { id: string; type: "prop"; kind: string; x: number; y: number; rotation: number; scale: number; gm_only?: boolean };
export type MapStructure = WallStructure | AreaStructure | DoorStructure | ShadowStructure | PropStructure;

export type PinKind = "character" | "npc" | "item";
export type PinSize = "small" | "medium" | "large";
export type MapPin = {
  id: string;
  kind: PinKind;
  label: string;
  x: number;
  y: number;
  gm_only: boolean;
  sheet_id?: string;
  entity_id?: string;
  icon?: string;
  ring_color?: string;
  size?: PinSize;
  notes?: string;
  /** Only present in documents returned by get_player_map. */
  portrait_path?: string | null;
};

export type LegacyCell = { x: number; y: number; kind: string };
export type LegacyMarker = { id: string; label: string; x: number; y: number; color: string };
export type LegacyLayer = { width: number; height: number; terrain: LegacyCell[]; markers: LegacyMarker[] };

export type MapDocumentV2 = {
  version: 2;
  system_key: string | null;
  width: number;
  height: number;
  background: string;
  grid: { visible: boolean; size: number };
  structures: MapStructure[];
  pins: MapPin[];
  legacy?: LegacyLayer;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SLUG = /^[a-z_]{1,40}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function inRange(value: unknown, max = MAP_SIZE): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max;
}

export function newMapId(): string {
  return crypto.randomUUID();
}

export function createEmptyDocument(systemKey: string | null): MapDocumentV2 {
  return {
    version: 2,
    system_key: systemKey,
    width: MAP_SIZE,
    height: MAP_HEIGHT,
    background: kitForSystem(systemKey).background,
    grid: { visible: true, size: 250 },
    structures: [],
    pins: [],
  };
}

/** Converts a generated v1 grid map into a read-only legacy background layer. */
function fromLegacy(value: Record<string, unknown>, systemKey: string | null): MapDocumentV2 {
  const document = createEmptyDocument(systemKey);
  const width = Number.isInteger(value.width) ? value.width as number : 0;
  const height = Number.isInteger(value.height) ? value.height as number : 0;
  const layers = Array.isArray(value.layers) ? value.layers : [];
  const terrainLayer = layers.find((layer) => record(layer) && layer.id === "terrain");
  const terrain = record(terrainLayer) && Array.isArray(terrainLayer.cells)
    ? terrainLayer.cells.filter((cell): cell is LegacyCell => record(cell) && Number.isInteger(cell.x) && Number.isInteger(cell.y) && typeof cell.kind === "string")
    : [];
  const markers = Array.isArray(value.markers)
    ? value.markers.filter((marker): marker is LegacyMarker => record(marker) && typeof marker.id === "string" && typeof marker.label === "string" && inRange(marker.x) && inRange(marker.y) && typeof marker.color === "string")
      .map(({ id, label, x, y, color }) => ({ id, label, x, y, color }))
    : [];
  if (width > 0 && height > 0) {
    document.height = Math.round((MAP_SIZE * height) / width);
    if (document.height > MAP_SIZE) document.height = MAP_SIZE;
    document.legacy = { width, height, terrain, markers };
    document.grid = { visible: value.grid_enabled !== false, size: Math.round(MAP_SIZE / width) };
  }
  return document;
}

function points(value: unknown, minimum: number): Point[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_POINTS) return null;
  const result: Point[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2 || !inRange(item[0]) || !inRange(item[1])) return null;
    result.push([item[0], item[1]]);
  }
  return result;
}

function parseStructure(value: unknown): MapStructure | null {
  if (!record(value) || typeof value.id !== "string" || !ID.test(value.id)) return null;
  const gm_only = value.gm_only === true ? { gm_only: true } : {};
  const material = typeof value.material === "string" && SLUG.test(value.material) ? value.material : "";
  switch (value.type) {
    case "wall": {
      const shape = points(value.points, 2);
      if (!shape || !material) return null;
      const thickness = typeof value.thickness === "number" && value.thickness >= 5 && value.thickness <= 300 ? value.thickness : 60;
      return { id: value.id, type: "wall", points: shape, material, thickness, ...gm_only };
    }
    case "area": {
      const shape = points(value.points, 3);
      if (!shape || !material) return null;
      const label = typeof value.label === "string" && value.label.length <= 120 ? { label: value.label } : {};
      return { id: value.id, type: "area", points: shape, material, ...label, ...gm_only };
    }
    case "shadow": {
      const shape = points(value.points, 3);
      if (!shape) return null;
      const opacity = typeof value.opacity === "number" && value.opacity >= 0.05 && value.opacity <= 1 ? value.opacity : 0.55;
      return { id: value.id, type: "shadow", points: shape, opacity, ...gm_only };
    }
    case "door": {
      if (typeof value.wall_id !== "string" || typeof value.at !== "number" || value.at < 0 || value.at > 1) return null;
      if (value.state !== "open" && value.state !== "closed" && value.state !== "locked") return null;
      const width = typeof value.width === "number" && value.width >= 50 && value.width <= 1500 ? value.width : 300;
      const style = typeof value.style === "string" && SLUG.test(value.style) ? value.style : "door";
      return { id: value.id, type: "door", wall_id: value.wall_id, at: value.at, width, style, state: value.state, ...gm_only };
    }
    case "prop": {
      if (typeof value.kind !== "string" || !SLUG.test(value.kind) || !inRange(value.x) || !inRange(value.y)) return null;
      const rotation = typeof value.rotation === "number" && Number.isFinite(value.rotation) ? value.rotation % 360 : 0;
      const scale = typeof value.scale === "number" && value.scale >= 0.25 && value.scale <= 4 ? value.scale : 1;
      return { id: value.id, type: "prop", kind: value.kind, x: value.x, y: value.y, rotation, scale, ...gm_only };
    }
    default:
      return null;
  }
}

function parsePin(value: unknown): MapPin | null {
  if (!record(value) || typeof value.id !== "string" || !ID.test(value.id)) return null;
  if (value.kind !== "character" && value.kind !== "npc" && value.kind !== "item") return null;
  if (typeof value.label !== "string" || value.label.length > 120 || !inRange(value.x) || !inRange(value.y)) return null;
  if (value.kind === "character" && typeof value.sheet_id !== "string") return null;
  const pin: MapPin = { id: value.id, kind: value.kind, label: value.label, x: value.x, y: value.y, gm_only: value.gm_only === true };
  if (typeof value.sheet_id === "string") pin.sheet_id = value.sheet_id;
  if (typeof value.entity_id === "string") pin.entity_id = value.entity_id;
  if (typeof value.icon === "string" && SLUG.test(value.icon)) pin.icon = value.icon;
  if (typeof value.ring_color === "string" && HEX.test(value.ring_color)) pin.ring_color = value.ring_color;
  if (value.size === "small" || value.size === "medium" || value.size === "large") pin.size = value.size;
  if (typeof value.notes === "string" && value.notes.length <= 2000) pin.notes = value.notes;
  if (typeof value.portrait_path === "string" || value.portrait_path === null) pin.portrait_path = value.portrait_path;
  return pin;
}

/** Accepts v2 documents and converts generated v1 maps; never throws. */
export function parseMapDocument(value: unknown, systemKey: string | null = null): { document: MapDocumentV2 | null; error: string } {
  if (!record(value)) return { document: null, error: "O documento do mapa não tem um formato reconhecido." };
  if (value.version !== 2) return { document: fromLegacy(value, systemKey), error: "" };
  if (!Array.isArray(value.structures) || !Array.isArray(value.pins)) return { document: null, error: "O mapa não tem listas de estruturas e pins." };
  const structures: MapStructure[] = [];
  for (const item of value.structures) {
    const parsed = parseStructure(item);
    if (!parsed) return { document: null, error: "Uma estrutura do mapa está fora do formato aceito." };
    structures.push(parsed);
  }
  const pins: MapPin[] = [];
  for (const item of value.pins) {
    const parsed = parsePin(item);
    if (!parsed) return { document: null, error: "Um pin do mapa está fora do formato aceito." };
    pins.push(parsed);
  }
  const base = createEmptyDocument(typeof value.system_key === "string" ? value.system_key : systemKey);
  const grid = record(value.grid) ? value.grid : {};
  const legacy = record(value.legacy) && Number.isInteger(value.legacy.width) && Number.isInteger(value.legacy.height)
    ? fromLegacy({ width: value.legacy.width, height: value.legacy.height, layers: [{ id: "terrain", cells: value.legacy.terrain }], markers: value.legacy.markers }, base.system_key).legacy
    : undefined;
  return {
    document: {
      ...base,
      height: inRange(value.height) && (value.height as number) >= 1000 ? value.height as number : base.height,
      background: typeof value.background === "string" && SLUG.test(value.background) ? value.background : base.background,
      grid: { visible: grid.visible !== false, size: typeof grid.size === "number" && grid.size >= 50 && grid.size <= 2000 ? grid.size : base.grid.size },
      structures,
      pins,
      ...(legacy ? { legacy } : {}),
    },
    error: "",
  };
}

/** Same rules the database enforces; returns a message or an empty string. */
export function validateMapDocument(document: MapDocumentV2): string {
  if (document.structures.length > MAX_STRUCTURES) return `O mapa aceita até ${MAX_STRUCTURES} estruturas.`;
  if (document.pins.length > MAX_PINS) return `O mapa aceita até ${MAX_PINS} pins.`;
  const ids = new Set<string>();
  for (const item of [...document.structures, ...document.pins]) {
    if (ids.has(item.id)) return "Há dois elementos com o mesmo identificador.";
    ids.add(item.id);
  }
  const walls = new Set(document.structures.filter((item) => item.type === "wall").map((item) => item.id));
  for (const item of document.structures) {
    if (!parseStructure(item)) return "Uma estrutura do mapa está fora do formato aceito.";
    if (item.type === "door" && !walls.has(item.wall_id)) return "Uma porta não está presa a nenhum muro.";
  }
  for (const pin of document.pins) {
    if (!parsePin(pin)) return "Um pin do mapa está fora do formato aceito.";
    if (!pin.label.trim()) return "Todo pin precisa de um nome.";
  }
  return "";
}

/** Client-side mirror of private.redact_map_document, for "ver como jogador". */
export function redactForPlayers(document: MapDocumentV2): MapDocumentV2 {
  const structures = document.structures.filter((item) => !item.gm_only);
  const wallIds = new Set(structures.filter((item) => item.type === "wall").map((item) => item.id));
  return {
    ...document,
    structures: structures.filter((item) => item.type !== "door" || wallIds.has(item.wall_id)),
    pins: document.pins.filter((pin) => !pin.gm_only).map(({ notes: _notes, ...pin }) => pin),
    ...(document.legacy ? { legacy: { ...document.legacy, markers: [] } } : {}),
  };
}

/** A house: a floor area plus a closed wall outline around it. */
export function houseStructures(polygon: Point[], wallMaterial: string, floorMaterial: string, thickness: number): [AreaStructure, WallStructure] {
  return [
    { id: newMapId(), type: "area", points: polygon, material: floorMaterial },
    { id: newMapId(), type: "wall", points: closedOutline(polygon), material: wallMaterial, thickness },
  ];
}

/** Removes a structure and anything that depends on it (doors on a deleted wall). */
export function removeElement(document: MapDocumentV2, id: string): MapDocumentV2 {
  return {
    ...document,
    structures: document.structures.filter((item) => item.id !== id && !(item.type === "door" && item.wall_id === id)),
    pins: document.pins.filter((pin) => pin.id !== id),
  };
}
