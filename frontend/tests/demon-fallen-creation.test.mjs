import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { poolBase, priorityPatch, priorityRules, tallyPriority } from "../lib/priority-points.ts";
import { stepHelp } from "../lib/step-help.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";
import { SYSTEM_STARTERS as MOBILE_STARTERS } from "../../mobile/src/lib/system-starters.ts";

const demon = SYSTEM_STARTERS.find((item) => item.id === "demon-the-fallen");
const rule = priorityRules(demon.template)[0];
const virtues = rule.pools.find((pool) => pool.id === "virtudes");
const willpower = rule.pools.find((pool) => pool.id === "vontade");

test("Demônio: A Queda tem ficha e orçamentos separados de Shadow of the Demon Lord", () => {
  assert.equal(demon.template.system_key, "demon-the-fallen");
  assert.equal(demon.template.fields.length, 106);
  assert.deepEqual(rule.pools.map((pool) => pool.budgets), [[7, 5, 3], [13, 9, 5], [5], [3], [3], [0], [0]]);
  assert.equal(demon.template.fields.filter((field) => field.creation_step === "skills").length, 36);
  assert.equal(virtues.base, 1);
  assert.equal(stepHelp("demon-the-fallen", "attributes").includes("7, 5 e 3"), true);
});

test("Força de Vontade usa as duas maiores Virtudes e acompanha sua alteração", () => {
  const before = { ...demon.values, consciencia: 3, conviccao: 2, coragem: 1, vontade_max: 5 };
  assert.equal(poolBase(willpower, before), 5);
  const after = { ...before, coragem: 4 };
  assert.equal(poolBase(willpower, after), 7);
  assert.equal(priorityPatch(demon.template, before, after).vontade_max, 7);
  assert.equal(tallyPriority(demon.template, rule, before).complete, false);
});

test("backend e mobile têm o mesmo contrato de criação", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/demon_fallen_starter.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture, demon.template);
  const mobile = MOBILE_STARTERS.find((item) => item.id === "demon-the-fallen");
  assert.deepEqual(mobile.template.creation_rules, demon.template.creation_rules);
  assert.deepEqual(mobile.template.fields.map((field) => field.id), demon.template.fields.map((field) => field.id).filter((id) => id !== "experiencia" && id !== "segredos"));
  assert.equal(readFileSync(new URL("../../mobile/src/lib/demon-fallen-creation-data.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../lib/demon-fallen-creation-data.ts", import.meta.url), "utf8"));
});
