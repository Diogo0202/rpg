import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { creationGroups, distributionRulesFor, identityFields, masterGrantedFieldIds, matchingDistribution, tallyDistribution, validateField, validateFields } from "../lib/sheet-creation.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";
import { SYSTEM_STARTERS as MOBILE_STARTERS } from "../../mobile/src/lib/system-starters.ts";
import { narratorOnlyDetails, publicGeneratedEntry } from "../lib/generated-content.ts";

test("XP and pool currencies are master-granted, tracks are not", () => {
  const oneRing = SYSTEM_STARTERS.find((starter) => starter.id === "one-ring").template;
  assert.deepEqual([...masterGrantedFieldIds(oneRing)].sort(), ["esperanca", "experiencia"]);
  const vampire = SYSTEM_STARTERS.find((starter) => starter.id === "vampire-v5").template;
  assert.deepEqual([...masterGrantedFieldIds(vampire)], ["experiencia"]);
});

test("generated entries drop narrator-only details before reaching the world library", () => {
  const entry = { kind: "npc", name: "Iara", summary: "s", seed: 1, details: { goal: "g", secret: "x", story_hook: "revela x", weakness: "w", encounter_hook: "evita w" } };
  assert.deepEqual(publicGeneratedEntry(entry).details, { goal: "g" });
  assert.deepEqual(Object.keys(narratorOnlyDetails(entry.details)), ["secret", "story_hook", "weakness", "encounter_hook"]);
  assert.equal(entry.details.secret, "x", "the original entry is not mutated");
});

const field = (id, kind = "text", overrides = {}) => ({
  id,
  label: id,
  kind,
  required: false,
  options: [],
  expression: null,
  ...overrides,
});
const template = (fields) => ({ name: "Teste", version: 1, fields });

test("grupos seguem a ordem declarada e campos sem metadata vão para Outros", () => {
  const schema = template([
    field("livre_1"),
    field("atributo", "number", { creation_step: "attributes" }),
    field("livre_2", "text", { creation_step: "etapa_desconhecida" }),
    field("nome", "text", { required: true, character_name: true, creation_step: "identity" }),
    field("cla", "select", { options: ["Brujah"], creation_step: "identity", identity_kind: "clan" }),
    field("some", "text", { creation_step: "unknown" }),
  ]);
  const groups = creationGroups(schema);
  assert.deepEqual(groups.map(({ step }) => step), ["attributes", "other"]);
  assert.deepEqual(groups[0].fields.map(({ id }) => id), ["atributo"]);
  assert.deepEqual(groups[1].fields.map(({ id }) => id), ["livre_1", "livre_2", "some"]);
  assert.deepEqual(identityFields(schema).map(({ id }) => id), ["cla"]);
});

test("não cria etapa vazia nem duplica o campo canônico do nome", () => {
  const schema = template([
    field("nome", "text", { required: true }),
    field("recurso", "number", { creation_step: "resources" }),
  ]);
  const groups = creationGroups(schema);
  assert.deepEqual(groups.map(({ step }) => step), ["resources"]);
  assert.equal(groups.flatMap(({ fields }) => fields).some(({ id }) => id === "nome"), false);
});

test("valida tipos, obrigatoriedade e opções do select", () => {
  const number = field("forca", "number", { required: true });
  const select = field("cla", "select", { required: true, options: ["Brujah", "Nosferatu"] });
  const checkbox = field("marca", "checkbox");
  const collection = field("itens", "collection");
  assert.deepEqual(validateFields([number, select], { forca: "forte", cla: "Toreador" }), {
    forca: "Informe um número válido.",
    cla: "Escolha uma das opções disponíveis.",
  });
  assert.equal(validateField(number, 0).valid, true);
  assert.equal(validateField(select, "Brujah").valid, true);
  assert.equal(validateField(checkbox, "sim").valid, false);
  assert.equal(validateField(collection, [2]).valid, false);
});

