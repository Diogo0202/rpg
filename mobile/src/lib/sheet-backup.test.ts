import { describe, expect, it } from "vitest";
import { createSheetBackup, parseBackupText, validateBackup } from "./sheet-backup.ts";

const field = { id: "nome", label: "Nome", kind: "text", required: true, options: [], expression: null };
const weapon = { name: "Estaca", category: "weapon", quantity: 1, resource_cost: 0, damage_bonus: 2, protection: 0, notes: "", acquired: true, equipped: true, sort_order: 0 };

describe("sheet backup damage type", () => {
  it("round-trips aggravated weapons and defaults older items to superficial", () => {
    const doc = createSheetBackup({ name: "Mara", template: { name: "Original", version: 1, fields: [field] }, values: { nome: "Mara" }, effects: [],
      inventory: [{ ...weapon, damage_type: "aggravated" }, { ...weapon, name: "Faca antiga", equipped: false }] });
    const [restored] = parseBackupText(JSON.stringify(doc));
    expect(restored.inventory?.map((item) => item.damage_type)).toEqual(["aggravated", "superficial"]);
  });

  it("rejects unknown damage types", () => {
    const doc = createSheetBackup({ name: "Mara", template: { name: "Original", version: 1, fields: [field] }, values: { nome: "Mara" }, effects: [] });
    expect(() => validateBackup({ ...doc, inventory: [{ ...weapon, damage_type: "lethal" }] })).toThrow(/tipo de dano/i);
  });
});
