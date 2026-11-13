import test from "node:test";
import assert from "node:assert/strict";
import { probabilityRequest } from "../lib/v5-probability-request.ts";

const inputs = { sheetId: "sheet/id", pool: 6, hunger: 5, difficulty: 3, willpowerDice: 2, contextTags: ["fisico"] };

test("saved-sheet predictions omit client Hunger, damage and effects", () => {
  const request = probabilityRequest({ ...inputs, effects: [{ delta: 99 }], damage: { health_max: 999 } });
  assert.equal(request.path, "/api/v1/v5/sheets/sheet%2Fid/probabilities");
  assert.deepEqual(request.body, { pool: 6, difficulty: 3, willpower_dice: 2, context_tags: ["fisico"] });
});

test("manual simulation retains Hunger without applying a saved sheet's conditions", () => {
  const request = probabilityRequest({ ...inputs, sheetId: null });
  assert.equal(request.path, "/api/v1/v5/probabilities");
  assert.deepEqual(request.body, { pool: 6, difficulty: 3, willpower_dice: 2, context_tags: ["fisico"], hunger: 5, effects: [], damage: null });
});
