import assert from "node:assert/strict";
import { test } from "node:test";
import { lockedFieldIds, priorityPatch, priorityRules, tallyPriority } from "../lib/priority-points.ts";
import { masterGrantedFieldIds } from "../lib/sheet-creation.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";

const v3 = SYSTEM_STARTERS.find((item) => item.id === "vampire-v3");
const template = v3.template;
const rule = priorityRules(template)[0];
// Same sheet as backend/tests/test_priority_points.py: Brujah with exactly the free budgets spent.
const free = () => ({
  ...Object.fromEntries(Object.entries(v3.values).filter(([, value]) => value !== "")),
  forca: 4, destreza: 3, vigor: 3, carisma: 3, manipulacao: 3, aparencia: 2, percepcao: 2, inteligencia: 2, raciocinio: 2,
  prontidao: 3, esportes: 2, briga: 3, esquiva: 2, empatia: 2, expressao: 1,
  empatia_animais: 2, oficios: 2, conducao: 2, etiqueta: 1, armas_brancas: 2,
  academicos: 2, investigacao: 2, ocultismo: 1,
  cla: "Brujah", disc_rapidez: 1, disc_potencia: 1, disc_presenca: 1,
  ant_aliados: 2, ant_recursos: 2, ant_status: 1,
  consciencia: 3, autocontrole: 3, coragem: 4, humanidade: 6, forca_vontade: 4,
});
const FREEBIES = { ant_contatos: 4, disc_rapidez: 2, humanidade: 7, forca_vontade: 5, briga: 4 };
const sheet = () => ({ ...free(), ...FREEBIES });
const tally = (values) => tallyPriority(template, rule, values);

test("V3 starter is a priority_points sheet with the XP master-granted", () => {
  assert.equal(template.system_key, "vampire-v3");
  assert.equal(rule.freebies, 15);
  assert.deepEqual(rule.pools.map((pool) => [pool.id, pool.cost, pool.budgets]), [
    ["atributos", 5, [7, 5, 3]], ["habilidades", 2, [13, 9, 5]], ["disciplinas", 7, [3]], ["antecedentes", 1, [5]],
    ["virtudes", 2, [7]], ["humanidade", 1, [0]], ["vontade", 1, [0]],
  ]);
  assert.deepEqual([...masterGrantedFieldIds(template)], ["experiencia"]);
  assert.equal(template.fields.find((field) => field.id === "cla").identity_kind, "clan");
  assert.equal(template.fields.find((field) => field.id === "predador").identity_kind, "predator");
  assert.equal(template.fields.find((field) => field.id === "segredos").private, true);
});

test("the starting sheet owes every point; the exact budgets still leave 15 freebies", () => {
  assert.equal(tally(v3.values).complete, false);
  const open = tally(free());
  assert.equal(open.remaining, 15);
  assert.ok(open.problems.some((problem) => problem.includes("restam 15")));
  assert.equal(open.pools.every((pool) => pool.shortfall === 0 && pool.problems.length === 0), true);
});

test("freebies are bought at each pool's cost and must match exactly", () => {
  assert.equal(tally(sheet()).complete, true);
  assert.equal(tally({ ...sheet(), esquiva: 3 }).remaining, -2);
  assert.equal(tally({ ...sheet(), ant_contatos: 3 }).remaining, 1);
});

test("budgets match groups in any order", () => {
  // 3 physical, 7 social, 5 mental: the 7/5/3 budgets fit the groups in a different order.
  const reordered = { ...sheet(), forca: 2, destreza: 2, vigor: 2, carisma: 4, manipulacao: 4, aparencia: 2, percepcao: 3, inteligencia: 3, raciocinio: 2 };
  const attributes = tally(reordered).pools[0];
  assert.deepEqual(attributes.groups.map((group) => [group.spent, group.free]), [[3, 3], [7, 7], [5, 5]]);
  assert.equal(attributes.shortfall, 0);
  assert.equal(tally(reordered).remaining, tally(sheet()).remaining, "the order does not cost points: the total spent is what counts");
  // A group left at its base cannot cover any budget.
  const starved = { ...sheet(), forca: 1, destreza: 1, vigor: 1 };
  assert.ok(tally(starved).pools[0].shortfall > 0);
});
test("the clan decides which disciplines open, and Caitiff open them all", () => {
  assert.deepEqual([...lockedFieldIds(template, sheet())].filter((id) => id.startsWith("disc_")).sort(),
    ["disc_animalismo", "disc_auspicios", "disc_dominacao", "disc_fortitude", "disc_metamorfose", "disc_necromancia", "disc_obtenebracao", "disc_ofuscacao", "disc_quietus", "disc_quimerismo", "disc_serpentis", "disc_taumaturgia", "disc_vicissitude"]);
  assert.equal([...lockedFieldIds(template, { ...sheet(), cla: "Caitiff" })].some((id) => id.startsWith("disc_")), false);
  assert.equal([...lockedFieldIds(template, { ...sheet(), cla: "" })].filter((id) => id.startsWith("disc_")).length, 16);
  assert.ok(tally({ ...sheet(), disc_dominacao: 1 }).pools[2].problems.length > 0);
});

test("changing the clan resets disciplines that stay locked; virtues move humanity's base", () => {
  const after = { ...sheet(), cla: "Ventrue" };
  const patch = priorityPatch(template, sheet(), after);
  assert.equal(patch.disc_rapidez, 0);
  assert.equal(patch.disc_potencia, 0);
  const virtue = { ...sheet(), consciencia: 4 };
  const virtuePatch = priorityPatch(template, sheet(), virtue);
  assert.equal(virtuePatch.humanidade, 8, "humanity keeps its extra point over the new base of 7");
  assert.equal(virtuePatch.forca_vontade, undefined, "willpower follows courage only");
});

test("the backend fixture matches the V3 starter", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(await readFile(new URL("../../backend/tests/fixtures/v3_starter.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture, JSON.parse(JSON.stringify({ template, values: v3.values })), "regenerate backend/tests/fixtures/v3_starter.json from the starter");
});

