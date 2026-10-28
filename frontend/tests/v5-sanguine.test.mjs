import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOND_DEGREE_LABELS, V5_CLAN_BANES, V5_INTENSITIES, V5_RESONANCES, V5_RESONANCE_DISCIPLINES, baneSeverity, bondDegree,
  hungerAfterHunt, resonanceEffectPreview, v5TraitProblems,
} from "../lib/v5-sanguine.ts";
import { V5_DISCIPLINES } from "../lib/v5-creation-data.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";
import { validateFields } from "../lib/sheet-creation.ts";

const v5 = SYSTEM_STARTERS.find((item) => item.id === "vampire-v5");
const field = (id) => v5.template.fields.find((item) => item.id === id);

test("Bane Severity follows Blood Potency", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(baneSeverity), [0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
});

test("the starter carries the new V5 fields without making old sheets invalid", () => {
  for (let n = 1; n <= 3; n += 1) {
    assert.equal(field(`conviccao_${n}`).paired_with, `pedra_toque_${n}`);
    assert.equal(field(`pedra_toque_${n}`).paired_with, `conviccao_${n}`);
    assert.equal(field(`conviccao_${n}`).required, false);
  }
  assert.equal(field("principios_cronica").max_items, 5);
  assert.equal(field("severidade_perdicao").kind, "formula");
  assert.deepEqual(field("ressonancia_atual").options, [...V5_RESONANCES]);
  assert.deepEqual(field("intensidade_ressonancia").options, [...V5_INTENSITIES]);
  const banes = Object.fromEntries(field("perdicao").depends_on.cases.map((item) => [item.equals, item.options]));
  assert.deepEqual(banes.Brujah, [V5_CLAN_BANES.Brujah.name]);
  assert.equal(banes.Caitiff, undefined, "Caitiff and thin-bloods have no clan bane");
  assert.equal(field("perdicao").creation_step, "identity");
  assert.equal(field("conviccao_1").creation_step, "story");
  const lone = validateFields([field("conviccao_1"), field("pedra_toque_1")], { conviccao_1: "Proteger", pedra_toque_1: "" }, v5.template);
  assert.ok(Object.keys(lone).length > 0, "a conviction needs its touchstone");
});

test("every resonance names real discipline ids", () => {
  const ids = new Set(V5_DISCIPLINES.map(([id]) => id));
  for (const tags of Object.values(V5_RESONANCE_DISCIPLINES)) for (const tag of tags) assert.ok(ids.has(tag), tag);
});

test("hunting lowers Hunger, but only a kill reaches zero", () => {
  assert.equal(hungerAfterHunt(4, 2, false), 2);
  assert.equal(hungerAfterHunt(2, 5, false), 1);
  assert.equal(hungerAfterHunt(2, 5, true), 0);
  assert.equal(hungerAfterHunt(0, 2, false), 0);
  assert.equal(hungerAfterHunt(4, 5, false, 6), 2, "high Blood Potency needs a kill to go lower");
  assert.equal(hungerAfterHunt(4, 5, true, 9), 0);
});

test("the resonance effect matches what record_v5_hunt stores", () => {
  const effect = resonanceEffectPreview("Animal", "Intensa", "Cão de rua");
  assert.deepEqual([effect.delta, effect.applies_to_tags], [1, ["disc_animalismo", "disc_metamorfose"]]);
  assert.equal(resonanceEffectPreview("Animal", "Fugaz", "x"), null);
  assert.equal(resonanceEffectPreview("Nenhuma", "Nenhuma", "x"), null);
});

test("bond degree: distinct nights, cap at three and decay", () => {
  const at = new Date("2026-01-08T00:00:00Z");
  assert.equal(bondDegree(["2026-01-01T22:00:00Z", "2026-01-01T23:00:00Z"], 30, at), 1);
  const nights = ["2026-01-01T22:00:00Z", "2026-01-03T22:00:00Z", "2026-01-05T22:00:00Z", "2026-01-07T22:00:00Z"];
  assert.equal(bondDegree(nights, 30, at), 3);
  assert.equal(bondDegree(nights.slice(0, 3), 30, new Date("2026-03-10T00:00:00Z")), 1);
  assert.equal(bondDegree(["2026-01-01T00:00:00Z", "2026-03-05T00:00:00Z"], 30, new Date("2026-03-06T00:00:00Z")), 1);
  assert.equal(bondDegree(["2026-05-01T00:00:00Z"], 30, new Date("2026-04-01T00:00:00Z")), 0);
  assert.throws(() => bondDegree([], 0, at));
  assert.equal(BOND_DEGREE_LABELS.length, 4);
});

test("trait problems mirror the backend", () => {
  assert.deepEqual(v5TraitProblems({}), []);
  assert.deepEqual(v5TraitProblems({ conviccao_2: "x" }), ["Par 2: preencha Convicção e Pedra de Toque juntas"]);
  assert.deepEqual(v5TraitProblems({ cla: "Brujah", perdicao: "Estética" }), ["A Perdição não é a do clã escolhido"]);
  assert.deepEqual(v5TraitProblems({ ressonancia_atual: "Colérica", intensidade_ressonancia: "Nenhuma" }), ["Ressonância e intensidade andam juntas"]);
  assert.deepEqual(v5TraitProblems({ ressonancia_atual: "Animal", intensidade_ressonancia: "Intensa", discrasia: "x" }), ["Discrasia só com Ressonância aguda"]);
});
