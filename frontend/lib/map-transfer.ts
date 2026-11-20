import { pointAlongPolyline, polylineLength, type Point } from "./map-geometry.ts";
import { parseMapDocument, validateMapDocument, type DoorStructure, type MapDocumentV2 } from "./map-document.ts";
import { doorGap, splitPolylineAtGaps } from "./map-visibility.ts";

/** MAP-10: JSON import (same schema and limits as the editor and the database) and Universal VTT export. */

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const NAME_LIMIT = 160;

export type ImportReferences = {
  sheetIds: ReadonlySet<string>;
  entityIds: ReadonlySet<string>;
  /** Campaign player ids; fog regions aimed at unknown players are dropped. */
  playerIds?: ReadonlySet<string>;
};
export type ImportResult =
  | { ok: true; name: string; system_key: string | null; document: MapDocumentV2; warnings: string[] }
  | { ok: false; error: string };

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Accepts the file written by "Exportar JSON" ({ name, system_key, document })
 * or a bare map document. References that do not exist in the target campaign
 * are removed with a warning instead of failing the save in the database.
 */
export function prepareMapImport(text: string, fallbackName: string, references: ImportReferences): ImportResult {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) return { ok: false, error: "O arquivo passa de 5 MB." };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "O arquivo não é um JSON válido." }; }
  if (!record(raw)) return { ok: false, error: "O JSON não descreve um mapa." };
  const wrapped = record(raw.document);
  const source = wrapped ? raw.document : raw;
  const systemKey = typeof raw.system_key === "string" && /^[a-z0-9-]{1,80}$/.test(raw.system_key) ? raw.system_key
    : record(source) && typeof source.system_key === "string" && /^[a-z0-9-]{1,80}$/.test(source.system_key) ? source.system_key : null;
  const parsed = parseMapDocument(source, systemKey);
  if (!parsed.document) return { ok: false, error: parsed.error };
  const document = parsed.document;
  const warnings: string[] = [];

  const pins = document.pins.filter((pin) => pin.kind !== "character" || (pin.sheet_id !== undefined && references.sheetIds.has(pin.sheet_id)));
  if (pins.length < document.pins.length) warnings.push(`${document.pins.length - pins.length} pin(s) de personagem sem ficha nesta campanha foram removidos.`);
  let clearedEntities = 0;
  const cleanPins = pins.map((pin) => {
    const { portrait_path: _portrait, ...rest } = pin;
    if (rest.entity_id && !references.entityIds.has(rest.entity_id)) { clearedEntities += 1; const { entity_id: _entity, ...withoutEntity } = rest; return withoutEntity; }
    return rest;
  });
  if (clearedEntities) warnings.push(`${clearedEntities} pin(s) perderam o vínculo com entidades de outra campanha.`);

  let fog = document.fog;
  if (fog && references.playerIds) {
    const known = references.playerIds;
    const regions = fog.regions.flatMap((region) => {
      if (region.players === null) return [region];
      const players = region.players.filter((id) => known.has(id));
      return players.length ? [{ ...region, players }] : [];
    });
    if (regions.length < fog.regions.length) warnings.push(`${fog.regions.length - regions.length} região(ões) de névoa de jogadores de outra campanha foram removidas.`);
    fog = { ...fog, regions };
  }

  const result: MapDocumentV2 = { ...document, system_key: document.system_key ?? systemKey, pins: cleanPins, ...(fog ? { fog } : {}) };
  const problem = validateMapDocument(result);
  if (problem) return { ok: false, error: problem };
  const name = (typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallbackName.trim() || "Mapa importado").slice(0, NAME_LIMIT);
  return { ok: true, name, system_key: result.system_key, document: result, warnings };
}

// Universal VTT (.dd2vtt) ---------------------------------------------------

type VttPoint = { x: number; y: number };
export type UniversalVtt = {
  format: number;
  resolution: { map_origin: VttPoint; map_size: VttPoint; pixels_per_grid: number };
  line_of_sight: VttPoint[][];
  objects_line_of_sight: VttPoint[][];
  portals: { position: VttPoint; bounds: [VttPoint, VttPoint]; rotation: number; closed: boolean; freestanding: boolean }[];
  environment: { baked_lighting: boolean; ambient_light: string };
  lights: never[];
  image: string;
};

const MAX_IMAGE_SIDE = 8192;

/** Pixels per grid cell for the exported image, keeping the longest side within 8192 px. */
export function vttPixelsPerGrid(document: Pick<MapDocumentV2, "width" | "height" | "grid">): number {
  const cells = Math.max(document.width, document.height) / document.grid.size;
  return Math.max(10, Math.min(140, Math.floor(MAX_IMAGE_SIDE / Math.max(1, cells))));
}

export function vttImageSize(document: Pick<MapDocumentV2, "width" | "height" | "grid">): { width: number; height: number } {
  const ppg = vttPixelsPerGrid(document);
  return { width: Math.round((document.width / document.grid.size) * ppg), height: Math.round((document.height / document.grid.size) * ppg) };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Walls become line_of_sight polylines (cut where doors sit), doors become
 * portals; coordinates are in grid cells. `imageBase64` is the PNG without
 * the data: prefix.
 */
export function buildUniversalVtt(document: MapDocumentV2, imageBase64: string): UniversalVtt {
  const size = document.grid.size;
  const toGrid = ([x, y]: Point): VttPoint => ({ x: round(x / size), y: round(y / size) });
  const doors = document.structures.filter((item): item is DoorStructure => item.type === "door");
  const lineOfSight: VttPoint[][] = [];
  const portals: UniversalVtt["portals"] = [];
  for (const wall of document.structures) {
    if (wall.type !== "wall") continue;
    const own = doors.filter((door) => door.wall_id === wall.id);
    const gaps = own.map((door) => doorGap(wall.points, door));
    for (const piece of splitPolylineAtGaps(wall.points, gaps)) lineOfSight.push(piece.map(toGrid));
    const total = polylineLength(wall.points);
    for (const door of own) {
      const [start, end] = doorGap(wall.points, door);
      const center = pointAlongPolyline(wall.points, door.at);
      const a = pointAlongPolyline(wall.points, total === 0 ? 0 : start / total).point;
      const b = pointAlongPolyline(wall.points, total === 0 ? 0 : end / total).point;
      portals.push({ position: toGrid(center.point), bounds: [toGrid(a), toGrid(b)], rotation: round(center.angle), closed: door.state !== "open", freestanding: false });
    }
  }
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: round(document.width / size), y: round(document.height / size) }, pixels_per_grid: vttPixelsPerGrid(document) },
    line_of_sight: lineOfSight,
    objects_line_of_sight: [],
    portals,
    environment: { baked_lighting: false, ambient_light: "ffffffff" },
    lights: [],
    image: imageBase64,
  };
}
