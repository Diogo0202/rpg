import test from "node:test";
import assert from "node:assert/strict";
import { canApproveMarketplaceImport, marketplaceApprovalError, parsePendingMarketplaceImports } from "../lib/marketplace-imports.ts";

const pending = () => ({
  id: "11111111-1111-4111-8111-111111111111", name: "Modelo da campanha", version: 2,
  source_name: "Origem pública", source_status: "published",
  schema: { name: "Modelo da campanha", version: 2,
    fields: [{ id: "nome", label: "Nome", kind: "text", required: true, options: [], expression: null }],
    creation_rules: [{ type: "group_sum", id: "points", fields: ["forca"], min: 1, max: 4 }],
    system_key: "homebrew", inventory_schema: [],
  },
});

test("review preserves the complete snapshot, including custom rules", () => {
  const item = pending();
  const actual = parsePendingMarketplaceImports([item]);
  assert.deepEqual(actual[0], item);
  assert.equal(actual[0].schema, item.schema);
  assert.deepEqual(actual[0].schema.creation_rules, item.schema.creation_rules);
});

test("approval requires explicit review and a published source", () => {
  const item = pending();
  assert.equal(canApproveMarketplaceImport(item, false), false);
  assert.equal(canApproveMarketplaceImport(item, true), true);
  for (const source_status of ["hidden", "draft", "deleted", "unknown"]) {
    assert.equal(canApproveMarketplaceImport({ ...item, source_status }, true), false);
  }
});

test("malformed responses cannot become approvable imports", () => {
  for (const value of [null, {}, { items: [] }, [null], [{ ...pending(), id: "invalid" }],
    [{ ...pending(), schema: { fields: [] } }], [{ ...pending(), version: 0 }]]) {
    assert.throws(() => parsePendingMarketplaceImports(value));
  }
  assert.deepEqual(parsePendingMarketplaceImports([]), []);
});

test("malformed fields and duplicate identifiers reject the entire snapshot", () => {
  for (const fields of [
    [{ id: "n", label: "Nome", kind: "html" }],
    [{ id: "n", label: "Nome", kind: "text", expression: { code: "alert(1)" } }],
    [{ id: "n", label: "Nome", kind: "select", options: [1] }],
    [pending().schema.fields[0], pending().schema.fields[0]],
  ]) {
    assert.throws(() => parsePendingMarketplaceImports([{ ...pending(), schema: { ...pending().schema, fields } }]));
  }
  assert.throws(() => parsePendingMarketplaceImports([pending(), pending()]));
});

test("text remains literal and no error returns database internals", () => {
  const item = pending();
  item.name = '<img src=x onerror="alert(1)">';
  assert.equal(parsePendingMarketplaceImports([item])[0].name, item.name);
  assert.match(marketplaceApprovalError({ code: "22023", message: "private DB internals" }), /mudou durante a revisão/);
  assert.match(marketplaceApprovalError({ code: "42501" }), /permissão/);
  assert.ok(!marketplaceApprovalError({ code: "XX000", message: "private DB internals" }).includes("internals"));
});
