import test from "node:test";
import assert from "node:assert/strict";
import { makeCompanyCommand, optimisticSnapshot, projectCompanySnapshot, validateCompanyCommand } from "../../shared/one-ring/company-sync.ts";

const snapshot = {
  company: { id: "co-1", campaign_id: "camp-1", name: "Companhia", patron_id: null, safe_havens: [], version: 7, society_max: 6, society_current: 3 },
  members: [
    { sheet_id: "sheet-a", name: "A", owner_id: "user-a" },
    { sheet_id: "sheet-b", name: "B", owner_id: "user-b" },
  ],
  focuses: [], events: [],
};

test("player can only change own focus and targets must belong to company", () => {
  assert.equal(validateCompanyCommand(snapshot, "player", "user-a", "set_focus", { source_sheet_id: "sheet-a", target_sheet_id: "sheet-b" }), null);
  assert.match(validateCompanyCommand(snapshot, "player", "user-a", "set_focus", { source_sheet_id: "sheet-b", target_sheet_id: "sheet-a" }), /própria ficha/);
  assert.match(validateCompanyCommand(snapshot, "player", "user-a", "set_focus", { source_sheet_id: "sheet-a", target_sheet_id: "outside" }), /alvo precisa/);
  assert.match(validateCompanyCommand(snapshot, "guest", "user-a", "set_focus", { source_sheet_id: "sheet-a", target_sheet_id: null }), /Convidados/);
});

test("local spend rejects overdraw and restore rejects cap overflow", () => {
  assert.match(validateCompanyCommand(snapshot, "narrator", "master", "spend", { amount: 4, reason: "Risco" }), /saldo suficiente/);
  assert.match(validateCompanyCommand(snapshot, "narrator", "master", "restore", { amount: 4, reason: "Recompensa" }), /excede o limite/);
  assert.equal(validateCompanyCommand(snapshot, "narrator", "master", "spend", { amount: 2, reason: "Risco" }), null);
});

test("queued projection advances each accepted command version", () => {
  const a = makeCompanyCommand("spend", { amount: 1, reason: "A" }, 7, () => "op-a");
  const one = optimisticSnapshot(snapshot, a);
  const b = makeCompanyCommand("restore", { amount: 1, reason: "B" }, one.company.version, () => "op-b");
  const projected = projectCompanySnapshot(snapshot, [
    { command: a, state: "queued", created_at: 1 },
    { command: b, state: "queued", created_at: 2 },
  ]);
  assert.equal(a.expected_version, 7);
  assert.equal(b.expected_version, 8);
  assert.equal(projected.company.version, 9);
  assert.equal(projected.company.society_current, 3);
});

test("failed company creation blocks membership actions until record exists", () => {
  const empty = { company: null, members: [], focuses: [], events: [] };
  assert.match(validateCompanyCommand(empty, "narrator", "master", "add_member", { sheet_id: "sheet-a" }), /Crie a Companhia/);
  const create = makeCompanyCommand("create", { name: "Norte", safe_havens: [] }, 0, () => "op-a");
  const local = optimisticSnapshot(empty, create);
  assert.equal(local.company.id, "pending:op-a");
});
