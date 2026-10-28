import { Body, Box, ConvexPolyhedron, Material, ContactMaterial, Plane, Vec3 as CVec3, World } from "cannon-es";
import { Euler, Quaternion } from "three";
import { faceForValue, solid, symmetryBetween, upFace } from "./geometry.ts";
import { seededRandom } from "./random.ts";
import type { Aim, DieKind, DieRequest, Quat, Vec3 } from "./types.ts";

/**
 * Pre-computes a throw: the physics runs first at a fixed step, every frame is recorded, then each
 * die gets a fixed local rotation (a symmetry of its solid) so the face the server decided is the
 * one that ends up on top. Pure and deterministic for a given seed, so it runs in Node tests.
 */
export const STEP = 1 / 60;
export const MAX_FRAMES = 60 * 7;
export const DIE_RADIUS = 0.9;
/** Most dice one throw simulates (a full V5 pool of 10 normal and 5 Hunger dice). */
export const MAX_TRAY_DICE = 15;
/** Re-throws of a tilted landing; each one costs a full simulation, so the bound keeps phones responsive. */
const MAX_ATTEMPTS = 4;

export type DieTrack = {
  request: DieRequest;
  frames: { position: Vec3; quaternion: Quat }[];
  /** Local rotation applied under the body orientation when rendering. */
  correction: Quat;
};

export type Throw = { tracks: DieTrack[]; frameCount: number; halfExtent: number; attempts: number };

/** Half width of the square tray; grows with the number of dice. */
export function trayHalfExtent(count: number): number {
  return 2.3 + Math.sqrt(count) * 0.95 + (count > 5 ? 1.6 : 0);
}

function shapeFor(kind: DieKind) {
  const base = solid(kind);
  if (kind === "d6") {
    const half = DIE_RADIUS / Math.sqrt(3);
    return new Box(new CVec3(half, half, half));
  }
  return new ConvexPolyhedron({
    vertices: base.vertices.map((vertex) => new CVec3(vertex.x * DIE_RADIUS, vertex.y * DIE_RADIUS, vertex.z * DIE_RADIUS)),
    faces: base.faces,
  });
}

/** Flicks always carry the dice away from the near wall: forward speed never drops below 55%, sideways is halved. */
function aimSpeed(aim: Aim): number {
  return 7 + 9 * aim.power;
}

/**
 * Where a die starts and how it is thrown. The cluster sits on the -x side whatever the aim, so
 * the preview before the throw is the same picture the throw starts from; the aim only changes
 * the velocity. Draws the same random numbers with or without an aim.
 */
export function startOf(index: number, count: number, random: () => number, halfExtent: number, aim?: Aim) {
  const columns = Math.ceil(Math.sqrt(count));
  const row = Math.floor(index / columns);
  const column = index % columns;
  // Big pools start further apart, so fewer dice land leaning on each other.
  const gap = count > 5 ? 1.2 : 1;
  const position: Vec3 = [-halfExtent + 1.2 + row * 1.5 * gap, 3 + random() * 2, (column - (columns - 1) / 2) * 1.6 * gap];
  const quaternion = new Quaternion().setFromEuler(new Euler(random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2));
  const spread = [random(), random(), random()];
  const velocity: Vec3 = aim
    ? [aimSpeed(aim) * (0.55 + 0.45 * Math.max(0, Math.cos(aim.angle))) + (spread[0] - 0.5) * 2, -2 - spread[1] * 3, aimSpeed(aim) * 0.5 * Math.sin(aim.angle) + (spread[2] - 0.5) * 2]
    : [10 + spread[0] * 6, -2 - spread[1] * 3, (spread[2] - 0.5) * 8];
  const spin: Vec3 = [(random() - 0.5) * 30, (random() - 0.5) * 30, (random() - 0.5) * 30];
  return { position, quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] as Quat, velocity, spin };
}

type Attempt = { frames: { position: Vec3; quaternion: Quat }[][]; final: Quaternion[]; settled: boolean; quality: number };

