import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmptyDocument } from "../lib/map-document.ts";
import { examinedItems, mapObjectActions, mapObjectsFrom, mapObjectFootprint, validateMapObjectConfig } from "../lib/map-interactions.ts";

test("map object configuration rejects invalid quantities and missing destination", () => {
  const base = { kind: "container", label: "Baú", reach_cells: 1, items: [{ id: "coin", name: "Moeda", quantity: 3 }] };
  assert.equal(validateMapObjectConfig(base), "");
  for (const quantity of [-1, 0.5, NaN, Infinity, 100001]) assert.ok(validateMapObjectConfig({ ...base, items: [{ ...base.items[0], quantity }] }));
  assert.ok(validateMapObjectConfig({ ...base, reach_cells: NaN }));
  assert.ok(validateMapObjectConfig({ ...base, kind: "passage" }));
  assert.ok(validateMapObjectConfig({ ...base, kind: "clue", clue_text: " " }));
  assert.deepEqual(mapObjectActions("door"), ["open", "close"]);
});

test("container contents need an approved examination for this object and character", () => {
  const action = { id: "request", object_id: "chest", sheet_id: "ana", action: "examine", status: "approved", result: { items: [{ id: "coin", name: "Moeda", quantity: 3 }] } };
  assert.equal(examinedItems([action], "chest", "ana").length, 1);
  assert.deepEqual(examinedItems([{ ...action, status: "pending" }], "chest", "ana"), []);
  assert.deepEqual(examinedItems([action], "chest", "outsider"), []);
  assert.deepEqual(examinedItems([action], "other-chest", "ana"), []);
  assert.deepEqual(mapObjectsFrom([{ id: "x", element_id: "p", kind: "unknown" }]), []);
});

test("map footprint uses the saved structure and scaled kit dimensions", () => {
  const doc = createEmptyDocument("one-ring");
  doc.structures = [{ id: "barrel", type: "prop", kind: "barrel", x: 100, y: 200, scale: 2, rotation: 0 }];
  const footprint = mapObjectFootprint(doc, "barrel");
  assert.deepEqual(footprint.point, [100, 200]);
  assert.ok(footprint.radius > 0);
  assert.equal(mapObjectFootprint(doc, "absent"), null);
});
