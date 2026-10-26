import { distance, pointAlongPolyline, pointInPolygon, polylineLength, type Point } from "./map-geometry.ts";
import { redactForPlayers, type DoorStructure, type FogRegion, type MapDocumentV2, type MapPin, type MapStructure } from "./map-document.ts";

/**
 * Fog of war (MAP-05) and line of sight (MAP-08) as pure functions. The
 * database applies the same rules in private.redact_map_document(jsonb, uuid),
 * so the narrator's "ver como jogador" preview matches what get_player_map
 * returns, and the player view masks what it draws from the redacted copy.
 */

export type Segment = [Point, Point];
export type Viewer = { userId: string | null; ownSheetIds: ReadonlySet<string> };

/** Spacing (map units) and cap used to sample walls and outlines against fog. */
export const FOG_SAMPLE_SPACING = 250;
export const FOG_SAMPLE_CAP = 16;

// Fog ---------------------------------------------------------------------

export function fogRegionsFor(regions: readonly FogRegion[], userId: string | null): FogRegion[] {
  return regions.filter((region) => region.players === null || (userId !== null && region.players.includes(userId)));
}

/** The last region containing the point decides; uncovered points stay hidden. */
export function pointRevealed(regions: readonly FogRegion[], point: Point): boolean {
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    if (pointInPolygon(point, regions[index].points)) return regions[index].mode === "reveal";
  }
  return false;
}

/** Vertices plus evenly spaced points along each segment (closed shapes include the closing edge). */
export function samplePolyline(points: readonly Point[], closed: boolean): Point[] {
  const samples: Point[] = [];
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const steps = Math.min(FOG_SAMPLE_CAP, Math.max(1, Math.ceil(distance(a, b) / FOG_SAMPLE_SPACING)));
    for (let step = 0; step <= steps; step += 1) samples.push([a[0] + ((b[0] - a[0]) * step) / steps, a[1] + ((b[1] - a[1]) * step) / steps]);
  }
  if (points.length === 1) samples.push(points[0]);
  return samples;
}

export function segmentsIntersect([a, b]: Segment, [c, d]: Segment): boolean {
  const orient = (p: Point, q: Point, r: Point) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const onSegment = (p: Point, q: Point, r: Point) => Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, c, b)) || (o2 === 0 && onSegment(a, d, b)) || (o3 === 0 && onSegment(c, a, d)) || (o4 === 0 && onSegment(c, b, d));
}

function edges(points: readonly Point[]): Segment[] {
  return points.map((point, index) => [point, points[(index + 1) % points.length]] as Segment);
}

export function polygonsOverlap(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.some((point) => pointInPolygon(point, b as Point[])) || b.some((point) => pointInPolygon(point, a as Point[]))) return true;
  const edgesB = edges(b);
  return edges(a).some((edge) => edgesB.some((other) => segmentsIntersect(edge, other)));
}

export function structureRevealed(item: MapStructure, regions: readonly FogRegion[]): boolean {
  if (item.type === "prop") return pointRevealed(regions, [item.x, item.y]);
  if (item.type === "door") return false; // decided by its wall
  const closed = item.type !== "wall";
  if (samplePolyline(item.points, closed).some((point) => pointRevealed(regions, point))) return true;
  // A reveal overlapping the shape counts unless a later hide covers the whole shape.
  return closed && regions.some((region, index) => region.mode === "reveal" && polygonsOverlap(region.points, item.points)
    && !regions.slice(index + 1).some((later) => later.mode === "hide" && item.points.every((point) => pointInPolygon(point, later.points))));
}

/** Grid-aligned rectangle covering both corners; a click (same cell) gives one cell. */
export function fogCellRect(a: Point, b: Point, size: number, width: number, height: number): Point[] {
  const cell = Math.max(1, size);
  const left = Math.max(0, Math.floor(Math.min(a[0], b[0]) / cell) * cell);
  const top = Math.max(0, Math.floor(Math.min(a[1], b[1]) / cell) * cell);
  const right = Math.min(width, Math.max(left + cell, Math.ceil(Math.max(a[0], b[0]) / cell) * cell));
  const bottom = Math.min(height, Math.max(top + cell, Math.ceil(Math.max(a[1], b[1]) / cell) * cell));
  return [[left, top], [right, top], [right, bottom], [left, bottom]];
}

// Walls, doors and sight --------------------------------------------------

function pointAtLength(points: readonly Point[], length: number): Point {
  const total = polylineLength(points as Point[]);
  return pointAlongPolyline(points as Point[], total === 0 ? 0 : length / total).point;
}

/** Length interval a door occupies on its wall. */
export function doorGap(wall: readonly Point[], door: Pick<DoorStructure, "at" | "width">): [number, number] {
  const total = polylineLength(wall as Point[]);
  const center = door.at * total;
  return [Math.max(0, center - door.width / 2), Math.min(total, center + door.width / 2)];
}

/** Splits a wall polyline into the solid pieces left after removing gaps (in length units). */
export function splitPolylineAtGaps(points: readonly Point[], gaps: readonly [number, number][]): Point[][] {
  const total = polylineLength(points as Point[]);
  const merged: [number, number][] = [];
  for (const [start, end] of [...gaps].filter(([start, end]) => end > start).sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const solid: [number, number][] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) solid.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < total) solid.push([cursor, total]);
  const cumulative: number[] = [0];
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]));
  return solid.filter(([start, end]) => end - start > 1e-6).map(([start, end]) => [
    pointAtLength(points, start),
    ...points.filter((_, index) => cumulative[index] > start && cumulative[index] < end),
    pointAtLength(points, end),
  ]);
}

