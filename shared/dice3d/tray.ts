import {
  ACESFilmicToneMapping, AmbientLight, BufferGeometry, Color, ConeGeometry, DirectionalLight, Float32BufferAttribute,
  Group, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Quaternion, Scene,
  ShadowMaterial, SRGBColorSpace, Vector3, WebGLRenderer, PCFSoftShadowMap,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { kiteLayout, solid } from "./geometry.ts";
import { DIE_RADIUS, STEP, simulateThrow, startOf, trayHalfExtent, type Throw } from "./simulate.ts";
import { seededRandom } from "./random.ts";
import { cellRect, faceAtlas } from "./textures.ts";
import type { Aim, DiceStyle, DieKind, DieRequest } from "./types.ts";

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

type LiveDie = { group: Group; face: MeshStandardMaterial; spikes: MeshStandardMaterial | null; request: DieRequest };

export type RollOptions = { reducedMotion?: boolean; aim?: Aim };

export class DiceTray {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(32, 1, 0.1, 200);
  private dice: LiveDie[] = [];
  private frame = 0;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, private style: DiceStyle) {
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
    key.shadow.mapSize.set(1024, 1024);
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
      die.group.traverse((node) => { if (node instanceof Mesh) node.geometry.dispose(); });
      die.face.dispose();
      die.spikes?.dispose();
    }
    this.dice = [];
  }

  private buildDie(request: DieRequest): LiveDie {
    const group = new Group();
    const body = this.style.bodies?.[request.role];
    const face = new MeshStandardMaterial({
      map: faceAtlas(request.kind, solid(request.kind).values, request.role, this.style),
      metalness: body?.metalness ?? this.style.metalness, roughness: body?.roughness ?? this.style.roughness, flatShading: true,
    });
    const mesh = new Mesh(faceGeometry(request.kind), face);
    mesh.castShadow = true;
    group.add(mesh);
    const spikeShape = spikeGeometry(request.kind, this.style.spikes);
    let spikes: MeshStandardMaterial | null = null;
    if (spikeShape) {
      spikes = new MeshStandardMaterial({ color: this.style.metal, metalness: this.style.metalness, roughness: this.style.roughness * 0.8, flatShading: true });
      const mesh = new Mesh(spikeShape, spikes);
      mesh.castShadow = true;
      group.add(mesh);
    }
    this.scene.add(group);
    return { group, face, spikes, request };
  }

  private pose(thrown: Throw, frame: number): void {
    thrown.tracks.forEach((track, index) => {
      const sample = track.frames[Math.min(frame, track.frames.length - 1)];
      const group = this.dice[index].group;
      group.position.set(...sample.position);
      group.quaternion.set(...sample.quaternion).multiply(new Quaternion(...track.correction));
    });
    this.renderer.render(this.scene, this.camera);
  }

  /** Dims dice that do not count, once the throw has settled. */
  private markKept(): void {
    for (const die of this.dice) {
      if (die.request.kept !== false) continue;
      die.face.color = new Color("#5a5652");
      if (die.spikes) die.spikes.color = new Color("#4a4744");
    }
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Lays the dice in the cluster the throw starts from, before the player throws. The positions
   * come from the same generator as the simulation, so the throw begins from this picture.
   */
  prepare(requests: DieRequest[], seed: number): void {
    cancelAnimationFrame(this.frame);
    this.clearDice();
    this.dice = requests.map((request) => this.buildDie(request));
    this.resize();
    const halfExtent = trayHalfExtent(requests.length);
    this.frameCamera(halfExtent);
    const random = seededRandom(seed + 7919);
    this.dice.forEach((die, index) => {
      const start = startOf(index, requests.length, random, halfExtent);
      die.group.position.set(...start.position);
      die.group.quaternion.set(...start.quaternion);
    });
    this.renderer.render(this.scene, this.camera);
  }

  /** Throws the dice and resolves once they rest on the requested faces. */
  roll(requests: DieRequest[], seed: number, options: RollOptions = {}): Promise<Throw> {
    cancelAnimationFrame(this.frame);
    this.clearDice();
    const thrown = simulateThrow(requests, seed, options.aim);
    this.dice = requests.map((request) => this.buildDie(request));
    this.resize();
    this.frameCamera(thrown.halfExtent);
    if (options.reducedMotion) {
      this.pose(thrown, thrown.frameCount - 1);
      this.markKept();
      return Promise.resolve(thrown);
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        if (this.disposed) return resolve(thrown);
        const frame = Math.floor((now - start) / 1000 / STEP);
        this.pose(thrown, frame);
        if (frame >= thrown.frameCount - 1) {
          this.markKept();
          resolve(thrown);
          return;
        }
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.clearDice();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
