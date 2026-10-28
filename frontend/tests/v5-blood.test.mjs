import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOOD_POTENCY_TABLE, CLAN_COMPULSIONS, COMPULSION_OPTIONS, bloodPotency, bloodState, compulsionFromDie, countSuccesses,
  enumerateRouse, feedingPenaltyLabel, frenzyPool, halveSuperficial, parsePowerItem, remorsePool, remorseSuccessChance,
  resolveRouse, rouseRerollAllowed, rouseSuccessChance, torporDuration,
} from "../lib/v5-blood.ts";
import { damageRpcArgs, describeDamageResult, mergeRollHistory } from "../lib/v5-action-roll.ts";
import { V5_POWER_METADATA, V5_POWER_SOURCES, describeV5Power, v5PowerMetadata } from "../lib/v5-creation-data.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";

const close = (a, b) => Math.abs(a - b) < 1e-9;

test("Blood Potency table mirrors the backend and stays monotonic", () => {
  assert.deepEqual(BLOOD_POTENCY_TABLE.map((row) => row.potency), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let index = 1; index < BLOOD_POTENCY_TABLE.length; index += 1) {
    for (const key of ["surge", "mend", "power_bonus", "rouse_reroll_level", "bane_severity", "human_slake_penalty"]) {
      assert.ok(BLOOD_POTENCY_TABLE[index][key] >= BLOOD_POTENCY_TABLE[index - 1][key], `${key} at ${index}`);
    }
  }
  assert.deepEqual(bloodPotency(5), { potency: 5, surge: 4, mend: 3, power_bonus: 2, rouse_reroll_level: 3, bane_severity: 4, animal_slake: "none", human_slake_penalty: 1, kill_to_reduce_below: 2 });
  assert.equal(bloodPotency(99).potency, 10);
  assert.match(feedingPenaltyLabel(bloodPotency(2)), /metade/);
});

test("Rouse enumeration: 50% plain, 75% with the Potency reroll, Hunger capped at 5", () => {
  for (let hunger = 0; hunger < 5; hunger += 1) {
    const plain = enumerateRouse(hunger, false);
    assert.ok(close(plain.get(hunger), 0.5) && close(plain.get(hunger + 1), 0.5));
    assert.ok(close(enumerateRouse(hunger, true).get(hunger), 0.75));
  }
  assert.ok(close(enumerateRouse(5, false).get(5), 1));
  assert.equal(rouseRerollAllowed(1, 1), true);
  assert.equal(rouseRerollAllowed(1, 2), false);
  assert.equal(rouseSuccessChance(3, 2), 0.75);
  assert.equal(resolveRouse([2], 5).hungerFrenzyTest, true);
  assert.equal(resolveRouse([2, 9], 3).hungerAfter, 3);
});

test("Remorse pool and chance", () => {
  assert.equal(remorsePool(7, 2), 1);
  assert.equal(remorsePool(5, 1), 4);
  assert.ok(close(remorseSuccessChance(5, 1), 1 - 0.5 ** 4));
});

test("frenzy pool, successes and Brujah bane", () => {
  assert.equal(frenzyPool(4, 7), 6);
  assert.equal(frenzyPool(4, 7, { clan: "Brujah", kind: "fury", potency: 1 }), 4);
  assert.equal(frenzyPool(4, 7, { clan: "Brujah", kind: "terror", potency: 1 }), 6);
  assert.equal(countSuccesses([10, 10, 6, 1]), 5);
  // Statistical check against an exhaustive enumeration of two dice.
  let wins = 0;
  for (let a = 1; a <= 10; a += 1) for (let b = 1; b <= 10; b += 1) wins += countSuccesses([a, b]) >= 2 ? 1 : 0;
  assert.equal(wins, 25, "two successes need both dice at 6+");
});