test("fórmulas e rolagens são somente leitura na validação", () => {
  const formula = field("total", "formula", { required: true, expression: "forca + 1" });
  const roll = field("teste", "roll", { required: true, expression: "2d6+3" });
  assert.equal(validateField(formula, "valor adulterado").valid, true);
  assert.equal(validateField(roll, 14).valid, true);
});

test("starters têm system_key e metadata explícita de identidade e nome", () => {
  assert.ok(SYSTEM_STARTERS.length >= 3);
  for (const starter of SYSTEM_STARTERS) {
    assert.equal(starter.template.system_key, starter.id);
    assert.equal(starter.template.rules_profile_version, undefined);
    const name = starter.template.fields.find((item) => item.id === "nome");
    assert.equal(name.character_name, true);
  }
  assert.equal(SYSTEM_STARTERS[0].template.fields.find((item) => item.id === "cla").identity_kind, "clan");
  assert.equal(SYSTEM_STARTERS[0].template.fields.find((item) => item.id === "predador").identity_kind, "predator");
  assert.equal(SYSTEM_STARTERS.find((item) => item.id === "hunter").template.fields.find((item) => item.id === "credo").identity_kind, "creed");
  assert.equal(SYSTEM_STARTERS.find((item) => item.id === "one-ring").template.fields.find((item) => item.id === "linhagem").identity_kind, "lineage");
});

test("V5 starter carries creation arithmetic, field limits and private fields", () => {
  const v5 = SYSTEM_STARTERS.find((item) => item.id === "vampire-v5");
  const rules = Object.fromEntries(v5.template.creation_rules.map((rule) => [rule.id, rule]));
  assert.equal(rules.atributos.fields.length, 9);
  assert.deepEqual(rules.atributos.options[0].counts, { 4: 1, 3: 3, 2: 4, 1: 1 });
  assert.equal(rules.habilidades.fields.length, 27);
  for (const option of rules.habilidades.options) {
    assert.ok(Object.values(option.counts).reduce((sum, count) => sum + count, 0) <= 27);
  }
  const fields = Object.fromEntries(v5.template.fields.map((field) => [field.id, field]));
  assert.deepEqual([fields.forca.min, fields.forca.max], [1, 5]);
  assert.deepEqual([fields.fome.min, fields.fome.max], [0, 5]);
  assert.equal(fields.compulsao_atual.private, true);
  assert.equal(fields.segredos.private, true);
  assert.equal(fields.nome.private, undefined);
});

const v5Template = SYSTEM_STARTERS.find((item) => item.id === "vampire-v5").template;
const v5Rule = (id) => v5Template.creation_rules.find((rule) => rule.id === id);
const assign = (ids, numbers) => Object.fromEntries(ids.map((id, index) => [id, numbers[index] ?? 0]));

test("Caçador v2 inclui os nove atributos e as 27 habilidades sem duplicar IDs", () => {
  const hunter = SYSTEM_STARTERS.find((item) => item.id === "hunter");
  assert.equal(hunter.template.version, 2);
  const rules = Object.fromEntries(hunter.template.creation_rules.map((rule) => [rule.id, rule]));
  assert.equal(rules.atributos.fields.length, 9);
  assert.equal(rules.habilidades.fields.length, 27);
  assert.deepEqual(rules.atributos.options[0].counts, { 4: 1, 3: 3, 2: 4, 1: 1 });
  assert.equal(new Set(hunter.template.fields.map((field) => field.id)).size, hunter.template.fields.length);
  assert.equal(hunter.template.fields.find((field) => field.id === "politica").creation_step, "skills");
  assert.equal(hunter.template.fields.find((field) => field.id === "empatia").label, "Sagacidade");
  assert.equal(hunter.template.fields.find((field) => field.id === "credo").required, true);
  assert.equal(hunter.template.fields.find((field) => field.id === "impulso").options.length, 7);
  assert.ok(hunter.template.fields.some((field) => field.id === "triunfos"));
  assert.ok(hunter.template.fields.some((field) => field.id === "pilares"));
});

