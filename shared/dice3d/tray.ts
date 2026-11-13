import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, Color, ConeGeometry, DirectionalLight, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Quaternion, Scene,
  ShadowMaterial, SRGBColorSpace, Vector3, WebGLRenderer, PCFSoftShadowMap,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { kiteLayout, solid } from "./geometry.ts";
import { DIE_RADIUS, STEP, simulateThrow, startOf, trayHalfExtent, type Throw } from "./simulate.ts";
import { simulateInWorker } from "./simulate-client.ts";
import { seededRandom } from "./random.ts";
import { cellRect, faceAtlas } from "./textures.ts";
import type { Aim, DiceStyle, DieKind, DieRequest, DieRole } from "./types.ts";

/**
 * Renders a pre-computed throw on a transparent canvas laid over the roll panel. The physics comes
 * from simulateThrow; this class only builds the spiked metal dice and plays the recorded frames.
 */
function faceGeometry(kind: DieKind): BufferGeometry {
  const shape = solid(kind);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const push = (vertex: number, normal: Vector3, uv: [number, number]) => {
    const point = shape.vertices[vertex];
    positions.push(point.x * DIE_RADIUS, point.y * DIE_RADIUS, point.z * DIE_RADIUS);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(...uv);
  };
  shape.faces.forEach((face, index) => {
    const [u0, v0, u1, v1] = cellRect(kind, index);
    const width = u1 - u0;
    const height = v1 - v0;
    const normal = shape.normals[index];
    if (kind === "d10") {
      const corners = kiteLayout(index).map(([u, v]): [number, number] => [u0 + u * width, v0 + v * height]);
      for (const corner of [0, 1, 2, 0, 2, 3]) push(face[corner], normal, corners[corner]);
    } else if (face.length === 3) {
      push(face[0], normal, [u0 + width / 2, v1 - height * 0.04]);
      push(face[1], normal, [u0 + width * 0.015, v1 - height * 0.88]);
      push(face[2], normal, [u1 - width * 0.015, v1 - height * 0.88]);
    } else {
      const corners: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      for (const corner of [0, 1, 2, 0, 2, 3]) push(face[corner], normal, corners[corner]);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  return geometry;
}

/**
 * Local direction the numeral's top points to on the face facing `localNormal`: the 3D image of
 * the texture's +v axis on that face's first triangle. Works for every face layout.
 */
function numeralUp(geometry: BufferGeometry, localNormal: Vector3): Vector3 {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  let best = 0;
  let bestDot = -Infinity;
  for (let start = 0; start < position.count; start += 3) {
    const dot = new Vector3().fromBufferAttribute(normal, start).dot(localNormal);
    if (dot > bestDot) { bestDot = dot; best = start; }
  }
  const [p0, p1, p2] = [0, 1, 2].map((offset) => new Vector3().fromBufferAttribute(position, best + offset));
  const [a, b, c] = [0, 1, 2].map((offset) => [uv.getX(best + offset), uv.getY(best + offset)]);
  const [du1, dv1, du2, dv2] = [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]];
  const determinant = du1 * dv2 - du2 * dv1;
  const edge1 = p1.sub(p0);
  const edge2 = p2.sub(p0);
  // Solve [edge1 edge2] = J [uv1 uv2] for J's v column.
  return edge2.multiplyScalar(du1).sub(edge1.multiplyScalar(du2)).divideScalar(determinant).normalize();
}

/** One cone per vertex, pointing outward, like the spiked dice of the reference set. */
function spikeGeometry(kind: DieKind, length: number): BufferGeometry | null {
  if (length <= 0) return null;
  const up = new Vector3(0, 1, 0);
  const height = length * DIE_RADIUS;
  const radius = DIE_RADIUS * (kind === "d20" ? 0.16 : 0.2);
  return mergeGeometries(solid(kind).vertices.map((vertex) => {
    // Cones share attributes, so the merge never fails here.
    const cone = new ConeGeometry(radius, height, 7);
    cone.applyQuaternion(new Quaternion().setFromUnitVectors(up, vertex));
    const base = vertex.clone().multiplyScalar(DIE_RADIUS * (kind === "d20" ? 0.88 : 0.82) + height / 2);
    cone.translate(base.x, base.y, base.z);
    return cone;
  }));
}

type LiveDie = {
  group: Group; face: MeshStandardMaterial; spikes: MeshStandardMaterial | null; request: DieRequest;
  /** Local rotation that puts the requested face on top; identity until the throw is simulated. */
  correction: Quaternion;
};

/** Camera move and per-die turn that take the scene from the end of the throw to the readable result. */
type Focus = { from: Vector3; target: Vector3; center: Vector3; turns: { start: Quaternion; end: Quaternion }[] };

/** `panelHeight` is the room, in CSS pixels, the page needs under the resting dice for its result panel. */
export type RollOptions = { reducedMotion?: boolean; aim?: Aim; panelHeight?: number };

/** Where a resting die sits on the canvas, in CSS pixels, so the page can pin its value next to it. */
export type DieLabel = { x: number; y: number; radius: number; value: number; role: DieRole; kept: boolean };

/** Seconds the dice take to turn their numerals upright once they rest. */
const SETTLE = 0.45;
/** The camera leaves for the result framing this long before the dice stop, and takes CAMERA_TIME. */
const CAMERA_LEAD = 0.35;
const CAMERA_TIME = 0.75;
/** Share of the screen height left free under the dice when the page does not say how tall its panel is. */
const PANEL_SPACE = 0.3;
const WHITE = new Color("#ffffff");
const DIMMED = new Color("#5a5652");
const DIMMED_SPIKES = new Color("#4a4744");

const unit = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (value: number) => 1 - (1 - value) ** 3;
const easeInOut = (value: number) => value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;

export class DiceTray {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(32, 1, 0.1, 200);
  private dice: LiveDie[] = [];
  private frame = 0;
  private disposed = false;
  /** Bumped by every prepare and roll, so a superseded throw stops animating. */
  private run = 0;
  /** Requests whose dice are laid out and not thrown yet; roll reuses them instead of rebuilding. */
  private waiting: DieRequest[] | null = null;
  private rested = false;
  private halfExtent = 0;
  private panelHeight: number | undefined;
  private metal: Color;
  private faces = new Map<DieKind, BufferGeometry>();
  private spikeShapes = new Map<DieKind, BufferGeometry | null>();
  private from = new Quaternion();
  private to = new Quaternion();
  private look = new Vector3();

  constructor(private canvas: HTMLCanvasElement, private style: DiceStyle) {
    this.metal = new Color(style.metal);
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    const environment = new PMREMGenerator(this.renderer);
    this.scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
    environment.dispose();
    this.scene.add(new AmbientLight("#ffffff", 0.25));
    const key = new DirectionalLight("#fff4e6", 2.4);
    key.position.set(-6, 14, 8);
    key.castShadow = true;
    // Phones keep the smaller map; the larger one removes the stair-stepped shadow edges on desktops.
    const shadowSize = window.innerWidth >= 900 ? 2048 : 1024;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 3;
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
    this.scene.add(key);
    const ember = new PointLight("#b0301c", 40, 30);
    ember.position.set(7, 4, -6);
    this.scene.add(ember);
    const floor = new Mesh(new PlaneGeometry(60, 60), new ShadowMaterial({ opacity: 0.5 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.resize();
  }

  resize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    // setSize clears the canvas, so dice that are not animating must be drawn again.
    if (!this.dice.length) return;
    if (this.rested) this.settle(this.focus(), 1, 1);
    else if (this.waiting) this.frameCamera(this.halfExtent);
    this.render();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private frameCamera(halfExtent: number): void {
    // The camera looks down at a tilt, so the far wall needs extra room besides the aspect ratio.
    const fit = (halfExtent * 1.3) / Math.tan((this.camera.fov * Math.PI) / 360) / Math.min(1, this.camera.aspect);
    this.camera.position.set(0, fit * 0.95, fit * 0.35);
    this.camera.lookAt(0, 0, 0);
  }

  private clearDice(): void {
    for (const die of this.dice) {
      this.scene.remove(die.group);
      die.face.dispose();
      die.spikes?.dispose();
    }
    this.dice = [];
  }

  /** Dice of one kind share their geometry; only the materials are per die, for the dimming. */
  private shapeOf(kind: DieKind): { face: BufferGeometry; spikes: BufferGeometry | null } {
    if (!this.faces.has(kind)) {
      this.faces.set(kind, faceGeometry(kind));
      this.spikeShapes.set(kind, spikeGeometry(kind, this.style.spikes));
    }
    return { face: this.faces.get(kind)!, spikes: this.spikeShapes.get(kind) ?? null };
  }

  private buildDie(request: DieRequest): LiveDie {
    const group = new Group();
    const body = this.style.bodies?.[request.role];
    const map = faceAtlas(request.kind, solid(request.kind).values, request.role, this.style);
    const sharpness = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (map.anisotropy !== sharpness) { map.anisotropy = sharpness; map.needsUpdate = true; }
    const face = new MeshStandardMaterial({
      map, metalness: body?.metalness ?? this.style.metalness, roughness: body?.roughness ?? this.style.roughness, flatShading: true,
    });
    const shape = this.shapeOf(request.kind);
    const mesh = new Mesh(shape.face, face);
    mesh.castShadow = true;
    group.add(mesh);
    const spikeShape = shape.spikes;
    let spikes: MeshStandardMaterial | null = null;
    if (spikeShape) {
      spikes = new MeshStandardMaterial({ color: this.style.metal, metalness: this.style.metalness, roughness: this.style.roughness * 0.8, flatShading: true });
      const mesh = new Mesh(spikeShape, spikes);
      mesh.castShadow = true;
      group.add(mesh);
    }
    this.scene.add(group);
    return { group, face, spikes, request, correction: new Quaternion() };
  }

  /**
   * Poses the dice at a fractional frame of the recording. Blending the two neighbouring frames
   * keeps the motion smooth on displays that do not refresh at the 60 Hz the physics ran at.
   */
  private pose(thrown: Throw, time: number): void {
    const base = Math.floor(time);
    const blend = time - base;
    thrown.tracks.forEach((track, index) => {
      const last = track.frames.length - 1;
      const before = track.frames[Math.min(base, last)];
      const after = track.frames[Math.min(base + 1, last)];
      const die = this.dice[index];
      die.group.position.set(
        before.position[0] + (after.position[0] - before.position[0]) * blend,
        before.position[1] + (after.position[1] - before.position[1]) * blend,
        before.position[2] + (after.position[2] - before.position[2]) * blend,
      );
      this.from.set(...before.quaternion);
      this.to.set(...after.quaternion);
      die.group.quaternion.slerpQuaternions(this.from, this.to, blend).multiply(die.correction);
    });
  }

  /**
   * Result framing for the dice as they are posed now: a near top-down camera so every top face
   * looks at the viewer and reads larger on a phone, and a turn about the vertical axis for each
   * die so its numeral stands upright. The dice sit in the upper part of the screen, above the panel.
   */
  private focus(): Focus {
    const xs = this.dice.map((die) => die.group.position.x);
    const zs = this.dice.map((die) => die.group.position.z);
    const margin = DIE_RADIUS * 2.6;
    const halfWidth = (Math.max(...xs) - Math.min(...xs)) / 2 + margin;
    const halfDepth = (Math.max(...zs) - Math.min(...zs)) / 2 + margin;
    const tangent = Math.tan((this.camera.fov * Math.PI) / 360);
    // A short window cannot give the panel more than about half of itself and still show the dice.
    const space = this.panelHeight && this.canvas.clientHeight ? Math.min(0.55, Math.max(0.15, this.panelHeight / this.canvas.clientHeight)) : PANEL_SPACE;
    const height = Math.max(halfDepth / (1 - space), halfWidth / this.camera.aspect) / tangent;
    // The camera looks at a point nearer the viewer than the dice, which lifts them on screen.
    const center = new Vector3((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2 + height * tangent * space);
    const target = new Vector3(center.x, height, center.z + height * 0.12);
    // Turning a resting die about the vertical axis keeps its contact, so each one turns until its
    // top numeral stands upright on screen (top of the screen is world -z from this camera).
    const worldUp = new Vector3(0, 1, 0);
    const turns = this.dice.map((die) => {
      const start = die.group.quaternion.clone();
      const mesh = die.group.children[0] as Mesh;
      const localUp = worldUp.clone().applyQuaternion(start.clone().invert());
      const numeral = numeralUp(mesh.geometry, localUp).applyQuaternion(start).setY(0);
      if (numeral.lengthSq() < 1e-6) return { start, end: start };
      // Rotating about +y by θ adds θ to atan2(x, z); screen up (0, 0, -1) sits at π.
      const yaw = new Quaternion().setFromAxisAngle(worldUp, Math.PI - Math.atan2(numeral.x, numeral.z));
      return { start, end: yaw.multiply(start) };
    });
    return { from: this.camera.position.clone(), target, center, turns };
  }

  /**
   * Applies a share of the result framing: `camera` moves the view, `turn` (only once the dice
   * rest) turns the numerals upright, swells the dice that count and dims the ones that do not.
   */
  private settle(focus: Focus, camera: number, turn: number): void {
    this.camera.position.lerpVectors(focus.from, focus.target, camera);
    this.camera.lookAt(this.look.copy(focus.center).multiplyScalar(camera));
    if (turn <= 0) return;
    const eased = easeOut(turn);
    this.dice.forEach((die, index) => {
      die.group.quaternion.slerpQuaternions(focus.turns[index].start, focus.turns[index].end, eased);
      if (die.request.kept !== false) {
        die.group.scale.setScalar(1 + 0.08 * Math.sin(Math.PI * turn));
        return;
      }
      die.face.color.copy(WHITE).lerp(DIMMED, eased);
      die.spikes?.color.copy(this.metal).lerp(DIMMED_SPIKES, eased);
    });
  }

  /** Screen position of every resting die, for the value badges the page draws over the canvas. */
  labels(): DieLabel[] {
    const { clientWidth, clientHeight } = this.canvas;
    if (!this.rested || !clientWidth || !clientHeight) return [];
    const point = new Vector3();
    const edge = new Vector3();
    const toScreen = (vector: Vector3) => vector.project(this.camera).set((vector.x + 1) / 2 * clientWidth, (1 - vector.y) / 2 * clientHeight, 0);
    return this.dice.map((die) => {
      toScreen(point.copy(die.group.position));
      toScreen(edge.copy(die.group.position).setX(die.group.position.x + DIE_RADIUS));
      return { x: point.x, y: point.y, radius: Math.abs(edge.x - point.x), value: die.request.value, role: die.request.role, kept: die.request.kept !== false };
    });
  }

  /**
   * Lays the dice in the cluster the throw starts from, before the player throws. The positions
   * come from the same generator as the simulation, so the throw begins from this picture.
   */
  prepare(requests: DieRequest[], seed: number): void {
    cancelAnimationFrame(this.frame);
    this.run += 1;
    this.clearDice();
    this.rested = false;
    this.waiting = null;
    this.resize();
    this.dice = requests.map((request) => this.buildDie(request));
    this.halfExtent = trayHalfExtent(requests.length);
    this.frameCamera(this.halfExtent);
    const random = seededRandom(seed + 7919);
    this.dice.forEach((die, index) => {
      const start = startOf(index, requests.length, random, this.halfExtent);
      die.group.position.set(...start.position);
      die.group.quaternion.set(...start.quaternion);
    });
    this.waiting = requests;
    this.render();
  }

  /** Throws the dice and resolves once they rest on the requested faces. */
  async roll(requests: DieRequest[], seed: number, options: RollOptions = {}): Promise<Throw> {
    // Dice already laid out by prepare are thrown as they are; otherwise they are laid out first.
    if (this.waiting !== requests) this.prepare(requests, seed);
    cancelAnimationFrame(this.frame);
    const run = ++this.run;
    this.waiting = null;
    this.panelHeight = options.panelHeight;
    let thrown: Throw;
    try {
      thrown = await simulateInWorker(requests, seed, options.aim);
    } catch {
      // Without a worker the physics blocks this thread for a moment, so the waiting dice are painted first.
      if (!options.reducedMotion) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      thrown = simulateThrow(requests, seed, options.aim);
    }
    if (this.disposed || run !== this.run) return thrown;
    thrown.tracks.forEach((track, index) => this.dice[index].correction.set(...track.correction));
    this.frameCamera(thrown.halfExtent);
    const last = thrown.frameCount - 1;
    // The recording already holds the resting pose, so the result framing is known before the throw plays.
    this.pose(thrown, last);
    const focus = this.focus();
    if (options.reducedMotion) {
      this.settle(focus, 1, 1);
      this.rested = true;
      this.render();
      return thrown;
    }
    const duration = last * STEP;
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        if (this.disposed || run !== this.run) return resolve(thrown);
        const elapsed = (now - start) / 1000;
        this.pose(thrown, Math.min(elapsed, duration) / STEP);
        this.settle(focus, easeInOut(unit((elapsed - (duration - CAMERA_LEAD)) / CAMERA_TIME)), unit((elapsed - duration) / SETTLE));
        this.render();
        if (elapsed < duration + SETTLE) {
          this.frame = requestAnimationFrame(tick);
          return;
        }
        this.rested = true;
        resolve(thrown);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clearDice();
    for (const geometry of [...this.faces.values(), ...this.spikeShapes.values()]) geometry?.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
