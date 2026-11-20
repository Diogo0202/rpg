import assert from "node:assert/strict";
import { test } from "node:test";
import { printableSheetHtml } from "../lib/printable-sheet.ts";

function backup(inventory) {
  return {
    format: "rpg-nexus-sheet", format_version: 1, name: "Lia",
    template: { name: "Modelo", version: 1, fields: [] },
    values: {}, effects: [], inventory,
  };
}
const base = { quantity: 1, resource_cost: 0, protection: 0, notes: "", acquired: true, equipped: false, sort_order: 0 };

test("ficha impressa mostra o tipo de dano das armas", () => {
  const html = printableSheetHtml(backup([
    { ...base, name: "Faca", category: "weapon", damage_bonus: 1, damage_type: "aggravated" },
    { ...base, name: "Taco", category: "weapon", damage_bonus: 2 },
  ]));
  assert.match(html, /dano \+1 \(Agravado\)/);
  assert.match(html, /dano \+2 \(Superficial\)/);
});

test("itens que não são armas não ganham tipo de dano", () => {
  const html = printableSheetHtml(backup([{ ...base, name: "Colete", category: "armor", damage_bonus: 0, protection: 2 }]));
  assert.doesNotMatch(html, /Superficial|Agravado/);
});
