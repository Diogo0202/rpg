import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { estimateV5Probabilities } from "../src/lib/v5-probability.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("offline probabilities match the Python engine across Hunger and reroll choices", () => {
  const cases = [];
  for (let pool = 0; pool <= 4; pool++)
    for (let hunger = 0; hunger <= pool; hunger++)
      for (const difficulty of [1, 2, 4, 6])
        for (let cap = 0; cap <= 3; cap++) cases.push([pool, hunger, difficulty, cap]);
  cases.push([6, 3, 4, 3], [30, 5, 8, 3], [30, 0, 100, 3]);
  const venv = path.join(root, "backend/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.RPG_PYTHON ?? (existsSync(venv) ? venv : "python");
  const result = spawnSync(python, ["-c", "import sys,json; from dataclasses import asdict; from app.services.v5_probability import estimate_probabilities; print(json.dumps([asdict(estimate_probabilities(*args)) for args in json.load(sys.stdin)]))"], {
    cwd: path.join(root, "backend"), input: JSON.stringify(cases), encoding: "utf8", timeout: 60000,
  });
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const expected = JSON.parse(result.stdout);
  cases.forEach((args, index) => {
    const actual = estimateV5Probabilities(...args);
    for (const mode of ["without_reroll", "with_reroll"])
      for (const event of ["success", "messy_critical", "bestial_failure"])
        assert.ok(Math.abs(actual[mode][event] - expected[index][mode][event]) < 1e-12,
          `${args}: ${mode}.${event}: ${actual[mode][event]} != ${expected[index][mode][event]}`);
  });
});
