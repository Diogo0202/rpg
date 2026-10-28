import { Matrix4, Quaternion, Vector3 } from "three";
import type { DieKind } from "./types.ts";

/**
 * Base solids for the dice: vertices, faces (vertex indices, counter-clockwise seen from outside)
 * and the number printed on each face. Opposite faces add up to faces + 1, like printed dice.
 * Spikes and textures are cosmetic; physics and face reading use these solids only.
 */
export type Solid = {
  kind: DieKind;
  vertices: Vector3[];
  faces: number[][];
  values: number[];
  normals: Vector3[];
};

const PHI = (1 + Math.sqrt(5)) / 2;

function icosahedron(): Solid {
  const raw: [number, number, number][] = [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
  ];
  const vertices = raw.map(([x, y, z]) => new Vector3(x, y, z).normalize());
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return withValues("d20", vertices, faces);
}

function cube(): Solid {
  const s = 1 / Math.sqrt(3);
  const vertices = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
  ].map(([x, y, z]) => new Vector3(x, y, z));
  const faces = [[1, 2, 6, 5], [0, 4, 7, 3], [3, 7, 6, 2], [0, 1, 5, 4], [4, 5, 6, 7], [0, 3, 2, 1]];
  return withValues("d6", vertices, faces);
}

/**
 * Pentagonal trapezohedron (the d10): two poles and a zigzag ring of ten points, ten kite faces.
 * With poles at height 1 and ring points at radius 1, the kites are exactly planar when the ring
 * zigzags at +-c with c = (1 - cos 36deg) / (1 + cos 36deg). Every face lists its pole first.
 */
function trapezohedron(): Solid {
  const k = Math.cos(Math.PI / 5);
  const c = (1 - k) / (1 + k);
  const vertices = [new Vector3(0, 1, 0), new Vector3(0, -1, 0)];
  for (let index = 0; index < 10; index++) {
    const angle = (index * Math.PI) / 5;
    vertices.push(new Vector3(Math.cos(angle), index % 2 === 0 ? c : -c, Math.sin(angle)));
  }
  const ring = (index: number) => 2 + (index % 10);
  const faces: number[][] = [];
  for (let index = 0; index < 5; index++) faces.push([0, ring(2 * index), ring(2 * index + 1), ring(2 * index + 2)]);
  for (let index = 0; index < 5; index++) faces.push([1, ring(2 * index + 1), ring(2 * index + 2), ring(2 * index + 3)]);
  // Wind every kite counter-clockwise seen from outside, keeping the pole first.
  const wound = faces.map((face) => {
    const center = face.reduce((sum, vertex) => sum.add(vertices[vertex]), new Vector3()).divideScalar(4);
    return faceNormal(vertices, face).dot(center) > 0 ? face : [face[0], face[3], face[2], face[1]];
  });
  return withValues("d10", vertices, wound);
}

function faceNormal(vertices: Vector3[], face: number[]): Vector3 {
  const [a, b, c] = face.map((index) => vertices[index]);
  return new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
}

/** Numbers faces so each pair of opposite faces sums to faces + 1. */
function withValues(kind: DieKind, vertices: Vector3[], faces: number[][]): Solid {
  const normals = faces.map((face) => faceNormal(vertices, face));
  const values = new Array<number>(faces.length).fill(0);
  let next = 1;
  for (let index = 0; index < faces.length; index++) {
    if (values[index]) continue;
    const opposite = normals.findIndex((normal, other) => other !== index && normal.dot(normals[index]) < -0.999);
    values[index] = next;
    values[opposite] = faces.length + 1 - next;
    next += 1;
  }
  return { kind, vertices, faces, values, normals };
}

const SOLIDS: Record<DieKind, Solid> = { d20: icosahedron(), d6: cube(), d10: trapezohedron() };

/**
 * Corners of a kite face in its texture cell, as [u, v] in 0..1 with the pole at the top, seen from
 * outside. Corners keep their true proportions; the face is centered so a glyph at the cell center
 * sits on the face.
 */
export function kiteLayout(face: number): [number, number][] {
  const shape = SOLIDS.d10;
  const corners = shape.faces[face].map((index) => shape.vertices[index]);
  const center = corners.reduce((sum, corner) => sum.add(corner), new Vector3()).divideScalar(4);
  const normal = shape.normals[face];
  const up = corners[0].clone().sub(corners[2]).normalize();
  const right = new Vector3().crossVectors(up, normal).normalize();
  const flat = corners.map((corner) => {
    const offset = corner.clone().sub(center);
    return [offset.dot(right), offset.dot(up)] as [number, number];
  });
  const scale = 0.48 / Math.max(...flat.flat().map(Math.abs));
  return flat.map(([x, y]) => [0.5 + x * scale, 0.5 + y * scale]);
}

export function solid(kind: DieKind): Solid {
  return SOLIDS[kind];
}

export function faceForValue(kind: DieKind, value: number): number {
  const index = SOLIDS[kind].values.indexOf(value);
  if (index < 0) throw new Error(`${kind} não tem a face ${value}`);
  return index;
}

/** Face whose outward normal points most upward for a body orientation. */
export function upFace(kind: DieKind, orientation: Quaternion): { face: number; alignment: number } {
  const up = new Vector3(0, 1, 0);
  let best = { face: 0, alignment: -Infinity };
  SOLIDS[kind].normals.forEach((normal, face) => {
    const alignment = normal.clone().applyQuaternion(orientation).dot(up);
    if (alignment > best.alignment) best = { face, alignment };
  });
  return best;
}

function frame(normal: Vector3, toward: Vector3): Matrix4 {
  const x = toward.clone().sub(normal.clone().multiplyScalar(toward.dot(normal))).normalize();
  const z = new Vector3().crossVectors(x, normal);
  return new Matrix4().makeBasis(x, normal, z);
}

function isSymmetry(target: Solid, rotation: Quaternion): boolean {
  return target.vertices.every((vertex) => {
    const moved = vertex.clone().applyQuaternion(rotation);
    return target.vertices.some((other) => other.distanceToSquared(moved) < 1e-6);
  });
}

const symmetryCache = new Map<string, Quaternion>();

/**
 * Rotation of the solid onto itself that carries face `from` to face `to`. Applied to the mesh in
 * local space, a die that physically landed with `to` up shows `from` up, with identical contact.
 */
export function symmetryBetween(kind: DieKind, from: number, to: number): Quaternion {
  const key = `${kind}:${from}:${to}`;
  const cached = symmetryCache.get(key);
  if (cached) return cached.clone();
  const target = SOLIDS[kind];
  const center = (face: number) => target.faces[face].reduce((sum, index) => sum.add(target.vertices[index]), new Vector3()).divideScalar(target.faces[face].length);
  const source = frame(target.normals[from], target.vertices[target.faces[from][0]].clone().sub(center(from)));
  for (const vertex of target.faces[to]) {
    const destination = frame(target.normals[to], target.vertices[vertex].clone().sub(center(to)));
    const rotation = new Quaternion().setFromRotationMatrix(destination.multiply(source.clone().invert()));
    if (isSymmetry(target, rotation)) {
      symmetryCache.set(key, rotation);
      return rotation.clone();
    }
  }
  throw new Error(`sem simetria entre as faces ${from} e ${to} do ${kind}`);
}
