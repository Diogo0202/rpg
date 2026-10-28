import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { faceForValue, kiteLayout, solid, symmetryBetween } from "../../shared/dice3d/geometry.ts";
import { MIN_POWER, aimFromSamples } from "../../shared/dice3d/aim.ts";
import { canThrowV5, v5Dice, v5Glyph } from "../../shared/dice3d/v5.ts";
import { landedValue, simulateThrow } from "../../shared/dice3d/simulate.ts";
import { seedFrom } from "../../shared/dice3d/random.ts";
import { sotdlDice, sotdlFateDice } from "../../shared/dice3d/sotdl.ts";
import { diceStyleFor } from "../../shared/dice3d/styles.ts";
import { hunterDice } from "../../shared/dice3d/hunter.ts";

test("sólidos têm normais para fora e faces opostas somando faces + 1", () => {
  for (const kind of ["d20", "d6", "d10"]) {
    const shape = solid(kind);
    assert.deepEqual([...shape.values].sort((a, b) => a - b), shape.faces.map((_, index) => index + 1));
    shape.faces.forEach((face, index) => {
      const center = face.reduce((sum, vertex) => sum.add(shape.vertices[vertex]), shape.vertices[0].clone().multiplyScalar(0));
      assert.ok(center.dot(shape.normals[index]) > 0, `${kind} face ${index} aponta para dentro`);
      const opposite = shape.normals.findIndex((normal) => normal.dot(shape.normals[index]) < -0.999);
      assert.equal(shape.values[index] + shape.values[opposite], shape.faces.length + 1);
    });
  }
});

test("existe uma simetria levando qualquer face a qualquer outra", () => {
  for (const kind of ["d20", "d6", "d10"]) {
    const shape = solid(kind);
    for (let from = 0; from < shape.faces.length; from++) {
      const to = (from * 7 + 3) % shape.faces.length;
      const rotation = symmetryBetween(kind, from, to);
      assert.ok(shape.normals[from].clone().applyQuaternion(rotation).distanceTo(shape.normals[to]) < 1e-6);
    }
  }
});

const requestsFor = (seed, d6) => [
  { kind: "d20", value: (seed % 20) + 1, role: "main" },
  ...Array.from({ length: d6 }, (_, index) => ({ kind: "d6", value: ((seed + index) % 6) + 1, role: "boon" })),
];

test("cada dado pousa na face pedida, com 1, 3 e 11 dados", () => {
  for (const d6 of [0, 2, 10]) {
    for (let seed = 1; seed <= 6; seed++) {
      const thrown = simulateThrow(requestsFor(seed, d6), seed * 101 + d6);
      assert.equal(thrown.tracks.length, d6 + 1);
      for (const track of thrown.tracks) assert.equal(landedValue(track), track.request.value);
      for (const track of thrown.tracks) {
        const [x, , z] = track.frames.at(-1).position;
        assert.ok(Math.abs(x) < thrown.halfExtent && Math.abs(z) < thrown.halfExtent, "dado fora da bandeja");
      }
      assert.ok(thrown.frameCount < 60 * 7, "os dados não pararam a tempo");
    }
  }
});

test("mesma rolagem e mesmo seed geram a mesma trajetória", () => {
  const seed = seedFrom("rolagem-123");
  const first = simulateThrow(requestsFor(4, 3), seed);
  const second = simulateThrow(requestsFor(4, 3), seed);
  assert.deepEqual(first.tracks.map((track) => track.frames.at(-1)), second.tracks.map((track) => track.frames.at(-1)));
  assert.equal(first.frameCount, second.frameCount);
});

test("valores fora do dado e bandeja vazia ou cheia são recusados", () => {
  assert.throws(() => faceForValue("d6", 7));
  assert.throws(() => simulateThrow([], 1));
  assert.throws(() => simulateThrow(requestsFor(1, 15), 1));
});

test("mapeadores do SotDL marcam o d6 que vale e o papel de cada dado", () => {
  assert.deepEqual(sotdlDice({ d20: 14, boonDice: [2, 5, 3], netBoons: 3 }), [
    { kind: "d20", value: 14, role: "main" },
    { kind: "d6", value: 2, role: "boon", kept: false },
    { kind: "d6", value: 5, role: "boon", kept: true },
    { kind: "d6", value: 3, role: "boon", kept: false },
  ]);
  assert.equal(sotdlDice({ d20: 3, boonDice: [4], netBoons: -1 })[1].role, "bane");
  assert.deepEqual(sotdlFateDice(6), [{ kind: "d6", value: 6, role: "fate" }]);
  assert.equal(diceStyleFor("shadow-demon-lord").splatter, "#8f1d14");
  assert.equal(diceStyleFor("sistema-sem-estilo").id, "shadow-demon-lord");
});

test("Caçador preserva todos os dados de Desespero ao limitar a bandeja", () => {
  const normal = Array.from({ length: 30 }, (_, index) => index % 10 + 1);
  const desperate = [1, 2, 3, 4, 10];
  const { requests, omitted } = hunterDice(normal, desperate);
  assert.equal(requests.length, 15);
  assert.equal(omitted, 20);
  assert.deepEqual(requests.slice(-5).map((request) => request.value), desperate);
  assert.ok(requests.slice(-5).every((request) => request.role === "desperation"));
  assert.equal(diceStyleFor("hunter").bodies.desperation.color, "#17191c");
  assert.throws(() => hunterDice([11], []));
});

