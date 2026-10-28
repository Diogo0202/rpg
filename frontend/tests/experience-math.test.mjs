import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  EXPERIENCE_COST_TABLES, EXPERIENCE_TRAIT_CATEGORIES, advanceCost, itemDots, purchasableTraits, quoteAdvance, resolveAdvanceCategory,
} from "../lib/experience-math.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";

// F4 follow-up (20261029140100) maps the Hunter Edge/Perk categories to `triunfos`/`distincoes`.
const migration = ["20261029140000_experience_advances.sql", "20261029140100_hunter_experience_edge_fields.sql"]
  .map((name) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8")).join("\n");
const starter = (id) => SYSTEM_STARTERS.find((entry) => entry.id === id).template;

test("cost tables mirror experience_cost_rules in the migration", () => {
  const seeded = [...migration.matchAll(/\('([a-z0-9-]+)', '([a-z_]+)', '(new|current|flat|level|per_dot)', (\d+), (null|\d+), '([^']+)'\)/g)]
    .map(([, system, category, basis, multiplier, newCost, label]) => ({ system, category, basis, multiplier: Number(multiplier), newCost: newCost === "null" ? null : Number(newCost), label }));
  const mirrored = Object.entries(EXPERIENCE_COST_TABLES).flatMap(([system, rules]) =>
    Object.entries(rules).map(([category, rule]) => ({ system, category, basis: rule.basis, multiplier: rule.multiplier, newCost: rule.newCost, label: rule.label })));
  const key = (entry) => `${entry.system}/${entry.category}`;
  assert.deepEqual([...mirrored].sort((a, b) => key(a).localeCompare(key(b))), [...seeded].sort((a, b) => key(a).localeCompare(key(b))));
});

test("trait categories mirror experience_trait_categories in the migration", () => {
  for (const [system, categories] of Object.entries(EXPERIENCE_TRAIT_CATEGORIES)) {
    for (const [field, category] of Object.entries(categories)) {
      const inArray = new RegExp(`select '${system}', field_id, '${category}' from unnest\\(array\\[[^\\]]*'${field}'`, "s").test(migration);
      const inValues = new RegExp(`select '${system}', field_id, category from \\(values[^;]*?\\('${field}', '${category}'\\)`, "s").test(migration);
      assert.ok(inArray || inValues, `${system}.${field} → ${category} missing from the migration`);
    }
  }
});

test("V5 costs use the new level", () => {
  const rules = EXPERIENCE_COST_TABLES["vampire-v5"];
  assert.equal(advanceCost(rules.attribute, 2, 3), 15);
  assert.equal(advanceCost(rules.skill, 0, 2), 9);
  assert.equal(advanceCost(rules.clan_discipline, 1, 2), 10);
  assert.equal(advanceCost(rules.out_of_clan_discipline, 0, 1), 7);
  assert.equal(advanceCost(rules.caitiff_discipline, 1, 2), 12);
  assert.equal(advanceCost(rules.blood_potency, 1, 2), 20);
  assert.equal(advanceCost(rules.specialty, 0, 1), 3);
  assert.equal(advanceCost(rules.ritual, 0, 3), 9);
  assert.equal(advanceCost(rules.formula, 0, 2), 6);
  assert.equal(advanceCost(rules.advantage, 1, 3), 6);
});

test("V3 costs use the current level and fixed prices for new traits", () => {
  const rules = EXPERIENCE_COST_TABLES["vampire-v3"];
  assert.equal(advanceCost(rules.attribute, 3, 4), 12);
  assert.equal(advanceCost(rules.skill, 0, 1), 3);
  assert.equal(advanceCost(rules.skill, 2, 3), 4);
  assert.equal(advanceCost(rules.clan_discipline, 0, 1), 10);
  assert.equal(advanceCost(rules.clan_discipline, 2, 3), 10);
  assert.equal(advanceCost(rules.out_of_clan_discipline, 2, 3), 14);
  assert.equal(advanceCost(rules.caitiff_discipline, 2, 3), 12);
  assert.equal(advanceCost(rules.virtue, 3, 4), 6);
  assert.equal(advanceCost(rules.humanity, 6, 7), 12);
  assert.equal(advanceCost(rules.willpower, 5, 6), 5);
  assert.equal(advanceCost(rules.attribute, 2, 4), 8 + 12, "several levels add each step");
});

test("Hunter costs", () => {
  const rules = EXPERIENCE_COST_TABLES.hunter;
  assert.equal(advanceCost(rules.attribute, 2, 3), 15);
  assert.equal(advanceCost(rules.skill, 1, 2), 6);
  assert.equal(advanceCost(rules.edge, 0, 1), 7);
  assert.equal(advanceCost(rules.perk, 0, 1), 3);
  assert.equal(advanceCost(rules.advantage, 0, 2), 6);
});

test("disciplines resolve by clan from the real starters", () => {
  const v5 = starter("vampire-v5");
  assert.equal(resolveAdvanceCategory(v5, { cla: "Brujah" }, "disc_potencia"), "clan_discipline");
  assert.equal(resolveAdvanceCategory(v5, { cla: "Brujah" }, "disc_auspicios"), "out_of_clan_discipline");
  assert.equal(resolveAdvanceCategory(v5, { cla: "Caitiff" }, "disc_auspicios"), "caitiff_discipline");
  const v3 = starter("vampire-v3");
  assert.equal(resolveAdvanceCategory(v3, { cla: "Tremere" }, "disc_taumaturgia"), "clan_discipline");
  assert.equal(resolveAdvanceCategory(v3, { cla: "Brujah" }, "disc_taumaturgia"), "out_of_clan_discipline");
  assert.equal(resolveAdvanceCategory(v3, {}, "notas"), null);
});

test("every purchasable trait of the starters has a cost", () => {
  for (const id of ["vampire-v5", "vampire-v3", "hunter"]) {
    const template = starter(id);
    const traits = purchasableTraits(template);
    assert.ok(traits.length > 20, `${id} exposes purchasable traits`);
    for (const trait of traits) assert.ok(resolveAdvanceCategory(template, { cla: "Brujah" }, trait), `${id}.${trait}`);
  }
});

test("quotes check levels, limits and collection items", () => {
  const v5 = starter("vampire-v5");
  assert.equal(quoteAdvance(v5, { forca: 2 }, "forca", 4).cost, 35);
  assert.throws(() => quoteAdvance(v5, { forca: 5 }, "forca", 6), /limite/);
  assert.throws(() => quoteAdvance(v5, { forca: 3 }, "forca", 3), /superar/);
  assert.deepEqual(quoteAdvance(v5, { vantagens: ["Recursos ••"] }, "vantagens", 3, "Recursos").cost, 3);
  assert.throws(() => quoteAdvance(v5, { especialidades: ["Briga (Socos)"] }, "especialidades", 1, "Briga (Socos)"), /já está/);
  assert.equal(itemDots("Rebanho 3"), 3);
  assert.equal(itemDots("Aliados •••"), 3);
});
