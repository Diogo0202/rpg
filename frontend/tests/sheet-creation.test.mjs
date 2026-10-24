import assert from "node:assert/strict";
import { test } from "node:test";
import { creationGroups, identityFields, masterGrantedFieldIds, validateField, validateFields } from "../lib/sheet-creation.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";
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
  assert.equal(SYSTEM_STARTERS.length, 3);
  for (const starter of SYSTEM_STARTERS) {
    assert.equal(starter.template.system_key, starter.id);
    assert.equal(starter.template.rules_profile_version, undefined);
    const name = starter.template.fields.find((item) => item.id === "nome");
    assert.equal(name.character_name, true);
  }
  assert.equal(SYSTEM_STARTERS[0].template.fields.find((item) => item.id === "cla").identity_kind, "clan");
  assert.equal(SYSTEM_STARTERS[0].template.fields.find((item) => item.id === "predador").identity_kind, "predator");
  assert.equal(SYSTEM_STARTERS[1].template.fields.find((item) => item.id === "credo").identity_kind, "creed");
  assert.equal(SYSTEM_STARTERS[2].template.fields.find((item) => item.id === "linhagem").identity_kind, "lineage");
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
