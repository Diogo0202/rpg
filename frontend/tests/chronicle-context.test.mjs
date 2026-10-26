import assert from "node:assert/strict";
import test from "node:test";
import { buildChronicleContext, chronicleActivityLabel, newRollKey, parseChronicleActivity, withChronicle } from "../lib/chronicle-context.ts";

const SHEET = "11111111-2222-4333-8444-555555555555";
const CAMPAIGN = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("without a valid sheet no chronicle context is sent", () => {
  assert.equal(buildChronicleContext({ sheetId: null, rollKey: "k" }), undefined);
  assert.equal(buildChronicleContext({ sheetId: "local-draft", rollKey: "k" }), undefined);
  assert.deepEqual(withChronicle({ base_pool: 3 }, undefined), { base_pool: 3 });
  assert.ok(!("chronicle" in withChronicle({ base_pool: 3 }, undefined)));
});

test("context carries sheet, campaign, unique trait ids and roll key", () => {
  const context = buildChronicleContext({ sheetId: SHEET, campaignId: CAMPAIGN, traitIds: ["forca", "", "forca", undefined, " briga "], rollKey: "roll:1" });
  assert.deepEqual(context, { sheet_id: SHEET, campaign_id: CAMPAIGN, trait_ids: ["forca", "briga"], roll_key: "roll:1" });
  assert.deepEqual(withChronicle({ base_pool: 3 }, context), { base_pool: 3, chronicle: context });
});

test("values the server would reject are dropped instead of breaking the roll", () => {
  const context = buildChronicleContext({ sheetId: SHEET, campaignId: "not-a-uuid", traitIds: ["x".repeat(81), ...Array.from({ length: 60 }, (_, i) => `t${i}`)], rollKey: "k" });
  assert.equal(context.campaign_id, undefined);
  assert.equal(context.trait_ids.length, 50);
  assert.equal(context.trait_ids[0], "t0");
  assert.equal(buildChronicleContext({ sheetId: SHEET, rollKey: "" }), undefined);
  assert.equal(buildChronicleContext({ sheetId: SHEET, rollKey: "k".repeat(121) }), undefined);
});

test("roll keys are unique and bounded", () => {
  const a = newRollKey("hunter");
  const b = newRollKey("hunter");
  assert.notEqual(a, b);
  assert.ok(a.startsWith("hunter:") && a.length <= 120);
});

test("activity header is parsed strictly and only recorded shows the indicator", () => {
  assert.equal(parseChronicleActivity("recorded"), "recorded");
  assert.equal(parseChronicleActivity(" Duplicate "), "duplicate");
  assert.equal(parseChronicleActivity(null), null);
  assert.equal(parseChronicleActivity("<script>"), null);
  assert.equal(chronicleActivityLabel("recorded"), "registrado na crônica");
  assert.equal(chronicleActivityLabel("duplicate"), null);
  assert.equal(chronicleActivityLabel(null), null);
});
