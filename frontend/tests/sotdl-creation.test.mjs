import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { applyGrants, grantProblems } from "../lib/creation-grants.ts";
import { themeForSystem } from "../lib/map-kits.ts";
import { stepHelp } from "../lib/step-help.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";
import { SYSTEM_STARTERS as MOBILE_STARTERS } from "../../mobile/src/lib/system-starters.ts";

const sotdl = SYSTEM_STARTERS.find((item) => item.id === "shadow-demon-lord");
const template = sotdl.template;
const fields = Object.fromEntries(template.fields.map((field) => [field.id, field]));
const pick = (values, changes) => {
  const after = { ...values, ...changes };
  return { ...after, ...applyGrants(template, values, after) };
};
const ids = new Set(template.fields.map((field) => field.id));
const labels = new Map(template.fields.map((field) => [field.id, field.label]));

test("SotDL starter tem atributos 1-20, modificadores, recursos e fervor", () => {
  assert.equal(template.system_key, "shadow-demon-lord");
  assert.equal(new Set(template.fields.map((field) => field.id)).size, template.fields.length);
  for (const id of ["forca", "agilidade", "intelecto", "vontade"]) {
    assert.deepEqual([fields[id].min, fields[id].max, fields[id].creation_step], [1, 20, "attributes"]);
    assert.equal(fields[`mod_${id}`].expression, `${id} - 10`);
  }
  assert.equal(fields.defesa.expression, "agilidade + bonus_defesa");
  assert.equal(fields.ancestralidade.identity_kind, "race");
  assert.equal(fields.ancestralidade.required, true);
  assert.deepEqual(template.meta_currencies, [{ id: "fervor", label: "Pontos de Fervor", field: "fervor", mode: "pool", max_field: "fervor_max" }]);
  assert.deepEqual(fields.aflicoes.options, ["Assustado", "Debilitado", "Lento", "Atordoado"]);
});

test("ancestralidade preenche atributos e bônus, e trocar desfaz a anterior", () => {
  const goblin = pick({ ...sotdl.values }, { ancestralidade: "Goblin" });
  assert.deepEqual([goblin.forca, goblin.agilidade, goblin.intelecto, goblin.vontade, goblin.bonus_percepcao], [8, 12, 10, 9, 1]);
  assert.deepEqual(grantProblems(template, goblin, ids, labels), []);
  const dwarf = pick(goblin, { ancestralidade: "Anão" });
  assert.deepEqual([dwarf.forca, dwarf.agilidade, dwarf.bonus_saude, dwarf.bonus_percepcao, dwarf.deslocamento], [10, 9, 4, 1, 8]);
});

test("Humano pede o atributo +1 e o aplica", () => {
  let human = pick({ ...sotdl.values }, { ancestralidade: "Humano" });
  assert.ok(grantProblems(template, human, ids, labels).some((problem) => problem.includes("atributo +1")));
  human = pick(human, { ancestralidade_atributo: "Vontade +1" });
  assert.equal(human.vontade, 11);
  assert.deepEqual(grantProblems(template, human, ids, labels), []);
});

test("ajuda por passo e kit de mapa do SotDL", () => {
  assert.match(stepHelp("shadow-demon-lord", "identity"), /ancestralidade/);
  assert.ok(stepHelp("hunter", "attributes"));
  assert.equal(stepHelp("vampire-v5", "identity"), undefined);
  assert.equal(themeForSystem("shadow-demon-lord"), "medieval");
});

test("fixture SotDL validada pelo backend corresponde ao starter e o mobile espelha a regra", () => {
  const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/sotdl_starter.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture, template);
  const mobile = MOBILE_STARTERS.find((item) => item.id === "shadow-demon-lord");
  assert.deepEqual(mobile.template.creation_rules, template.creation_rules);
  const webIds = template.fields.map((field) => field.id).filter((id) => id !== "experiencia");
  assert.deepEqual(mobile.template.fields.map((field) => field.id), webIds);
  const mobileData = readFileSync(new URL("../../mobile/src/lib/sotdl-creation-data.ts", import.meta.url), "utf8");
  assert.equal(mobileData, readFileSync(new URL("../lib/sotdl-creation-data.ts", import.meta.url), "utf8"));
});
