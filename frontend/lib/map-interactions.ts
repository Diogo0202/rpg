import type { MapDocumentV2 } from "./map-document.ts";
import { pointAlongPolyline, type Point } from "./map-geometry.ts";
import { findProp, kitForSystem } from "./map-kits.ts";

export type MapObjectKind = "door" | "container" | "clue" | "passage";
export type MapObjectItem = { id: string; name: string; quantity: number; category?: string };
export type MapObjectConfig = {
  kind: MapObjectKind; label: string; reach_cells: number; interaction_radius?: number;
  clue_text?: string; items?: MapObjectItem[]; target_map_id?: string; target_x?: number; target_y?: number;
};
export type MapObject = MapObjectConfig & { id: string; element_id: string; map_id?: string };
export type MapAction = {
  id: string; object_id: string; sheet_id: string; action: string; status: string;
  item_id?: string; quantity?: number; note?: string; result?: Record<string, unknown>; created_at?: string;
};
export type MapRpc = (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export const MAP_ACTION_LABELS: Record<string, string> = {
  open: "Pedir abertura", close: "Pedir fechamento", examine: "Pedir exame", take: "Pedir retirada", travel: "Pedir passagem",
};
export const MAP_OBJECT_LABELS: Record<MapObjectKind, string> = { door: "Porta", container: "Recipiente", clue: "Pista", passage: "Passagem" };

export function mapObjectActions(kind: MapObjectKind): string[] {
  return kind === "door" ? ["open", "close"] : kind === "container" ? ["examine", "take"] : kind === "clue" ? ["examine"] : ["travel"];
}

/** Secrets are never inferred from a map document; only the authorized RPC supplies them. */
export function mapObjectsFrom(value: unknown): MapObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === "object" && typeof row.id === "string" && typeof row.element_id === "string")
    .map((row) => ({ ...row, ...(row.config && typeof row.config === "object" ? row.config : {}) }))
    .filter((row) => Object.hasOwn(MAP_OBJECT_LABELS, row.kind));
}

export function mapActionsFrom(value: unknown): MapAction[] {
  return Array.isArray(value) ? value.filter((row) => row && typeof row.id === "string" && typeof row.status === "string") : [];
}

export function mapObjectFootprint(document: MapDocumentV2, elementId: string): { point: Point; radius: number } | null {
  const element = document.structures.find((item) => item.id === elementId);
  if (element?.type === "prop") return { point: [element.x, element.y], radius: (findProp(kitForSystem(document.system_key), element.kind)?.size ?? 200) * element.scale / 2 };
  if (element?.type === "door") {
    const wall = document.structures.find((item) => item.id === element.wall_id);
    if (wall?.type === "wall") return { point: pointAlongPolyline(wall.points, element.at).point, radius: element.width / 2 };
  }
  return null;
}

export function validateMapObjectConfig(config: MapObjectConfig): string {
  if (!config.label.trim() || config.label.length > 120) return "Dê ao objeto um nome de até 120 caracteres.";
  if (!Number.isFinite(config.reach_cells) || config.reach_cells < 0 || config.reach_cells > 20) return "O alcance deve ficar entre 0 e 20 células.";
  if (config.kind === "clue" && (!config.clue_text?.trim() || config.clue_text.length > 5000)) return "Escreva a pista com até 5000 caracteres.";
  if (config.kind === "container") {
    const items = config.items ?? [];
    if (items.length > 100 || new Set(items.map((item) => item.id)).size !== items.length) return "O recipiente aceita até 100 itens distintos.";
    if (items.some((item) => !item.id || !item.name.trim() || item.name.length > 160 || !Number.isSafeInteger(item.quantity) || item.quantity < 0 || item.quantity > 100000)) return "Confira os nomes e as quantidades dos itens.";
  }
  if (config.kind === "passage" && (!config.target_map_id || !Number.isFinite(config.target_x) || !Number.isFinite(config.target_y) || config.target_x! < 0 || config.target_y! < 0 || config.target_x! > 10000 || config.target_y! > 10000)) return "Escolha o mapa de destino e um ponto de chegada válido.";
  return "";
}

/** Only approved examinations reveal a container's contents to the requester. */
export function examinedItems(actions: MapAction[], objectId: string, sheetId: string): MapObjectItem[] {
  const approved = actions.filter((action) => action.object_id === objectId && action.sheet_id === sheetId && action.action === "examine" && action.status === "approved");
  const latest = [...approved].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
  const items = latest?.result?.items;
  return Array.isArray(items) ? items.filter((item): item is MapObjectItem => item && typeof item.id === "string" && typeof item.name === "string" && Number.isSafeInteger(item.quantity)) : [];
}
