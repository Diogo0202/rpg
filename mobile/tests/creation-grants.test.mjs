import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { activeGrants, applyGrants, creationRuleViolations, grantChoiceFieldIds, grantProblems, grantedItems, powerRules, powerStatus, ruleMessage, staleGrantChoices } from "../src/lib/creation-grants.ts";
import { reconcileDependentValues } from "../src/lib/sheet-creation.ts";
import { SYSTEM_STARTERS } from "../src/lib/system-starters.ts";
import { poolBase, priorityPatch, priorityRules } from "../src/lib/priority-points.ts";

const v5 = SYSTEM_STARTERS.find((item) => item.id === "vampire-v5");
const template = v5.template;
// The web V5 starter as the server stores it (frontend/lib/system-starters.ts).
const fixture = JSON.parse(await readFile(new URL("../../backend/tests/fixtures/v5_starter.json", import.meta.url), "utf8"));
test("a criação local de Demônio confere prioridades e recalcula Vontade", () => {
  const demon = SYSTEM_STARTERS.find((item) => item.id === "demon-the-fallen");
  const rule = priorityRules(demon.template)[0];
  const willpower = rule.pools.find((pool) => pool.id === "vontade");
  const initial = { ...demon.values, consciencia: 3, conviccao: 2, coragem: 1, vontade_max: 5 };
  assert.equal(poolBase(willpower, initial), 5);
  assert.equal(priorityPatch(demon.template, initial, { ...initial, coragem: 4 }).vontade_max, 7);
  assert.deepEqual(creationRuleViolations(demon.template, demon.values).map((item) => item.id), ["criacao_demonio"]);
});
const base = () => ({ ...v5.values });
/** One wizard change: dependent selects reconcile, grants apply, stale picks drop. */
const pick = (values, changes, on = template) => {
  const after = reconcileDependentValues(on, { ...values, ...changes }).values;
  const granted = { ...after, ...applyGrants(on, values, after) };
  for (const id of staleGrantChoices(on, granted)) delete granted[id];
  return granted;
};
const violations = (on, values) => creationRuleViolations(on, values).map((rule) => rule.id).sort();

/** Brujah Blood Leech with valid attribute and skill spreads; the same build backend/tests/test_creation_grants.py accepts. */
function brujah(on = template, start = base()) {
  let values = { ...start };
  Object.assign(values, Object.fromEntries(["forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole", "inteligencia", "raciocinio", "resolucao"]
    .map((id, index) => [id, [4, 3, 3, 3, 2, 2, 2, 2, 1][index]])));
  Object.assign(values, Object.fromEntries(["atletismo", "briga", "conducao", "furtividade", "ladroagem", "oficios", "sobrevivencia", "armas_brancas", "armas_de_fogo", "etiqueta"]
    .map((id, index) => [id, [4, 3, 3, 3, 2, 2, 2, 1, 1, 1][index]])));
  values = pick(values, { cla: "Brujah" }, on);
  values = pick(values, { predador: "Sanguessuga" }, on);
  values = pick(values, { predador_disciplina: "Rapidez", predador_especialidade: "Briga (Membros)" }, on);
  return pick(values, { disciplinas: ["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Ligeireza"] }, on);
}

test("the mobile V5 starter carries the same grant and power rules as the web starter", () => {
  const ids = ["cla_disciplinas", "predador_bonus", "poderes", "rituais_iniciais", "atributos", "habilidades"];
  for (const id of ids) {
    assert.deepEqual(template.creation_rules.find((rule) => rule.id === id), fixture.template.creation_rules.find((rule) => rule.id === id), `rule ${id} drifted from the web starter`);
  }
  for (const field of ["caitiff_disciplina_1", "predador_disciplina", "predador_especialidade", "disc_rapidez", "rituais"]) {
    const mine = template.fields.find((item) => item.id === field);
    const web = fixture.template.fields.find((item) => item.id === field);
    assert.deepEqual({ ...mine, min: undefined, max: undefined }, { ...web, min: undefined, max: undefined }, `field ${field} drifted from the web starter`);
  }
});

