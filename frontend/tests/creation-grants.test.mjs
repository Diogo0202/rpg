import assert from "node:assert/strict";
import { test } from "node:test";
import { activeGrants, addHomebrewClan, applyGrants, grantChoiceFieldIds, grantProblems, grantedNumbers, parsePowerLines, powerStatus, powerRules, removeHomebrewClan } from "../lib/creation-grants.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";
import { V5_CLAN_CASES } from "../lib/v5-creation-data.ts";

const v5 = SYSTEM_STARTERS.find((item) => item.id === "vampire-v5");
const template = v5.template;
const base = () => ({ ...v5.values });
const pick = (values, changes) => {
  const after = { ...values, ...changes };
  return { ...after, ...applyGrants(template, values, after) };
};

test("V5 v2 chooses a distinct 2+1 clan pair and clears it when the clan changes", () => {
  const brujah = pick(base(), { cla: "Brujah", disciplina_inicial: "Potência 2, Presença 1" });
  assert.deepEqual([brujah.disc_potencia, brujah.disc_presenca, brujah.disc_rapidez], [2, 1, 0]);
  const gangrel = pick(brujah, { cla: "Gangrel", disciplina_inicial: "Animalismo 2, Fortitude 1" });
  assert.deepEqual([gangrel.disc_potencia, gangrel.disc_presenca, gangrel.disc_rapidez], [0, 0, 0]);
  assert.deepEqual([gangrel.disc_animalismo, gangrel.disc_fortitude, gangrel.disc_metamorfose], [2, 1, 0]);
});

test("a predator applies humanity, potency and items, and its discipline pick stacks on the clan", () => {
  let values = pick(base(), { cla: "Brujah", disciplina_inicial: "Potência 2, Presença 1", potencia_sangue: 1 });
  values = pick(values, { predador: "Sanguessuga" });
  assert.equal(values.humanidade, 6);
  assert.equal(values.potencia_sangue, 2);
  assert.ok(values.defeitos.includes("Exclusão de Presa: mortais ••"));
  assert.deepEqual(activeGrants(template, values).find((item) => item.rule.id === "predador_bonus").missing.map((choice) => choice.field), ["predador_disciplina", "predador_especialidade"]);
  values = pick(values, { predador_disciplina: "Rapidez", predador_especialidade: "Briga (Membros)" });
  assert.equal(values.disc_rapidez, 1);
  assert.ok(values.especialidades.includes("Briga (Membros)"));
  values = pick(values, { predador: "Consensualista", predador_disciplina: undefined, predador_especialidade: undefined });
  assert.equal(values.humanidade, 8);
  assert.equal(values.potencia_sangue, 1);
  assert.equal(values.disc_rapidez, 0);
  assert.equal(values.defeitos.includes("Exclusão de Presa: mortais ••"), false);
  assert.equal(values.especialidades.includes("Briga (Membros)"), false);
});

test("clan-only predator disciplines need the right clan", () => {
  const values = pick(base(), { cla: "Brujah", disciplina_inicial: "Potência 2, Presença 1", predador: "Ensacador", predador_disciplina: "Feitiçaria do Sangue" });
  assert.equal(values.disc_feiticaria, 0, "a Brujah cannot take Blood Sorcery from Bagger");
  const tremere = pick(base(), { cla: "Tremere", disciplina_inicial: "Dominação 2, Feitiçaria do Sangue 1", predador: "Ensacador", predador_disciplina: "Feitiçaria do Sangue" });
  assert.equal(tremere.disc_feiticaria, 2, "the predator stacks one dot on the chosen clan pair");
});

test("powers: one per dot, level up to the dots, amalgams need the other discipline", () => {
  const values = pick(pick(base(), { cla: "Nosferatu", disciplina_inicial: "Ofuscação 2, Animalismo 1" }), { predador: "Homem-Areia", predador_disciplina: "Ofuscação" });
  const rule = powerRules(template).find((item) => item.id === "poderes");
  const obfuscate = powerStatus(rule, values).find((status) => status.source.label === "Ofuscação");
  assert.deepEqual([obfuscate.dots, obfuscate.allowed, obfuscate.maxLevel], [3, 3, 3]);
  assert.ok(obfuscate.available.every((power) => power.level <= 3));
  const animalism = powerStatus(rule, values).find((status) => status.source.label === "Animalismo");
  assert.equal(animalism.available.some((power) => power.name === "Colmeia Morta-Viva"), false, "level 3 amalgam is out of reach at 1 dot");
  const labels = new Map(template.fields.map((field) => [field.id, field.label]));
  const problems = grantProblems(template, values, new Set(["disciplinas"]), labels);
  assert.ok(problems.some((problem) => problem.includes("Ofuscação pede 3 escolhas")));
});

test("losing dots drops powers that are no longer allowed", () => {
  let values = pick(base(), { cla: "Brujah", disciplinas: ["Potência: Corpo Letal", "Rapidez: Graça Felina"] });
  values = pick(values, { cla: "Gangrel" });
  assert.deepEqual(values.disciplinas, []);
});

