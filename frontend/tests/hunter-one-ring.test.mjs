import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { validateField, validateFields } from "../lib/sheet-creation.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";
import { SYSTEM_STARTERS as MOBILE_STARTERS } from "../../mobile/src/lib/system-starters.ts";
import { desperationChoices, HUNTER_EDGE_NAMES, HUNTER_PERKS, hunterCreationProblems, hunterV5CreationProblems, hunterEdgeProblems, hunterRollOutcome, hunterTraitProblems, isLegacyHunterSheet, migrateHunterTraits, splitPillar, usableEdges } from "../lib/hunter-traits.ts";
import { migrateOneRing, ONE_RING_CULTURES, oneRingDerived, oneRingProblems, oneRingStates } from "../lib/one-ring-rules.ts";

const hunter = SYSTEM_STARTERS.find((item) => item.id === "hunter").template;
const oneRing = SYSTEM_STARTERS.find((item) => item.id === "one-ring").template;
const fieldsOf = (template) => Object.fromEntries(template.fields.map((field) => [field.id, field]));

test("Caçador v5 keeps up to three free-text Pilares", () => {
  const fields = fieldsOf(hunter);
  assert.equal(fields.pilares.max_items, 3);
  assert.equal(fields.pilares.max_length, 160);
  assert.equal(fields.conviccao_1, undefined);
  assert.equal(fields.pedra_toque_1, undefined);
  assert.equal(fields.redencao.max_length, 240);
  assert.equal(fields.em_desespero.kind, "checkbox");
  assert.equal(fields.desespero, undefined, "Desesperação lives in the cell (F4)");
  assert.equal(validateField(fields.pilares, ["Pessoa"] ).valid, true);
  assert.equal(validateField(fields.pilares, ["Pessoa", "Pessoa", "Pessoa", "Pessoa"]).valid, false);
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

test("Caçador v5: source-verified Edges, Perks and creation counts", () => {
  const fields = fieldsOf(hunter);
  assert.equal(hunter.version, 5);
  assert.deepEqual(fields.triunfos.item_options, HUNTER_EDGE_NAMES);
  assert.deepEqual(fields.distincoes.item_options, HUNTER_PERKS);
  assert.equal(fields.equipamento.kind, "collection");
  assert.deepEqual(hunter.creation_rules.map((rule) => rule.id), ["atributos", "habilidades", "especializacoes", "vantagens_pontos", "defeitos_pontos"]);
  const specialties = hunter.creation_rules.find((rule) => rule.id === "especializacoes");
  assert.deepEqual(specialties.required, ["ciencia", "academicos", "oficios", "performance"]);
  assert.deepEqual(hunter.creation_rules.filter((rule) => rule.type === "collection_points").map((rule) => rule.points), [7, 2]);
  const base = { credo: "Marcial", impulso: "Juramento", pilares: ["Irmã Clara"] };
  assert.deepEqual(hunterV5CreationProblems({ ...base, triunfos: ["Arsenal", "Frota"], distincoes: [] }), []);
  assert.deepEqual(hunterV5CreationProblems({ ...base, triunfos: ["Biblioteca"], distincoes: ["Biblioteca: Quem Eles São", "Biblioteca: Como Detê-los"] }), []);
  assert.ok(hunterV5CreationProblems({ ...base, triunfos: ["Arsenal"], distincoes: [] }).some((item) => item.startsWith("Na criação")));
  assert.deepEqual(hunterEdgeProblems({ triunfos: ["Arsenal"], distincoes: ["Frota: Armadura"] }), ["Distinção Frota: Armadura pede o Triunfo Frota"]);
  assert.deepEqual(usableEdges({ triunfos: ["Arsenal"], em_desespero: true }), ["Arsenal"]);
  assert.deepEqual(usableEdges({ triunfos: ["Arsenal"] }), ["Arsenal"]);
  const mobile = MOBILE_STARTERS.find((item) => item.id === "hunter").template;
  assert.deepEqual(mobile.creation_rules, hunter.creation_rules);
  assert.deepEqual(mobile.fields.map((field) => field.id), hunter.fields.map((field) => field.id));
});

test("legacy v4 Edge catalog and creation counts remain accepted", () => {
  const legacy = { credo: "Marcial", impulso: "Juramento", conviccao_1: "a", pedra_toque_1: "b",
    triunfos: ["Arsenal", "Frota"], distincoes: ["Arsenal: Excepcional"] };
  assert.deepEqual(hunterCreationProblems(legacy), []);
  assert.deepEqual(hunterEdgeProblems({ triunfos: ["Vira-Casaca"], distincoes: [] }), ["Triunfo Vira-Casaca fora do catálogo"]);
});

test("Caçador roll outcome exposes the source consequence", () => {
  assert.deepEqual(hunterRollOutcome([10, 6], [10, 1], 4), { successes: 5, success: true, critical_pairs: 1, critical: true, desperation_ones: 1, desperation_consequence: "table_choice" });
  assert.equal(hunterRollOutcome([2, 3], [1], 1).desperation_consequence, "despair");
  assert.deepEqual(desperationChoices({ success: true, desperation_ones: 1 }), ["overreach", "despair"]);
  assert.deepEqual(desperationChoices({ success: false, desperation_ones: 1 }), ["despair"]);
  assert.deepEqual(desperationChoices({ success: true, desperation_ones: 0 }), []);
  for (let normal = 1; normal <= 10; normal += 1) for (let desperate = 1; desperate <= 10; desperate += 1) {
    const expected = (normal >= 6) + (desperate >= 6) + (normal === 10 && desperate === 10 ? 2 : 0);
    assert.equal(hunterRollOutcome([normal], [desperate], 1).successes, expected);
  }
});

test("O Um Anel v3 is the new starter while the legacy v2 fixture remains readable", () => {
  const legacy = JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/one_ring_starter.json", import.meta.url), "utf8"));
  assert.equal(legacy.version, 2);
  assert.equal(fieldsOf(legacy).tn_corpo.expression, "20 - corpo");
  assert.equal(fieldsOf(legacy).pericias_favorecidas.max_items, 3);
  assert.equal(oneRing.version,3);assert.equal(oneRing.rules_profile_version,3);
  assert.equal(fieldsOf(oneRing).pericias_favorecidas.max_items,18);
  const fixture=JSON.parse(readFileSync(new URL("../../backend/tests/fixtures/one_ring_v3_starter.json",import.meta.url),"utf8"));
  assert.deepEqual(fixture.template,oneRing);
  assert.deepEqual(MOBILE_STARTERS.find(x=>x.id==="one-ring").template,oneRing);
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