test("d10 é um trapezoedro de faces planas, simétrico e com 10 faces numeradas", () => {
  const shape = solid("d10");
  assert.equal(shape.vertices.length, 12);
  assert.equal(shape.faces.length, 10);
  shape.faces.forEach((face, index) => {
    const points = face.map((vertex) => shape.vertices[vertex]);
    for (const point of points) assert.ok(Math.abs(point.clone().sub(points[0]).dot(shape.normals[index])) < 1e-9, `face ${index} não é plana`);
    assert.ok(points[0].y === 1 || points[0].y === -1, "o polo vem primeiro");
  });
  const cells = kiteLayout(3);
  assert.equal(cells.length, 4);
  assert.ok(cells.every(([u, v]) => u >= 0 && u <= 1 && v >= 0 && v <= 1));
});

test("V5: o mapeador usa os dados já sorteados e marca os dados de Fome primeiro", () => {
  const rolls = [10, 3, 7, 1, 6];
  const requests = v5Dice(rolls, 2);
  assert.deepEqual(requests.map((request) => request.value), rolls);
  assert.deepEqual(requests.map((request) => request.role), ["hunger", "hunger", "main", "main", "main"]);
  assert.ok(requests.every((request) => request.kind === "d10"));
  assert.throws(() => v5Dice([0], 0));
  assert.throws(() => v5Dice([5, 5], 3));
  assert.throws(() => v5Dice(Array(16).fill(5), 0));
  assert.equal(canThrowV5(15), true);
  assert.equal(canThrowV5(16), false);
});

test("V5: ankh nos comuns, caveira na Fome e ankh coroado no 10 de ambos", () => {
  assert.equal(v5Glyph("main", 4), "ankh");
  assert.equal(v5Glyph("hunger", 4), "skull");
  assert.equal(v5Glyph("main", 10), "crowned-ankh");
  assert.equal(v5Glyph("hunger", 10), "crowned-ankh");
  assert.throws(() => v5Glyph("main", 11));
  const style = diceStyleFor("vampire-v5");
  assert.equal(style.bodies.main.color, "#0d0d0f");
  assert.ok(style.bodies.hunger.roughness < style.bodies.main.roughness, "Fome brilha mais que o dado fosco");
});

test("V5: cada d10 pousa na face sorteada, com qualquer mira e com a bandeja cheia", () => {
  const rolls = Array.from({ length: 15 }, (_, index) => (index * 7) % 10 + 1);
  const requests = v5Dice(rolls, 5);
  for (const aim of [undefined, { angle: 0, power: 0.5 }, { angle: Math.PI / 2, power: 1 }, { angle: -2.4, power: 0.3 }]) {
    const thrown = simulateThrow(requests, 42, aim);
    for (const track of thrown.tracks) assert.equal(landedValue(track), track.request.value);
    assert.ok(thrown.frameCount < 60 * 7, "os dados não pararam a tempo");
  }
  const first = simulateThrow(requests, 9, { angle: 1, power: 0.7 });
  const second = simulateThrow(requests, 9, { angle: 1, power: 0.7 });
  assert.deepEqual(first.tracks.map((track) => track.frames.at(-1)), second.tracks.map((track) => track.frames.at(-1)));
});

test("a mira sai do arrasto: toque lança sem mira, flick define direção e força", () => {
  const at = (x, y, t) => ({ x, y, t });
  assert.equal(aimFromSamples([]), null);
  assert.equal(aimFromSamples([at(10, 10, 0), at(12, 11, 90)]), null);
  const right = aimFromSamples([at(0, 0, 0), at(60, 0, 60), at(240, 0, 120)]);
  assert.ok(Math.abs(right.angle) < 1e-9);
  assert.equal(right.power, 1);
  const down = aimFromSamples([at(0, 0, 0), at(0, 40, 200), at(0, 70, 400)]);
  assert.ok(Math.abs(down.angle - Math.PI / 2) < 1e-9);
  assert.ok(down.power >= MIN_POWER && down.power < 0.5, "arrasto lento é lançamento fraco");
  // Só o final do gesto conta: mudar de direção no fim muda a mira.
  const bent = aimFromSamples([at(0, 0, 0), at(200, 0, 500), at(200, 100, 560)]);
  assert.ok(Math.abs(bent.angle - Math.PI / 2) < 1e-9);
});

test("redução de movimento: sem animação o resultado já está na face certa", () => {
  const requests = v5Dice([8, 2, 10], 1);
  const thrown = simulateThrow(requests, 5);
  const last = thrown.frameCount - 1;
  // O quadro final é o mesmo que o modo reduzido desenha: dados parados na face sorteada.
  for (const track of thrown.tracks) assert.equal(landedValue(track), track.request.value);
  assert.ok(last > 0);
});

test("three, cannon-es e @types/three têm a mesma versão exata no web, no mobile e na raiz", () => {
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const manifests = [read("../package.json"), read("../../mobile/package.json"), read("../../package.json")];
  for (const name of ["three", "cannon-es", "@types/three"]) {
    const versions = manifests.map((manifest) => manifest.dependencies?.[name] ?? manifest.devDependencies?.[name]);
    assert.ok(versions.every((version) => /^\d+\.\d+\.\d+$/.test(version)), `${name} sem versão exata: ${versions}`);
    assert.equal(new Set(versions).size, 1, `${name} diverge: ${versions}`);
  }
});
