import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { validateField, validateFields } from "../lib/sheet-creation.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";
import { SYSTEM_STARTERS as MOBILE_STARTERS } from "../../mobile/src/lib/system-starters.ts";
import { hunterTraitProblems, isLegacyHunterSheet, migrateHunterTraits, splitPillar } from "../lib/hunter-traits.ts";
import { migrateOneRing, ONE_RING_CULTURES, oneRingDerived, oneRingProblems, oneRingStates } from "../lib/one-ring-rules.ts";

const hunter = SYSTEM_STARTERS.find((item) => item.id === "hunter").template;
const oneRing = SYSTEM_STARTERS.find((item) => item.id === "one-ring").template;
const fieldsOf = (template) => Object.fromEntries(template.fields.map((field) => [field.id, field]));

test("Caçador v3 replaces free Pilares with paired, limited texts", () => {
  const fields = fieldsOf(hunter);
  assert.equal(fields.pilares, undefined);
  assert.deepEqual([fields.conviccao_1.max_length, fields.pedra_toque_1.max_length, fields.redencao.max_length], [160, 120, 240]);
  assert.equal(fields.conviccao_1.required, true);
  assert.equal(fields.conviccao_2.required, false);
  assert.equal(fields.em_desespero.kind, "checkbox");
  assert.deepEqual([fields.desespero.min, fields.desespero.max], [0, 5]);
  const pair = [fields.conviccao_2, fields.pedra_toque_2];
  assert.deepEqual(validateFields(pair, { conviccao_2: "Proteger" }, hunter), { conviccao_2: "Preencha também Pedra de Toque 2." });
  assert.deepEqual(validateFields(pair, { conviccao_2: "Proteger", pedra_toque_2: "Clara" }, hunter), {});
  assert.equal(validateField(fields.conviccao_1, "x".repeat(161)).valid, false);
});

test("legacy Hunter values migrate like the backend", () => {
  assert.deepEqual(splitPillar("Irmã Clara: protejo inocentes"), ["Irmã Clara", "protejo inocentes"]);
  assert.deepEqual(splitPillar("Nunca mentir (Padre Tomás)"), ["Padre Tomás", "Nunca mentir"]);
  assert.deepEqual(splitPillar("Só uma frase"), ["", "Só uma frase"]);
  const legacy = { credo: "inquisitivo", impulso: "vinganca", redencao: "x".repeat(300), notas: "antigas",
    pilares: ["Irmã Clara: protejo inocentes", "Nunca mentir (Padre Tomás)", "Só uma frase", "Quarto pilar"] };
  assert.equal(isLegacyHunterSheet(legacy), true);
  const { values, warnings } = migrateHunterTraits(legacy);
  assert.equal(values.credo, "Inquisitivo");
  assert.equal(values.impulso, "Vingança");
  assert.equal(values.redencao.length, 240);
  assert.ok(values.notas.startsWith("antigas") && values.notas.includes("Pilar excedente: Quarto pilar"));
  assert.ok(warnings.includes("Convicção 3 ficou sem Pedra de Toque"));
  assert.ok(hunterTraitProblems(values).includes("Par 3: preencha Convicção e Pedra de Toque juntas"));
  assert.equal(isLegacyHunterSheet(values), false);
  assert.deepEqual(hunterTraitProblems({ credo: "Marcial", impulso: "Juramento", conviccao_1: "a", pedra_toque_1: "b" }), []);
});

test("O Um Anel v2 carries the specific rules and the fixture matches", () => {
  const fields = fieldsOf(oneRing);
  assert.equal(oneRing.version, 2);
  assert.equal(fields.tn_corpo.expression, "20 - corpo");
  assert.equal(fields.vigor_max.expression, "corpo + base_vigor");
  assert.deepEqual(fields.pericias_favorecidas.item_options.length, 18);
  assert.equal(fields.pericias_favorecidas.max_items, 3);
  assert.deepEqual(oneRing.creation_rules.map((rule) => rule.id), ["atributos", "cultura"]);
  const fixture = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/one_ring_starter.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture, JSON.parse(JSON.stringify(oneRing)), "regenerate backend/tests/fixtures/one_ring_starter.json from the starter");
  const mobile = MOBILE_STARTERS.find((item) => item.id === "one-ring").template;
  assert.deepEqual(mobile.creation_rules, oneRing.creation_rules);
  assert.deepEqual(mobile.fields.map((field) => field.id), oneRing.fields.map((field) => field.id).filter((id) => id !== "experiencia"));
});

test("O Um Anel derived values, states and problems", () => {
  const values = { linhagem: "Hobbits do Condado", corpo: 3, coracao: 6, astucia: 5, base_vigor: 18, base_esperanca: 10, base_aparar: 12,
    bonus_escudo: 1, vigor_marcha: 15, esperanca: 4, carga: 10, cansaco: 5, sombra: 3, cicatrizes: 1, pericias_favorecidas: ["Furtividade"] };
  assert.deepEqual(oneRingDerived(values), { tn_corpo: 17, tn_coracao: 14, tn_astucia: 15, vigor_max: 21, esperanca_max: 16, aparar: 18, carga_total: 15, sombra_total: 4 });
  assert.deepEqual(oneRingStates(values), { cansado: true, miseravel: true, ferido: false, surto: false, inconsciente: false });
  assert.deepEqual(oneRingProblems(values), []);
  assert.ok(oneRingProblems({ ...values, corpo: 7 }).some((item) => item.includes("somam 18")));
  const migrated = migrateOneRing({ forca: 4, coracao: 5, espirito: 5, linhagem: "Bardeses" });
  assert.deepEqual([migrated.values.corpo, migrated.values.astucia, migrated.values.base_vigor], [4, 5, ONE_RING_CULTURES.Bardeses[0]]);
});
