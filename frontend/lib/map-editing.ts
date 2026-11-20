import { closedOutline, type Point } from "./map-geometry.ts";
import { newMapId, type MapDocumentV2, type MapStructure, type WallStructure } from "./map-document.ts";

export type Room = { areaId: string; wallId: string; doorIds: string[] };

function sameShape(area: Point[], wall: Point[]): boolean {
  const outline = closedOutline(area);
  return outline.length === wall.length && outline.every((point, index) => point[0] === wall[index][0] && point[1] === wall[index][1]);
}

/** Rooms created by the editor are recognized by their coincident floor and wall outline. */
export function findRoom(document: MapDocumentV2, structureId: string): Room | null {
  const candidate = document.structures.find((item) => item.id === structureId);
  if (!candidate || (candidate.type !== "area" && candidate.type !== "wall")) return null;
  const area = candidate.type === "area" ? candidate : document.structures.find((item) => item.type === "area" && sameShape(item.points, candidate.points));
  const wall = candidate.type === "wall" ? candidate : document.structures.find((item) => item.type === "wall" && sameShape(candidate.points, item.points));
  if (!area || area.type !== "area" || !wall || wall.type !== "wall") return null;
  return { areaId: area.id, wallId: wall.id, doorIds: document.structures.filter((item) => item.type === "door" && item.wall_id === wall.id).map((item) => item.id) };
}

export function editRoomVertex(document: MapDocumentV2, room: Room, index: number, point: Point): MapDocumentV2 {
  const area = document.structures.find((item) => item.id === room.areaId);
  const wall = document.structures.find((item) => item.id === room.wallId);
  if (area?.type !== "area" || wall?.type !== "wall" || index >= area.points.length) return document;
  const points = area.points.map((value, i) => i === index ? point : value);
  const outline = closedOutline(points);
  return { ...document, structures: document.structures.map((item) => item.id === room.areaId ? { ...item, points } : item.id === room.wallId ? { ...item, points: outline } : item) };
}

export function moveSelection(document: MapDocumentV2, ids: Set<string>, dx: number, dy: number): MapDocumentV2 {
  const expanded = new Set(ids);
  for (const id of ids) { const room = findRoom(document, id); if (room) [room.areaId, room.wallId, ...room.doorIds].forEach((child) => expanded.add(child)); }
  const walls = new Map(document.structures.filter((item): item is WallStructure => item.type === "wall").map((item) => [item.id, item]));
  return { ...document,
    structures: document.structures.map((item): MapStructure => {
      if (!expanded.has(item.id)) return item;
      if (item.type === "prop") return { ...item, x: Math.max(0, Math.min(10000, item.x + dx)), y: Math.max(0, Math.min(document.height, item.y + dy)) };
      if (item.type === "door") return expanded.has(item.wall_id) ? item : item;
      return { ...item, points: item.points.map(([x, y]) => [Math.max(0, Math.min(10000, x + dx)), Math.max(0, Math.min(document.height, y + dy))] as Point) };
    }),
    pins: document.pins.map((pin) => expanded.has(pin.id) ? { ...pin, x: Math.max(0, Math.min(10000, pin.x + dx)), y: Math.max(0, Math.min(document.height, pin.y + dy)) } : pin),
  };
}

export function duplicateSelection(document: MapDocumentV2, ids: Set<string>, dx: number, dy: number): { document: MapDocumentV2; ids: string[] } {
  const selected = new Set(ids);
  for (const id of ids) { const room = findRoom(document, id); if (room) [room.areaId, room.wallId, ...room.doorIds].forEach((child) => selected.add(child)); }
  const idMap = new Map([...selected].map((id) => [id, newMapId()]));
  const structures = document.structures.filter((item) => selected.has(item.id)).map((item): MapStructure => {
    const id = idMap.get(item.id)!;
    if (item.type === "prop") return { ...item, id, x: Math.max(0, Math.min(10000, item.x + dx)), y: Math.max(0, Math.min(document.height, item.y + dy)) };
    if (item.type === "door") return { ...item, id, wall_id: idMap.get(item.wall_id) ?? item.wall_id };
    return { ...item, id, points: item.points.map(([x, y]) => [Math.max(0, Math.min(10000, x + dx)), Math.max(0, Math.min(document.height, y + dy))] as Point) };
  });
  return { document: { ...document, structures: [...document.structures, ...structures] }, ids: structures.map((item) => item.id) };
}

/** Makes a floor strip with open door gaps in the nearest walls at both ends. */
export function connectRooms(document: MapDocumentV2, first: Room, second: Room, width: number): MapDocumentV2 {
  const areas = [first, second].map((room) => document.structures.find((item) => item.id === room.areaId));
  if (areas.some((area) => area?.type !== "area")) return document;
  const centers = areas.map((area) => {
    const points = (area as Extract<MapStructure, { type: "area" }>).points;
    return [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length] as Point;
  });
  const [a, b] = centers;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < width) return document;
  const nx = -(b[1] - a[1]) / length * width / 2, ny = (b[0] - a[0]) / length * width / 2;
  const area = { id: newMapId(), type: "area" as const, points: [[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]] as Point[], material: "stone" };
  const doors: MapStructure[] = [first, second].map((room, index) => {
    const wall = document.structures.find((item) => item.id === room.wallId) as WallStructure;
    const hit = nearestOnWall(wall.points, centers[index]);
    return { id: newMapId(), type: "door", wall_id: wall.id, at: hit.at, width: Math.min(1500, Math.max(50, width)), style: "door", state: "open" };
  });
  return { ...document, structures: [...document.structures, area, ...doors] };
}

function nearestOnWall(points: Point[], point: Point): { at: number } {
  let best = { at: 0, distance: Infinity }, total = 0;
  const lengths = points.slice(1).map((p, i) => Math.hypot(p[0]-points[i][0], p[1]-points[i][1]));
  const full = lengths.reduce((sum, value) => sum + value, 0);
  for (let i=0;i<lengths.length;i++) { const [x1,y1]=points[i], [x2,y2]=points[i+1], dx=x2-x1,dy=y2-y1; const t=Math.max(0,Math.min(1,((point[0]-x1)*dx+(point[1]-y1)*dy)/(lengths[i]**2||1))); const d=Math.hypot(point[0]-x1-t*dx,point[1]-y1-t*dy); if(d<best.distance)best={at:(total+t*lengths[i])/(full||1),distance:d}; total+=lengths[i]; }
  return best;
}