test("compulsion table, catalog and torpor", () => {
  assert.deepEqual(Array.from({ length: 10 }, (_, index) => compulsionFromDie(index + 1, "Brujah")),
    ["Fome", "Fome", "Fome", "Dominação", "Dominação", "Destruição", "Destruição", "Paranoia", "Compulsão do clã", "Compulsão do clã"]);
  assert.equal(compulsionFromDie(10, "Caitiff"), null);
  assert.equal(Object.keys(CLAN_COMPULSIONS).length, 14);
  const v5 = SYSTEM_STARTERS.find((item) => item.id === "vampire-v5");
  const field = v5.template.fields.find((item) => item.id === "compulsao_atual");
  assert.deepEqual(field.options, COMPULSION_OPTIONS, "the RPC validates the field's options");
  assert.equal(v5.template.fields.find((item) => item.id === "torpor").kind, "checkbox");
  assert.equal(torporDuration(10), "um dia");
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(halveSuperficial), [0, 1, 1, 2, 2, 3]);
});

test("blood state derives from the sheet", () => {
  const state = bloodState({ potencia_sangue: 2, fome: 3, humanidade: 7, manchas: 2, autocontrole: 2, resolucao: 3, vontade_superficial: 1, cla: "Brujah", compulsao_atual: "Compulsão do clã" });
  assert.equal(state.remorsePool, 1);
  assert.deepEqual(state.frenzyPool, { fury: 4, hunger: 6, terror: 6 });
  assert.equal(state.compulsionDetail.name, "Rebeldia");
  assert.equal(state.inTorpor, false);
});

test("every V5 power has mechanical metadata marked for review", () => {
  const names = V5_POWER_SOURCES.flatMap((source) => source.powers.map((power) => `${source.label}: ${power.name}`));
  for (const item of names) {
    const meta = v5PowerMetadata(item);
    assert.ok(meta, `metadata for ${item}`);
    assert.equal(meta.review, true);
    assert.ok(meta.level >= 1 && meta.level <= 5, item);
  }
  assert.equal(V5_POWER_METADATA.length, names.length);
  assert.match(describeV5Power(v5PowerMetadata("Fortitude: Carne de Mármore")), /Nível 5 · 2 Rouse/);
  assert.deepEqual(parsePowerItem("Rapidez: Piscar"), { discipline: "Rapidez", power: "Piscar" });
});

test("damage RPC args: willpower target, explicit physical flag and halving message", () => {
  const health = damageRpcArgs({ sheetId: "s", track: "health", superficial: 3, aggravated: 0, armor: true, operationId: "o", physical: true });
  assert.equal(health.p_halve_superficial, true);
  assert.equal(health.p_apply_armor, true);
  const willpower = damageRpcArgs({ sheetId: "s", track: "willpower", superficial: 2, aggravated: 0, armor: true, operationId: "o", physical: true });
  assert.equal(willpower.p_track, "willpower");
  assert.equal(willpower.p_halve_superficial, false);
  assert.equal(willpower.p_apply_armor, false);
  assert.match(describeDamageResult({ sheet: {}, replayed: false, superficial: 2, aggravated: 0, maximum: 5, halved: 1 }), /metade/);
});

test("remote roll history merges with the session without duplicates", () => {
  const entry = (id, created_at, source) => ({ roll: { id, created_at }, source });
  const merged = mergeRollHistory([entry("b", "2026-10-27T10:00:02Z", "session")],
    [entry("b", "2026-10-27T10:00:02Z", "remote"), entry("a", "2026-10-27T10:00:01Z", "remote"), entry("c", "2026-10-27T10:00:03Z", "remote")]);
  assert.deepEqual(merged.map((item) => `${item.roll.id}:${item.source}`), ["c:remote", "b:session", "a:remote"]);
  assert.equal(mergeRollHistory([], Array.from({ length: 30 }, (_, index) => entry(String(index), `2026-10-27T10:00:${String(index).padStart(2, "0")}Z`))).length, 20);
});
