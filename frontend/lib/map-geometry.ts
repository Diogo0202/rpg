/** Pure geometry for the map editor. Coordinates live in 0..MAP_SIZE space. */

export type Point = [number, number];
export const MAP_SIZE = 10_000;

export function clampPoint([x, y]: Point): Point {
  return [Math.min(MAP_SIZE, Math.max(0, Math.round(x))), Math.min(MAP_SIZE, Math.max(0, Math.round(y)))];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Locks the segment from `from` to `to` onto multiples of `stepDegrees`. */
export function snapAngle(from: Point, to: Point, stepDegrees = 15): Point {
  const length = distance(from, to);
  if (length === 0) return to;
  const step = (stepDegrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(to[1] - from[1], to[0] - from[0]) / step) * step;
  return clampPoint([from[0] + Math.cos(angle) * length, from[1] + Math.sin(angle) * length]);
}

export function snapToGrid([x, y]: Point, size: number): Point {
  if (size <= 0) return [x, y];
  return clampPoint([Math.round(x / size) * size, Math.round(y / size) * size]);
}

/** Returns the closest candidate within `radius`, or the point itself. */
export function snapToPoints(point: Point, candidates: Point[], radius: number): Point {
  let best: Point | null = null;
  let bestDistance = radius;
  for (const candidate of candidates) {
    const current = distance(point, candidate);
    if (current <= bestDistance) { best = candidate; bestDistance = current; }
  }
  return best ?? point;
}

export function nearestOnSegment(point: Point, a: Point, b: Point): { point: Point; t: number; distance: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  const projected: Point = [a[0] + t * dx, a[1] + t * dy];
  return { point: projected, t, distance: distance(point, projected) };
}

export function polylineLength(points: Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1], points[index]);
  return total;
}

/** Point and direction at fraction `at` (0..1) of the polyline's total length. */
export function pointAlongPolyline(points: Point[], at: number): { point: Point; angle: number } {
  if (points.length === 0) return { point: [0, 0], angle: 0 };
  if (points.length === 1) return { point: points[0], angle: 0 };
  const target = Math.min(1, Math.max(0, at)) * polylineLength(points);
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const segment = distance(a, b);
    if (walked + segment >= target || index === points.length - 1) {
      const t = segment === 0 ? 0 : Math.min(1, (target - walked) / segment);
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    walked += segment;
  }
  return { point: points[points.length - 1], angle: 0 };
}

/** Closest position on a polyline, expressed as a fraction of its length. */
export function nearestOnPolyline(point: Point, points: Point[]): { point: Point; at: number; distance: number } {
  const total = polylineLength(points);
  let best = { point: points[0] ?? point, at: 0, distance: Number.POSITIVE_INFINITY };
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segmentLength = distance(points[index - 1], points[index]);
    const hit = nearestOnSegment(point, points[index - 1], points[index]);
    if (hit.distance < best.distance) {
      best = { point: hit.point, at: total === 0 ? 0 : (walked + hit.t * segmentLength) / total, distance: hit.distance };
    }
    walked += segmentLength;
  }
  return best;
}

export function pointInPolygon([x, y]: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Corners of the axis-aligned rectangle spanned by two drag points, clockwise. */
export function rectanglePoints(a: Point, b: Point): Point[] {
  const left = Math.min(a[0], b[0]);
  const right = Math.max(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  const bottom = Math.max(a[1], b[1]);
  return [[left, top], [right, top], [right, bottom], [left, bottom]];
}

/** A closed wall outline: the polygon with its first point repeated at the end. */
export function closedOutline(polygon: Point[]): Point[] {
  if (polygon.length === 0) return [];
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? polygon : [...polygon, first];
}

export function translatePoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map(([x, y]) => clampPoint([x + dx, y + dy]));
}