test("the sorcerer gets exactly one level-1 ritual", () => {
  const values = pick(base(), { cla: "Tremere", disciplina_inicial: "Auspícios 2, Feitiçaria do Sangue 1" });
  const rituals = powerStatus(powerRules(template).find((item) => item.id === "rituais_iniciais"), values)[0];
  assert.deepEqual([rituals.allowed, rituals.maxLevel], [1, 1]);
  assert.ok(rituals.available.every((ritual) => ritual.level === 1));
});

test("Caitiff choose two distinct Disciplines with a 2+1 split", () => {
  const values = pick(base(), { cla: "Caitiff", disciplina_inicial: "Fortitude 2, Auspícios 1" });
  assert.deepEqual([values.disc_fortitude, values.disc_auspicios, values.disc_rapidez], [2, 1, 0]);
  assert.ok(grantChoiceFieldIds(template).has("disciplina_inicial"));
  assert.ok(grantChoiceFieldIds(template).has("predador_disciplina"));
});

test("the prior V1 clan rule still grants the three clan Disciplines at one dot", () => {
  const legacy = structuredClone(template);
  legacy.creation_rules.find((rule) => rule.id === "cla_disciplinas").cases = V5_CLAN_CASES;
  const values = { ...base(), cla: "Brujah" };
  assert.deepEqual([...grantedNumbers(legacy, values).enforced.entries()].filter(([id, dots]) => id.startsWith("disc_") && dots > 0), [
    ["disc_potencia", 1], ["disc_presenca", 1], ["disc_rapidez", 1],
  ]);
});

test("a homebrew clan with a new discipline is created, granted and removable", () => {
  const homebrew = addHomebrewClan(template, {
    name: "Filhos da Fuligem",
    disciplines: ["disc_fortitude", "disc_ofuscacao"],
    newDisciplines: [{ label: "Vapor Rubro", powers: parsePowerLines("1 | Névoa de Brasas\n2 | Pulmões de Ferro\nsem nível"), rituals: parsePowerLines("1 | Selo da Caldeira") }],
  });
  const field = homebrew.fields.find((item) => item.id === "disc_vapor_rubro");
  assert.deepEqual([field.min, field.max, field.creation_step], [0, 5, "traits"]);
  assert.ok(homebrew.fields.find((item) => item.id === "cla").options.includes("Filhos da Fuligem"));
  const values = { ...v5.values, cla: "Filhos da Fuligem" };
  const { enforced } = grantedNumbers(homebrew, values);
  assert.deepEqual([enforced.get("disc_vapor_rubro"), enforced.get("disc_fortitude"), enforced.get("disc_ofuscacao")], [1, 1, 1]);
  const steam = powerStatus(powerRules(homebrew).find((item) => item.id === "poderes"), { ...values, disc_vapor_rubro: 1 }).find((status) => status.source.label === "Vapor Rubro");
  assert.deepEqual(steam.available.map((power) => power.name), ["Névoa de Brasas"]);
  assert.ok(powerRules(homebrew).find((item) => item.id === "rituais_iniciais").sources.some((source) => source.label === "Vapor Rubro"));
  assert.throws(() => addHomebrewClan(homebrew, { name: "Filhos da Fuligem", disciplines: ["disc_fortitude"], newDisciplines: [] }), /Já existe/);
  const removed = removeHomebrewClan(homebrew, "Filhos da Fuligem");
  assert.equal(removed.fields.some((item) => item.id === "disc_vapor_rubro"), false);
  assert.equal(removed.fields.find((item) => item.id === "cla").options.includes("Filhos da Fuligem"), false);
  assert.ok(removed.fields.some((item) => item.id === "disc_fortitude"), "official disciplines stay");
});

test("the narrator can open the advantage catalog to homebrew names", async () => {
  const { allowHomebrew } = await import("../lib/creation-grants.ts");
  const labels = new Map(template.fields.map((field) => [field.id, field.label]));
  const values = { ...base(), vantagens: ["Pacto Antigo ••", "Aliados •••••"] };
  const closed = grantProblems(template, values, new Set(["vantagens"]), labels);
  assert.ok(closed.some((problem) => problem.includes("Pacto Antigo •• fora do catálogo")));
  const open = allowHomebrew(template, "vantagens_pontos", true);
  assert.equal(grantProblems(open, values, new Set(["vantagens"]), labels).some((problem) => problem.includes("fora do catálogo")), false);
  assert.ok(grantProblems(open, { ...values, vantagens: ["Bela •"] }, new Set(["vantagens"]), labels).some((problem) => problem.includes("Bela aceita 2 pontos")),
    "catalog costs still apply to listed names");
});

test("removing a homebrew clan keeps the catalog, range and specialty rules", () => {
  const homebrew = addHomebrewClan(template, { name: "Filhos da Fuligem", disciplines: ["disc_fortitude"], newDisciplines: [] });
  const ids = removeHomebrewClan(homebrew, "Filhos da Fuligem").creation_rules.map((rule) => rule.id);
  for (const id of ["defeitos_pontos", "cla_geracao", "especializacoes"]) assert.ok(ids.includes(id), id);
});

test("the backend fixture matches the V5 starter", async () => {
  const { readFile } = await import("node:fs/promises");
  const fixture = JSON.parse(await readFile(new URL("../../backend/tests/fixtures/v5_starter.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture, JSON.parse(JSON.stringify({ template, values: v5.values })), "regenerate backend/tests/fixtures/v5_starter.json from the starter");
});
