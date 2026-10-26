import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { applyGrants, creationRuleViolations, grantProblems, itemPoints } from "../src/lib/creation-grants.ts";
import { tallyPriority, priorityRules } from "../src/lib/priority-points.ts";
import { SYSTEM_STARTERS } from "../src/lib/system-starters.ts";

const read = async (name) => JSON.parse(await readFile(new URL(`../../backend/tests/fixtures/${name}.json`, import.meta.url), "utf8"));
// Web starters as the server stores them, and the sheets the web wizard builds (frontend/tests/vampire-creation-flow.test.mjs).
const web = { v5: (await read("v5_starter")).template, v3: (await read("v3_starter")).template };
const sheets = await read("vampire_wizard_sheets");
const starter = (id) => SYSTEM_STARTERS.find((item) => item.id === id);
const violated = (template, values) => creationRuleViolations(template, values).map((rule) => rule.id).sort();

test("os modelos V5 e V3 do mobile têm as mesmas regras de criação da web", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(starter("vampire-v5").template.creation_rules)), web.v5.creation_rules);
  assert.deepEqual(JSON.parse(JSON.stringify(starter("vampire-v3").template.creation_rules)), web.v3.creation_rules);
  assert.equal(starter("vampire-v5").values.potencia_sangue, 1);
});

test("as fichas montadas pelo assistente web passam nas regras locais", () => {
  assert.deepEqual(violated(web.v5, sheets.v5.values), []);
  assert.deepEqual(violated(web.v3, sheets.v3.values), []);
  assert.equal(tallyPriority(web.v3, priorityRules(web.v3)[0], sheets.v3.values).complete, true);
});

test("V5 offline recusa o que o servidor recusa: Potência por geração, Vantagens e Defeitos", () => {
  const values = sheets.v5.values;
  assert.deepEqual(violated(web.v5, { ...values, potencia_sangue: 3 }), ["predador_bonus"]);
  // Outside the bands, and outside the clan's starting generations too.
  assert.deepEqual(violated(web.v5, { ...values, geracao: 9 }), ["cla_geracao", "predador_bonus"]);
  assert.deepEqual(violated(web.v5, { ...values, recursos: 2 }), ["vantagens_pontos"]);
  assert.deepEqual(violated(web.v5, { ...values, vantagens: [...values.vantagens, "Mawla"] }), ["vantagens_pontos"]);
  assert.deepEqual(violated(web.v5, { ...values, defeitos: values.defeitos.filter((item) => item !== "Vício Irremediável ••") }), ["defeitos_pontos"]);
  const labels = new Map(web.v5.fields.map((field) => [field.id, field.label]));
  assert.ok(grantProblems(web.v5, { ...values, geracao: 9 }, new Set(["geracao"]), labels).some((problem) => problem.includes("fora das faixas")));
});

test("trocar a geração recalcula a Potência e o predador continua somando", () => {
  const values = sheets.v5.values;
  const older = { ...values, geracao: 11 };
  assert.equal(applyGrants(web.v5, values, older).potencia_sangue, 3);
  assert.deepEqual([itemPoints("Aliados •••"), itemPoints("Refúgio (2)"), itemPoints("Mawla")], [3, 2, 0]);
});

test("V3 offline recusa pontos fora das prioridades", () => {
  assert.deepEqual(violated(web.v3, { ...sheets.v3.values, forca: 5 }), ["criacao_v3"]);
  assert.deepEqual(violated(web.v3, { ...sheets.v3.values, ant_contatos: 3 }), ["criacao_v3"]);
});
