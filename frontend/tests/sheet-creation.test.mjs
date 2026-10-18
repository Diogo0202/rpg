import assert from "node:assert/strict";
import { test } from "node:test";
import { creationGroups, identityFields, validateField, validateFields } from "../lib/sheet-creation.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";

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
