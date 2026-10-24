import assert from "node:assert/strict";
import { test } from "node:test";
import { createSheetBackup, mechanicallyEquivalentFields, parseBackupText, validateBackup } from "../lib/sheet-backup.ts";

const field = { id: "nome", label: "Nome", kind: "text", required: true, options: [], expression: null };

test("backup round trip preserves dynamic inventory values", () => {
  const doc = createSheetBackup({ name: "Mara", template: { name: "Original", version: 1, fields: [field] }, values: { nome: "Mara" }, effects: [], inventory: [{ name: "Corda", category: "equipment", quantity: 1, resource_cost: 0, damage_bonus: 0, protection: 0, notes: "", acquired: true, equipped: false, sort_order: 0, custom_values: { peso: 2, tags: ["leve"], fragil: false } }] });
  assert.deepEqual(parseBackupText(JSON.stringify(doc))[0].inventory[0].custom_values, { peso: 2, tags: ["leve"], fragil: false });
  assert.throws(() => validateBackup({ ...doc, inventory: [{ ...doc.inventory[0], custom_values: { peso: { execute: "code" } } }] }), /atributo/i);
});

test("ignora somente metadados de apresentação do template aprovado", () => {
  const approved = [{ ...field, creation_step: "identity", identity_kind: "origin", character_name: true }];
  assert.equal(mechanicallyEquivalentFields(approved, [field]), true);
  assert.equal(mechanicallyEquivalentFields([{ ...field, creation_step: "story" }], [field]), true);
});

test("diferenças em required, options ou propriedades desconhecidas continuam incompatíveis", () => {
  assert.equal(mechanicallyEquivalentFields([{ ...field, required: false }], [field]), false);
  assert.equal(mechanicallyEquivalentFields([{ ...field, options: ["A"] }], [field]), false);
  assert.equal(mechanicallyEquivalentFields([{ ...field, custom_rule: "x" }], [field]), false);
  assert.equal(mechanicallyEquivalentFields([{ ...field, creation_step: "identity", custom_rule: "x" }], [field]), false);
});

test("preserva a ordem dos campos", () => {
  assert.equal(mechanicallyEquivalentFields([field, { ...field, id: "vigor" }], [{ ...field, id: "vigor" }, field]), false);
});

test("backup v1 legado mantém seis chaves por campo e continua importável", () => {
  const legacy = createSheetBackup({
    name: "Lia",
    template: { name: "Modelo", version: 1, fields: [field] },
    values: { nome: "Lia" },
    effects: [],
  });
  assert.deepEqual(Object.keys(legacy.template.fields[0]).sort(), ["expression", "id", "kind", "label", "options", "required"]);
  assert.deepEqual(parseBackupText(JSON.stringify(legacy)), [legacy]);
  assert.deepEqual(validateBackup(legacy).template.fields, [field]);
});