test("choosing a clan puts one dot in each clan discipline and swapping clears the old ones", () => {
  const brujahValues = pick(base(), { cla: "Brujah" });
  assert.deepEqual([brujahValues.disc_potencia, brujahValues.disc_presenca, brujahValues.disc_rapidez], [1, 1, 1]);
  const gangrel = pick(brujahValues, { cla: "Gangrel" });
  assert.deepEqual([gangrel.disc_potencia, gangrel.disc_presenca, gangrel.disc_rapidez], [0, 0, 0]);
  assert.deepEqual([gangrel.disc_animalismo, gangrel.disc_fortitude, gangrel.disc_metamorfose], [1, 1, 1]);
});

test("a predator applies humanity, potency and items, and its discipline pick stacks on the clan", () => {
  let values = pick(base(), { cla: "Brujah", potencia_sangue: 1 });
  values = pick(values, { predador: "Sanguessuga" });
  assert.equal(values.humanidade, 6);
  assert.equal(values.potencia_sangue, 2);
  assert.ok(values.defeitos.includes("Exclusão de Presa: mortais ••"));
  assert.deepEqual(activeGrants(template, values).find((item) => item.rule.id === "predador_bonus").missing.map((choice) => choice.field), ["predador_disciplina", "predador_especialidade"]);
  values = pick(values, { predador_disciplina: "Rapidez", predador_especialidade: "Briga (Membros)" });
  assert.equal(values.disc_rapidez, 2);
  assert.ok(values.especialidades.includes("Briga (Membros)"));
  values = pick(values, { predador: "Consensualista" });
  assert.equal(values.predador_disciplina, undefined, "the old predator's pick is cleared with its dependent select");
  assert.equal(values.humanidade, 8);
  assert.equal(values.potencia_sangue, 1);
  assert.equal(values.disc_rapidez, 1);
  assert.equal(values.defeitos.includes("Exclusão de Presa: mortais ••"), false);
  assert.equal(values.especialidades.includes("Briga (Membros)"), false);
});

test("granted items stay listed while the player's own items are kept", () => {
  const values = pick(pick(base(), { cla: "Brujah", vantagens: ["Refúgio •"] }), { predador: "Gato de Beco" });
  assert.deepEqual(values.vantagens, ["Refúgio •", "Contatos criminosos •••"]);
  assert.deepEqual(grantedItems(template, values).get("vantagens"), ["Contatos criminosos •••"]);
});

test("clan-only predator disciplines need the right clan, and changing clan drops the stale pick", () => {
  const values = pick(base(), { cla: "Brujah", predador: "Ensacador", predador_disciplina: "Feitiçaria do Sangue" });
  assert.equal(values.disc_feiticaria, 0, "a Brujah cannot take Blood Sorcery from Bagger");
  assert.equal(values.predador_disciplina, undefined);
  const tremere = pick(base(), { cla: "Tremere", predador: "Ensacador", predador_disciplina: "Feitiçaria do Sangue" });
  assert.equal(tremere.disc_feiticaria, 2);
  const moved = pick(tremere, { cla: "Brujah" });
  assert.equal(moved.predador_disciplina, undefined);
  assert.equal(moved.disc_feiticaria, 0);
});

test("powers: one per dot, level up to the dots, amalgams need the other discipline", () => {
  const values = pick(pick(base(), { cla: "Nosferatu" }), { predador: "Homem-Areia", predador_disciplina: "Ofuscação" });
  const rule = powerRules(template).find((item) => item.id === "poderes");
  const obfuscate = powerStatus(rule, values).find((status) => status.source.label === "Ofuscação");
  assert.deepEqual([obfuscate.dots, obfuscate.allowed, obfuscate.maxLevel], [2, 2, 2]);
  assert.ok(obfuscate.available.every((power) => power.level <= 2));
  const animalism = powerStatus(rule, values).find((status) => status.source.label === "Animalismo");
  assert.equal(animalism.available.some((power) => power.name === "Colmeia Morta-Viva"), false);
  const labels = new Map(template.fields.map((field) => [field.id, field.label]));
  assert.ok(grantProblems(template, values, new Set(["disciplinas"]), labels).some((problem) => problem.includes("Ofuscação pede 2 escolhas")));
});

test("losing dots drops powers that are no longer allowed", () => {
  const values = pick(pick(base(), { cla: "Brujah", disciplinas: ["Potência: Corpo Letal", "Rapidez: Graça Felina"] }), { cla: "Gangrel" });
  assert.deepEqual(values.disciplinas, []);
});