test("fixture de Caçador validada pelo backend corresponde ao modelo publicado pelo frontend", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/hunter_starter.json", import.meta.url), "utf8"));
  const hunter = SYSTEM_STARTERS.find((item) => item.id === "hunter");
  assert.deepEqual(fixture, hunter.template);
  const mobile = MOBILE_STARTERS.find((item) => item.id === "hunter");
  assert.deepEqual(mobile.template.creation_rules, hunter.template.creation_rules);
  assert.equal(mobile.template.fields.filter((field) => field.creation_step === "skills").length, 27);
});

test("Caçador aceita cada modo exato e detecta sobra, falta e o antigo recorte de nove habilidades", () => {
  const hunter = SYSTEM_STARTERS.find((item) => item.id === "hunter");
  const rule = hunter.template.creation_rules.find((rule) => rule.id === "habilidades");
  assert.deepEqual(rule.options.map((option) => option.label), ["Especialista", "Pau para toda obra", "Equilibrado"]);
  for (const [index, option] of rule.options.entries()) {
    const dots = Object.entries(option.counts).flatMap(([value, count]) => Array(count).fill(Number(value)));
    const values = assign(rule.fields, dots);
    assert.equal(tallyDistribution(rule, option, values).complete, true);
    assert.equal(matchingDistribution(rule, values), index);
    values[rule.fields.at(-1)] = 5;
    assert.equal(tallyDistribution(rule, option, values).complete, false);
  }
  assert.equal(matchingDistribution(rule, assign(rule.fields.slice(0, 9), [4, 3, 3, 3, 2, 2, 2, 1, 1])), -1);
});

test("V5 skill modes come in the order Especialista, Pau para toda obra, Equilibrado", () => {
  assert.deepEqual(v5Rule("habilidades").options.map((option) => option.label), ["Especialista", "Pau para toda obra", "Equilibrado"]);
  assert.deepEqual(distributionRulesFor(v5Template, ["briga"]).map((rule) => rule.id), ["habilidades"]);
});

test("attribute tally counts what is left of 4/3/3/3/2/2/2/2/1", () => {
  const rule = v5Rule("atributos");
  const fresh = tallyDistribution(rule, rule.options[0], assign(rule.fields, Array(9).fill(1)));
  assert.equal(fresh.complete, false);
  assert.deepEqual(fresh.slots.map(({ value, need, have }) => [value, need, have]), [[4, 1, 0], [3, 3, 0], [2, 4, 0], [1, 1, 9]]);
  const done = tallyDistribution(rule, rule.options[0], assign(rule.fields, [4, 3, 3, 3, 2, 2, 2, 2, 1]));
  assert.equal(done.complete, true);
  const outside = tallyDistribution(rule, rule.options[0], assign(rule.fields, [5, 3, 3, 3, 2, 2, 2, 2, 1]));
  assert.deepEqual(outside.outside, [rule.fields[0]]);
});

test("skill tally fills the rest with zero and spots excess", () => {
  const rule = v5Rule("habilidades");
  const specialist = assign(rule.fields, [4, 3, 3, 3, 2, 2, 2, 1, 1, 1]);
  const tally = tallyDistribution(rule, rule.options[0], specialist);
  assert.equal(tally.complete, true);
  assert.deepEqual(tally.slots.at(-1), { value: 0, need: 17, have: 17, rest: true });
  assert.equal(matchingDistribution(rule, specialist), 0);
  const over = tallyDistribution(rule, rule.options[0], assign(rule.fields, [4, 4]));
  assert.deepEqual(over.slots[0], { value: 4, need: 1, have: 2, rest: false });
  const balanced = assign(rule.fields, [3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(matchingDistribution(rule, balanced), 2);
  assert.equal(matchingDistribution(rule, assign(rule.fields, [])), -1);
});
