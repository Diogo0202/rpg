import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionChronicle, attackDamageSplit, attackOperationKey, canApplyAttackDamage, damagePenaltiesFrom,
  describeDamageResult, storedModifierPreview, toggleRerollIndex,
} from "../lib/v5-action-roll.ts";

const SHEET = "74000000-0000-4000-8000-000000000001";
const CAMPAIGN = "72000000-0000-4000-8000-000000000001";
const TARGET = "74000000-0000-4000-8000-000000000002";
const attack = (damage, damage_type = "superficial") => ({ weapon: null, margin: damage, weapon_bonus: 0, damage, damage_type, sources: [] });

test("chronicle of a panel roll carries attribute and skill with a unique key", () => {
  const context = actionChronicle({ sheetId: SHEET, campaignId: CAMPAIGN, attributeId: "forca", skillId: "briga", rollKey: "v5-action:1" });
  assert.deepEqual(context, { sheet_id: SHEET, campaign_id: CAMPAIGN, trait_ids: ["forca", "briga"], roll_key: "v5-action:1" });
  assert.deepEqual(actionChronicle({ sheetId: SHEET, campaignId: CAMPAIGN, rollKey: "k" }).trait_ids, []);
  assert.equal(actionChronicle({ sheetId: "nao-e-uuid", campaignId: CAMPAIGN, rollKey: "k" }), undefined);
  assert.deepEqual(actionChronicle({ sheetId: SHEET, campaignId: CAMPAIGN, attributeId: "forca", skillId: "forca", rollKey: "k" }).trait_ids, ["forca"]);
});

test("stored modifier preview is read defensively and exposes full-track penalties", () => {
  const preview = { base_pool: 5, total_delta: -2, adjusted_pool: 3, clipped: false, skipped: [], applied: [
    { id: "__damage_health_full", label: "Saúde cheia", delta: -2, source_note: null },
    { id: "ferido", label: "Ferido", delta: 0, source_note: null },
  ] };
  assert.deepEqual(storedModifierPreview({ modifier_preview: preview }), preview);
  assert.equal(storedModifierPreview({ modifier_preview: { total_delta: "x" } }), null);
  assert.equal(storedModifierPreview(null), null);
  assert.deepEqual(damagePenaltiesFrom(preview), ["health"]);
  assert.deepEqual(damagePenaltiesFrom(null), []);
});

test("attack damage splits by weapon type and only the narrator applies it", () => {
  assert.deepEqual(attackDamageSplit(attack(4)), { superficial: 4, aggravated: 0 });
  assert.deepEqual(attackDamageSplit(attack(3, "aggravated")), { superficial: 0, aggravated: 3 });
  assert.deepEqual(attackDamageSplit(attack(45)), { superficial: 30, aggravated: 0 });
  assert.equal(attackDamageSplit(attack(0)), null);
  assert.equal(attackDamageSplit(null), null);
  assert.equal(canApplyAttackDamage({ canNarrate: true, attack: attack(2), targetId: TARGET }), true);
  assert.equal(canApplyAttackDamage({ canNarrate: false, attack: attack(2), targetId: TARGET }), false);
  assert.equal(canApplyAttackDamage({ canNarrate: true, attack: attack(0), targetId: TARGET }), false);
  assert.equal(canApplyAttackDamage({ canNarrate: true, attack: attack(2), targetId: "" }), false);
});

test("damage operation key is stable per attack and target", () => {
  assert.equal(attackOperationKey("r1", TARGET), attackOperationKey("r1", TARGET));
  assert.notEqual(attackOperationKey("r1", TARGET), attackOperationKey("r2", TARGET));
});

test("damage result message names absorption, conversion, full track and replays", () => {
  const sheet = { id: TARGET, name: "Alvo", version: 2, values: {}, effects: [] };
  const text = describeDamageResult({ sheet, replayed: false, superficial: 2, aggravated: 5, maximum: 7, absorbed_by_armor: 1,
    armor: { id: "a", name: "Colete", protection: 1 }, converted: 2, overflow: 0, impaired: true, incapacitated: false }, "Alvo");
  assert.match(text, /^Alvo · Trilha: 2 superficial e 5 agravado de 7\./);
  assert.match(text, /Colete absorveu 1\./);
  assert.match(text, /2 superficial convertido em agravado\./);
  assert.match(text, /Trilha cheia: penalidade de −2\./);
  assert.match(describeDamageResult({ sheet, replayed: false, superficial: 0, aggravated: 7, maximum: 7, overflow: 1, impaired: true, incapacitated: true }), /1 ponto\(s\) além da trilha\. Trilha toda agravada\./);
  assert.match(describeDamageResult({ sheet, replayed: true }, "Alvo"), /já tinha sido aplicado/);
});

test("Willpower reroll selection keeps at most three distinct dice", () => {
  assert.deepEqual(toggleRerollIndex([], 2), [2]);
  assert.deepEqual(toggleRerollIndex([2], 2), []);
  assert.deepEqual(toggleRerollIndex([0, 1, 2], 3), [0, 1, 2]);
});