test("the sorcerer gets exactly one level-1 ritual", () => {
  const rituals = powerStatus(powerRules(template).find((item) => item.id === "rituais_iniciais"), pick(base(), { cla: "Tremere" }))[0];
  assert.deepEqual([rituals.allowed, rituals.maxLevel], [1, 1]);
  assert.ok(rituals.available.every((ritual) => ritual.level === 1));
});

test("Caitiff pick three disciplines and the choice fields leave the grid", () => {
  const values = pick(base(), { cla: "Caitiff", caitiff_disciplina_1: "Fortitude", caitiff_disciplina_2: "Auspícios", caitiff_disciplina_3: "Rapidez" });
  assert.deepEqual([values.disc_fortitude, values.disc_auspicios, values.disc_rapidez], [1, 1, 1]);
  assert.ok(grantChoiceFieldIds(template).has("caitiff_disciplina_1"));
  assert.ok(grantChoiceFieldIds(template).has("predador_disciplina"));
});

test("a Brujah built through the mobile wizard passes the server's V5 template", () => {
  const values = brujah();
  assert.deepEqual(violations(template, values), []);
  assert.deepEqual(violations(fixture.template, values), [], "the web starter stored on the server accepts the mobile build");
  // A server template starts with no values; the wizard's first applyGrants fills the base.
  const empty = pick({}, {}, fixture.template);
  assert.equal(empty.humanidade, 7);
  assert.deepEqual(violations(fixture.template, brujah(fixture.template, { ...fixture.values })), []);
});

test("tampered values break the same rules the database names", () => {
  const cases = [
    [{ disc_dominacao: 1 }, ["cla_disciplinas", "poderes", "predador_bonus"]],
    [{ disc_rapidez: 3 }, ["cla_disciplinas", "poderes", "predador_bonus"]],
    [{ humanidade: 7 }, ["predador_bonus"]],
    // Not a Blood Leech option: the bonus dot is unaccounted for in every rule listing Rapidez.
    [{ predador_disciplina: "Dominação" }, ["cla_disciplinas", "predador_bonus"]],
    [{ predador_especialidade: undefined }, ["predador_bonus"]],
    [{ defeitos: [] }, ["predador_bonus"]],
    [{ disciplinas: ["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina"] }, ["poderes"]],
    [{ disciplinas: ["Potência: Proeza", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Ligeireza"] }, ["poderes"]],
    [{ disciplinas: ["Potência: Inventado", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Ligeireza"] }, ["poderes"]],
    [{ forca: 5 }, ["atributos"]],
    [{ atletismo: 0 }, ["habilidades"]],
  ];
  for (const [change, expected] of cases) {
    const values = { ...brujah(), ...change };
    for (const [id, value] of Object.entries(change)) if (value === undefined) delete values[id];
    assert.deepEqual(violations(fixture.template, values), expected, JSON.stringify(change));
  }
});

test("a Tremere needs one level-1 ritual and a clan-gated pick on the wrong clan is refused", () => {
  let values = pick(brujah(), { cla: "Tremere" });
  values = pick(values, { predador_disciplina: "Rapidez", disciplinas: ["Auspícios: Sentidos Aguçados", "Dominação: Compelir", "Feitiçaria do Sangue: Vitae Corrosiva", "Rapidez: Graça Felina"] });
  assert.equal(values.disc_rapidez, 1);
  assert.deepEqual(violations(fixture.template, values), ["rituais_iniciais"]);
  values = pick(values, { rituais: ["Feitiçaria do Sangue: Caminhada de Sangue"] });
  assert.deepEqual(violations(fixture.template, values), []);
  const forged = { ...values, cla: "Brujah" };
  assert.ok(violations(fixture.template, { ...brujah(), predador: "Ensacador", predador_disciplina: "Feitiçaria do Sangue", disc_feiticaria: 1 }).includes("predador_bonus"));
  assert.ok(violations(fixture.template, forged).includes("cla_disciplinas"));
});

test("violations read as Portuguese guidance", () => {
  const rule = fixture.template.creation_rules.find((item) => item.id === "atributos");
  assert.equal(ruleMessage(rule), "Atributos: distribua como Distribuição de atributos (1 em 4, 3 em 3, 4 em 2, 1 em 1).");
});
