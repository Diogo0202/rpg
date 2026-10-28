import { describe, expect, it } from "vitest";
import {
  advanceActions, advanceRequest, advanceTraitOptions, bloodQueueable, canAffordQuote, cellAdjustBody, describeBloodEvent, describeHunterRoll,
  describeV3Action, describeV3Roll, gameSystem, huntBody, hunterRollBody, purchaseBody, toggleDie, v3ActionBody, v3EffectivePool, v3RollBody,
  v5OutcomeLabel, type CharacterAdvance, type HunterRoll,
} from "./table-rules";

const OP = "11111111-1111-4111-8111-111111111111";
const SHEET = "22222222-2222-4222-8222-222222222222";

describe("shared helpers", () => {
  it("toggles at most three dice for a reroll", () => {
    let picked: number[] = [];
    for (const index of [4, 1, 2, 3]) picked = toggleDie(picked, index);
    expect(picked).toEqual([1, 2, 4]);
    expect(toggleDie(picked, 2)).toEqual([1, 4]);
  });

  it("detects the system of a sheet", () => {
    expect(gameSystem("vampire-v3", {})).toBe("vampire-v3");
    expect(gameSystem(null, { sistema: "Caçador: A Revanche" })).toBe("hunter");
    expect(gameSystem(null, { fome: 2, potencia_sangue: 1 })).toBe("vampire-v5");
    expect(gameSystem("one-ring", {})).toBeNull();
  });
});

describe("V3", () => {
  it("builds the roll body and spends Willpower only with an operation id", () => {
    expect(v3RollBody({ pool: 5, difficulty: 6, specialty: true, willpower: false, damageLevels: 2, sheetId: SHEET, operationId: OP }))
      .toEqual({ pool: 5, difficulty: 6, specialty: true, use_willpower: false, damage_levels: 2 });
    expect(v3RollBody({ pool: 5, difficulty: 6, specialty: false, willpower: true, damageLevels: 0, sheetId: SHEET, operationId: OP }))
      .toMatchObject({ use_willpower: true, sheet_id: SHEET, operation_id: OP });
    expect(() => v3RollBody({ pool: 0, difficulty: 6, specialty: false, willpower: false, damageLevels: 0, sheetId: SHEET, operationId: OP })).toThrow("1 e 30");
  });

  it("applies the health penalty and blocks Incapacitado", () => {
    expect(v3EffectivePool(5, -2)).toBe(3);
    expect(v3EffectivePool(1, -5)).toBe(0);
    expect(v3EffectivePool(5, null)).toBe(0);
  });

  it("builds action bodies and validates the turn key", () => {
    expect(v3ActionBody("sangue", { amount: 2, turn: "combate:1" })).toEqual({ action: "sangue", amount: 2, turn: "combate:1" });
    expect(v3ActionBody("dano", { amount: 3, kind: "agravado" })).toEqual({ action: "dano", amount: 3, kind: "agravado" });
    expect(v3ActionBody("frenesi", { difficulty: 12 })).toEqual({ action: "frenesi", difficulty: 10 });
    expect(() => v3ActionBody("cura", { turn: "rodada 1" })).toThrow("Turno");
  });

  it("describes rolls and actions", () => {
    expect(describeV3Roll({ dice: [10, 1, 7], difficulty: 6, successes: 1, botch: false, success: true, penalty: -1, rolled: 3, willpower_spent: true }))
      .toBe("Sucesso · 1 sucesso(s) · dificuldade 6 · dados 10 · 1 · 7 · Vitalidade -1 · +1 Vontade");
    expect(describeV3Action({ applied: 2, sheet: { values: { pontos_sangue: 4 } } })).toBe("2 nível(is) marcado(s) · sangue 4");
    expect(describeV3Action(null)).toBe("Aplicado.");
  });
});

describe("Caçador", () => {
  it("drops Desperation dice and Edges in Despair", () => {
    expect(hunterRollBody({ basePool: 4, difficulty: 3, useDesperation: true, edge: "Arsenal", despair: false }))
      .toEqual({ base_pool: 4, difficulty: 3, use_desperation: true, edge: "Arsenal" });
    expect(hunterRollBody({ basePool: 4, difficulty: 3, useDesperation: true, edge: "Arsenal", despair: true }))
      .toEqual({ base_pool: 4, difficulty: 3, use_desperation: false });
  });

  it("describes a roll waiting for the table's choice", () => {
    const roll: HunterRoll = { roll_id: OP, normal_dice: [6, 3], desperation_dice: [1], desperation_ones: 1, successes: 1, difficulty: 1, success: true,
      critical_pairs: 0, critical: false, desperation_consequence: "table_choice", resolution: null, choices: ["overreach", "despair"], can_reroll: true, verdict: "Êxito" };
    expect(describeHunterRoll(roll)).toContain("escolha Despair ou Overreach");
    expect(describeHunterRoll({ ...roll, resolution: "overreach", choices: [] })).toContain("mesa: Overreach");
  });

  it("requires a non-zero cell step", () => {
    expect(cellAdjustBody(1, 0)).toEqual({ danger_delta: 1, desperation_delta: 0 });
    expect(() => cellAdjustBody(0, 0)).toThrow("Perigo");
  });
});