function runOnce(requests: DieRequest[], random: () => number, halfExtent: number, aim?: Aim): Attempt {
  const world = new World({ gravity: new CVec3(0, -32, 0), allowSleep: true });
  world.defaultContactMaterial.friction = 0.25;
  const diceMaterial = new Material("dice");
  const tableMaterial = new Material("table");
  world.addContactMaterial(new ContactMaterial(diceMaterial, tableMaterial, { friction: 0.3, restitution: 0.35 }));
  world.addContactMaterial(new ContactMaterial(diceMaterial, diceMaterial, { friction: 0.2, restitution: 0.3 }));

  const floor = new Body({ mass: 0, material: tableMaterial, shape: new Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const walls: [number, number, number, number][] = [[halfExtent, 0, 0, -Math.PI / 2], [-halfExtent, 0, 0, Math.PI / 2], [0, 0, halfExtent, Math.PI], [0, 0, -halfExtent, 0]];
  for (const [x, , z, angle] of walls) {
    const wall = new Body({ mass: 0, material: tableMaterial, shape: new Plane() });
    wall.position.set(x, 0, z);
    wall.quaternion.setFromEuler(0, angle, 0);
    world.addBody(wall);
  }

  const bodies = requests.map((request, index) => {
    const body = new Body({ mass: request.kind === "d20" ? 1.4 : 1, material: diceMaterial, shape: shapeFor(request.kind), allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.25, angularDamping: 0.12, linearDamping: 0.08 });
    const start = startOf(index, requests.length, random, halfExtent, aim);
    body.position.set(...start.position);
    body.quaternion.set(...start.quaternion);
    body.velocity.set(...start.velocity);
    body.angularVelocity.set(...start.spin);
    world.addBody(body);
    return body;
  });

  const frames: { position: Vec3; quaternion: Quat }[][] = requests.map(() => []);
  let frame = 0;
  for (; frame < MAX_FRAMES; frame++) {
    world.step(STEP);
    bodies.forEach((body, index) => frames[index].push({
      position: [body.position.x, body.position.y, body.position.z],
      quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
    }));
    if (frame > 30 && bodies.every((body) => body.sleepState === Body.SLEEPING)) break;
  }
  const final = bodies.map((body) => new Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w));
  const flat = requests.every((request, index) => upFace(request.kind, final[index]).alignment > 0.97);
  const inside = bodies.every((body) => Math.abs(body.position.x) < halfExtent && Math.abs(body.position.z) < halfExtent);
  const flatness = Math.min(...requests.map((request, index) => upFace(request.kind, final[index]).alignment));
  return { frames, final, settled: flat && inside && frame < MAX_FRAMES, quality: inside ? flatness - (frame < MAX_FRAMES ? 0 : 0.2) : -1 };
}

/** Simulates a throw that lands every die on its requested value. Retries tilted landings with a derived seed. */
export function simulateThrow(requests: DieRequest[], seed: number, aim?: Aim): Throw {
  if (requests.length < 1 || requests.length > MAX_TRAY_DICE) throw new Error(`A bandeja aceita de 1 a ${MAX_TRAY_DICE} dados.`);
  for (const request of requests) faceForValue(request.kind, request.value);
  const halfExtent = trayHalfExtent(requests.length);
  let result: Attempt | undefined;
  let attempts = 0;
  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    const attempt = runOnce(requests, seededRandom(seed + attempts * 7919), halfExtent, aim);
    // No attempt may settle with a crowded tray: keep the flattest one instead of the last.
    if (!result || attempt.quality > result.quality) result = attempt;
    if (attempt.settled) break;
  }
  if (!result) throw new Error("A simulação não rodou.");
  const tracks = requests.map((request, index) => {
    const landed = upFace(request.kind, result.final[index]).face;
    const wanted = faceForValue(request.kind, request.value);
    const correction = symmetryBetween(request.kind, wanted, landed);
    return { request, frames: result.frames[index], correction: [correction.x, correction.y, correction.z, correction.w] as Quat };
  });
  return { tracks, frameCount: Math.max(...result.frames.map((frames) => frames.length)), halfExtent, attempts };
}

/** Value shown on top of a track's last frame once the correction is applied (used by tests and the a11y text). */
export function landedValue(track: DieTrack): number {
  const last = track.frames.at(-1)!;
  const body = new Quaternion(...last.quaternion);
  const shown = body.multiply(new Quaternion(...track.correction));
  return solid(track.request.kind).values[upFace(track.request.kind, shown).face];
}
