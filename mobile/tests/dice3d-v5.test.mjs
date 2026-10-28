import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { v5Dice, canThrowV5 } from "../../shared/dice3d/v5.ts";
import { aimFromSamples } from "../../shared/dice3d/aim.ts";
import { landedValue, simulateThrow } from "../../shared/dice3d/simulate.ts";

// O app mobile usa o mesmo motor 3D do web (shared/dice3d, via alias @dice3d). A suíte completa
// está em frontend/tests/dice3d.test.mjs; aqui ficam as garantias que o mobile depende.
test("mobile consome o motor compartilhado: dados de Fome primeiro e pouso na face sorteada", () => {
  const requests = v5Dice([9, 10, 4, 1], 2);
  assert.deepEqual(requests.map((request) => request.role), ["hunger", "hunger", "main", "main"]);
  const thrown = simulateThrow(requests, 7, aimFromSamples([{ x: 0, y: 0, t: 0 }, { x: 150, y: 20, t: 100 }]));
  for (const track of thrown.tracks) assert.equal(landedValue(track), track.request.value);
  assert.equal(canThrowV5(16), false);
});

test("mobile fixa a mesma versão de three e cannon-es do restante do repositório", () => {
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const mobile = read("../package.json");
  const root = read("../../package.json");
  for (const name of ["three", "cannon-es"]) assert.equal(mobile.dependencies[name], root.devDependencies[name]);
});