/** Wall pieces that block sight: walls minus the gaps of open doors. */
export function blockingSegments(document: MapDocumentV2): Segment[] {
  const doors = document.structures.filter((item): item is DoorStructure => item.type === "door");
  const result: Segment[] = [];
  for (const wall of document.structures) {
    if (wall.type !== "wall") continue;
    const gaps = doors.filter((door) => door.wall_id === wall.id && door.state === "open").map((door) => doorGap(wall.points, door));
    for (const piece of splitPolylineAtGaps(wall.points, gaps)) {
      for (let index = 1; index < piece.length; index += 1) result.push([piece[index - 1], piece[index]]);
    }
  }
  return result;
}

export function hasLineOfSight(segments: readonly Segment[], from: Point, to: Point): boolean {
  return !segments.some((segment) => segmentsIntersect([from, to], segment));
}

function raySegment(origin: Point, dx: number, dy: number, [a, b]: Segment): number | null {
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const denominator = dx * sy - dy * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((a[0] - origin[0]) * sy - (a[1] - origin[1]) * sx) / denominator;
  const u = ((a[0] - origin[0]) * dy - (a[1] - origin[1]) * dx) / denominator;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

/**
 * Visibility polygon from `origin`: rays toward every segment end (and just
 * beside it) stop at the nearest blocking segment or the map border.
 */
export function visibilityPolygon(origin: Point, segments: readonly Segment[], width: number, height: number): Point[] {
  const border: Segment[] = [[[0, 0], [width, 0]], [[width, 0], [width, height]], [[width, height], [0, height]], [[0, height], [0, 0]]];
  const all = [...segments, ...border];
  const angles = new Set<number>();
  for (const [a, b] of all) {
    for (const point of [a, b]) {
      const angle = Math.atan2(point[1] - origin[1], point[0] - origin[0]);
      angles.add(angle - 1e-4); angles.add(angle); angles.add(angle + 1e-4);
    }
  }
  const hits: { angle: number; point: Point }[] = [];
  for (const angle of angles) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let nearest = Number.POSITIVE_INFINITY;
    for (const segment of all) {
      const t = raySegment(origin, dx, dy, segment);
      if (t !== null && t < nearest) nearest = t;
    }
    if (Number.isFinite(nearest)) hits.push({ angle, point: [origin[0] + dx * nearest, origin[1] + dy * nearest] });
  }
  return hits.sort((x, y) => x.angle - y.angle).map((hit) => hit.point);
}

// Redaction for one viewer -------------------------------------------------

export function ownPins(document: MapDocumentV2, viewer: Viewer): MapPin[] {
  return document.pins.filter((pin) => pin.kind === "character" && pin.sheet_id !== undefined && viewer.ownSheetIds.has(pin.sheet_id));
}

/**
 * GM-only redaction, then fog (only regions for this viewer are kept, without
 * the player lists) and, when enabled, line of sight from the viewer's own
 * character pins. Own pins always stay. Mirrors the database function.
 */
export function redactForViewer(document: MapDocumentV2, viewer: Viewer): MapDocumentV2 {
  const base = redactForPlayers(document);
  const fog = document.fog;
  if (!fog || (!fog.enabled && !fog.line_of_sight)) return base;
  const regions = fog.enabled ? fogRegionsFor(fog.regions, viewer.userId) : [];
  const own = new Set(ownPins(base, viewer).map((pin) => pin.id));
  const eyes = base.pins.filter((pin) => own.has(pin.id)).map((pin): Point => [pin.x, pin.y]);
  const sight = fog.line_of_sight && eyes.length > 0 ? blockingSegments(base) : null;

  let structures = base.structures;
  if (fog.enabled) {
    const kept = structures.filter((item) => item.type !== "door" && structureRevealed(item, regions));
    const walls = new Set(kept.filter((item) => item.type === "wall").map((item) => item.id));
    structures = base.structures.filter((item) => item.type === "door" ? walls.has(item.wall_id) : kept.includes(item));
  }
  const pins = base.pins.filter((pin) => {
    if (own.has(pin.id)) return true;
    const point: Point = [pin.x, pin.y];
    if (fog.enabled && !pointRevealed(regions, point)) return false;
    return !sight || eyes.some((eye) => hasLineOfSight(sight, eye, point));
  });
  const legacy = base.legacy && fog.enabled ? {
    ...base.legacy,
    terrain: base.legacy.terrain.filter((cell) => pointRevealed(regions, [
      ((cell.x + 0.5) * base.width) / base.legacy!.width, ((cell.y + 0.5) * base.height) / base.legacy!.height,
    ])),
  } : base.legacy;
  return {
    ...base,
    structures,
    pins,
    ...(legacy ? { legacy } : {}),
    fog: { enabled: fog.enabled, line_of_sight: fog.line_of_sight, regions: regions.map((region) => ({ ...region, players: null })) },
  };
}

/** What the player canvas masks: fog regions (if any) and sight polygons from own pins. */
export function viewerMasks(document: MapDocumentV2, viewer: Viewer): { fogRegions: FogRegion[] | null; sight: Point[][] | null } {
  const fog = document.fog;
  const fogRegions = fog?.enabled ? fogRegionsFor(fog.regions, viewer.userId) : null;
  const eyes = fog?.line_of_sight ? ownPins(document, viewer) : [];
  if (eyes.length === 0) return { fogRegions, sight: null };
  const segments = blockingSegments(document);
  return { fogRegions, sight: eyes.map((pin) => visibilityPolygon([pin.x, pin.y], segments, document.width, document.height)) };
}