describe("V5", () => {
  it("labels outcomes and blood events", () => {
    expect(v5OutcomeLabel({ successes: 4, success: true, messy_critical: true, clean_critical: false, bestial_failure: false })).toBe("Crítico sujo");
    expect(describeBloodEvent({ kind: "rouse", outcome: { success: false, hunger_before: 2, hunger_after: 3 } })).toBe("falhou · Fome 2 → 3");
    expect(describeBloodEvent({ kind: "torpor", outcome: { in_torpor: false } })).toBe("saiu do Torpor");
  });

  it("queues only blood actions without dice", () => {
    expect(bloodQueueable("torpor", { in_torpor: true })).toBe(true);
    expect(bloodQueueable("compulsion", { compulsion: "Fome" })).toBe(true);
    expect(bloodQueueable("compulsion", { compulsion: null })).toBe(false);
    expect(bloodQueueable("rouse", {})).toBe(false);
  });

  it("validates the hunt like the API", () => {
    expect(huntBody({ prey: " ", resonance: "Nenhuma", intensity: "Nenhuma", dyscrasia: "", slake: 1, killed: false })).toEqual({ error: "Informe a presa." });
    expect(huntBody({ prey: "Ana", resonance: "Colérica", intensity: "Nenhuma", dyscrasia: "", slake: 1, killed: false })).toEqual({ error: "Ressonância e intensidade andam juntas." });
    expect(huntBody({ prey: "Ana", resonance: "Colérica", intensity: "Fugaz", dyscrasia: "Raiva", slake: 1, killed: false })).toEqual({ error: "Discrasia só com Ressonância aguda." });
    expect(huntBody({ prey: "Ana", resonance: "Colérica", intensity: "Aguda", dyscrasia: "Raiva", slake: 9, killed: true }))
      .toEqual({ body: { prey: "Ana", resonance: "Colérica", intensity: "Aguda", dyscrasia: "Raiva", slake: 5, killed: true, notes: null } });
  });
});

describe("XP", () => {
  it("lists purchasable traits without the XP field", () => {
    const fields = [{ id: "experiencia", label: "XP", kind: "number" }, { id: "forca", label: "Força", kind: "number", max: 5 }, { id: "nome", label: "Nome", kind: "text" }, { id: "vantagens", label: "Vantagens", kind: "collection" }];
    expect(advanceTraitOptions(fields).map((item) => [item.id, item.max, item.collection])).toEqual([["forca", 5, false], ["vantagens", 5, true]]);
    expect(advanceTraitOptions(fields, new Set(["vantagens"])).map((item) => item.id)).toEqual(["vantagens"]);
  });

  it("builds the request and purchase body with the stable operation id", () => {
    expect(() => advanceRequest("vantagens", 2, " ", true)).toThrow("nome do item");
    const request = advanceRequest("forca", 3, "ignored", false);
    expect(request).toEqual({ trait: "forca", target_level: 3, item_name: null });
    expect(purchaseBody(request, 7, OP, "  ")).toEqual({ trait: "forca", target_level: 3, item_name: null, expected_version: 7, operation_id: OP, reason: null });
    expect(canAffordQuote({ category: "a", label: "A", from_level: 2, to_level: 3, cost: 15, xp_available: 10, sheet_version: 7, requires_approval: false })).toBe(false);
  });

  it("offers review actions by role", () => {
    const advance = { id: OP, actor_id: "me", status: "pending" } as CharacterAdvance;
    expect(advanceActions(advance, "me", false)).toEqual(["cancel"]);
    expect(advanceActions(advance, "other", false)).toEqual([]);
    expect(advanceActions(advance, "x", true)).toEqual(["approve", "reject"]);
    expect(advanceActions({ ...advance, status: "applied" }, "x", true)).toEqual(["refund"]);
  });
});
