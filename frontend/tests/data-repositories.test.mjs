import test from "node:test";
import assert from "node:assert/strict";
import { fakeDb } from "./support/fake-db.mjs";
import * as inventory from "../lib/data/inventory.ts";
import * as sheets from "../lib/data/sheets.ts";
import * as v5 from "../lib/data/v5.ts";
import * as hunter from "../lib/data/hunter.ts";
import * as maps from "../lib/data/maps.ts";
import * as combat from "../lib/data/combat.ts";
import * as world from "../lib/data/world.ts";
import * as campaign from "../lib/data/campaign.ts";
import * as journal from "../lib/data/journal.ts";

const item = { id: "item-1", version: 4 };

test("the fake client records the whole chain and resolves with the result", async () => {
  const { db, calls } = fakeDb({ data: [{ id: "x" }], error: null });
  const result = await db.from("t").select("id").eq("a", 1);
  assert.deepEqual(result, { data: [{ id: "x" }], error: null });
  assert.deepEqual(calls, [[["from", "t"], ["select", "id"], ["eq", "a", 1]]]);
});

test("inventory writes keep the sheet, campaign and version guards", () => {
  const { db, calls } = fakeDb();
  inventory.updateItem(db, item, "sheet-1", "camp-1", { name: "Faca" });
  inventory.deleteItem(db, item, "sheet-1");
  inventory.unequipItem(db, item);
  inventory.equipItem(db, item);
  inventory.insertItem(db, "sheet-1", "camp-1", { name: "Faca" });
  assert.deepEqual(calls, [
    [["from", "character_inventory"], ["update", { name: "Faca" }], ["eq", "id", "item-1"], ["eq", "sheet_id", "sheet-1"], ["eq", "campaign_id", "camp-1"], ["eq", "version", 4], ["select", "id"]],
    [["from", "character_inventory"], ["delete"], ["eq", "id", "item-1"], ["eq", "sheet_id", "sheet-1"], ["eq", "version", 4], ["select", "id"]],
    [["from", "character_inventory"], ["update", { equipped: false }], ["eq", "id", "item-1"], ["eq", "version", 4], ["select", "id"]],
    [["rpc", "equip_character_item", { p_item_id: "item-1", p_expected_version: 4 }]],
    [["from", "character_inventory"], ["insert", { name: "Faca", sheet_id: "sheet-1", campaign_id: "camp-1" }], ["select", "id"]],
  ]);
});

test("favorites are scoped to the signed-in user and the sheet", () => {
  const { db, calls } = fakeDb();
  inventory.addFavorite(db, { userId: "u1", sheetId: "s1", campaignId: "c1", itemId: "faca" });
  inventory.removeFavorite(db, { userId: "u1", sheetId: "s1", itemId: "faca" });
  assert.deepEqual(calls, [
    [["from", "character_catalog_favorites"], ["insert", { user_id: "u1", sheet_id: "s1", campaign_id: "c1", catalog_item_id: "faca" }]],
    [["from", "character_catalog_favorites"], ["delete"], ["eq", "user_id", "u1"], ["eq", "sheet_id", "s1"], ["eq", "catalog_item_id", "faca"]],
  ]);
});

test("shopping list changes are guarded by the list version", () => {
  const { db, calls } = fakeDb();
  const list = { id: "list-1", version: 2 };
  inventory.shareShoppingList(db, list, true);
  inventory.deleteShoppingList(db, list);
  inventory.addShoppingItem(db, { listId: "list-1", campaignId: "c1", catalogItemId: "faca", name: "Faca", category: "weapon", resourceCost: 1, quantity: 2 });
  assert.deepEqual(calls, [
    [["from", "character_shopping_lists"], ["update", { shared_with_master: true }], ["eq", "id", "list-1"], ["eq", "version", 2], ["select", "id"]],
    [["from", "character_shopping_lists"], ["delete"], ["eq", "id", "list-1"], ["eq", "version", 2], ["select", "id"]],
    [["from", "character_shopping_list_items"], ["insert", { list_id: "list-1", campaign_id: "c1", catalog_item_id: "faca", name: "Faca", category: "weapon", resource_cost: 1, quantity: 2 }], ["select", "id"]],
  ]);
});

test("the inventory template comes only from an approved template of the same campaign", () => {
  const { db, calls } = fakeDb();
  sheets.sheetTemplateId(db, "s1", "c1");
  sheets.approvedTemplateSchema(db, "t1", "c1");
  assert.deepEqual(calls, [
    [["from", "character_sheets"], ["select", "template_id"], ["eq", "id", "s1"], ["eq", "campaign_id", "c1"], ["single"]],
    [["from", "system_templates"], ["select", "schema"], ["eq", "id", "t1"], ["eq", "campaign_id", "c1"], ["eq", "status", "approved"], ["single"]],
  ]);
});

test("sheet writes keep the campaign and version guards", () => {
  const { db, calls } = fakeDb();
  const sheet = { id: "s1", campaignId: "c1", version: 7 };
  sheets.saveSheetEffects(db, sheet, [{ id: "e1" }]);
  sheets.replaceSheetValues(db, sheet, { fome: 2 }, "id,name");
  sheets.saveSheetSecret(db, "s1", "c1", "segredo");
  assert.deepEqual(calls, [
    [["from", "character_sheets"], ["update", { effects: [{ id: "e1" }] }], ["eq", "id", "s1"], ["eq", "campaign_id", "c1"], ["eq", "version", 7], ["select", "id,name,version,values,effects"], ["maybeSingle"]],
    [["from", "character_sheets"], ["update", { values: { fome: 2 } }], ["eq", "id", "s1"], ["eq", "campaign_id", "c1"], ["eq", "version", 7], ["select", "id,name"], ["maybeSingle"]],
    [["from", "character_sheet_secrets"], ["upsert", { sheet_id: "s1", campaign_id: "c1", notes: "segredo" }, { onConflict: "sheet_id" }]],
  ]);
});

test("the editor bumps the version it read and saves only on that version", () => {
  const { db, calls } = fakeDb();
  sheets.updateSheetValues(db, { id: "s1", campaignId: "c1", version: 3 }, { name: "Lia", values: {}, portrait_path: null });
  const [[from, update, ...rest]] = calls;
  assert.deepEqual(from, ["from", "character_sheets"]);
  assert.equal(update[0], "update");
  assert.equal(update[1].version, 4);
  assert.equal(update[1].name, "Lia");
  assert.match(update[1].updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(rest, [["eq", "id", "s1"], ["eq", "campaign_id", "c1"], ["eq", "version", 3], ["select", sheets.EDITOR_SHEET_COLUMNS], ["maybeSingle"]]);
});

test("a cancellable query receives the screen's signal", () => {
  const { db, calls } = fakeDb();
  const controller = new AbortController();
  sheets.findSheet(db, "s1", "c1", "id", controller.signal);
  sheets.findSheet(db, "s1", "c1", "id");
  v5.applyV5Damage(db, { p_sheet_id: "s1" }, controller.signal);
  assert.deepEqual(calls[0].at(-2), ["abortSignal", controller.signal]);
  assert.ok(!calls[1].some(([name]) => name === "abortSignal"));
  assert.deepEqual(calls[2], [["rpc", "apply_v5_damage", { p_sheet_id: "s1" }], ["abortSignal", controller.signal]]);
});

test("hunter cell updates are guarded by version and bonds point to one kind of target", () => {
  const { db, calls } = fakeDb();
  hunter.updateCell(db, { id: "cell", version: 2 }, { danger: 1, desperation: 3, notes: "" });
  hunter.addCellBond(db, { cellId: "cell", campaignId: "c1", fromSheetId: "s1", kind: "confianca", description: "", toSheetId: null, toTargetId: "t1" });
  assert.deepEqual(calls, [
    [["from", "hunter_cells"], ["update", { danger: 1, desperation: 3, notes: "" }], ["eq", "id", "cell"], ["eq", "version", 2]],
    [["from", "hunter_cell_bonds"], ["insert", { cell_id: "cell", campaign_id: "c1", from_sheet_id: "s1", kind: "confianca", description: "", to_sheet_id: null, to_target_id: "t1" }]],
  ]);
});

test("map and scene writes only land on the version that was read", () => {
  const { db, calls } = fakeDb();
  maps.saveMap(db, { id: "m1", campaign_id: "c1", version: 5 }, { name: "Porto" });
  maps.deleteMap(db, { id: "m1", version: 5 }, "c1");
  combat.updateScene(db, { id: "sc1", campaignId: "c1", version: 9 }, { active: false });
  assert.deepEqual(calls, [
    [["from", "maps"], ["update", { name: "Porto" }], ["eq", "id", "m1"], ["eq", "campaign_id", "c1"], ["eq", "version", 5], ["select", maps.MAP_COLUMNS], ["maybeSingle"]],
    [["from", "maps"], ["delete"], ["eq", "id", "m1"], ["eq", "campaign_id", "c1"], ["eq", "version", 5], ["select", "id"], ["maybeSingle"]],
    [["from", "combat_sessions"], ["update", { active: false }], ["eq", "id", "sc1"], ["eq", "campaign_id", "c1"], ["eq", "version", 9], ["select", combat.SCENE_COLUMNS], ["maybeSingle"]],
  ]);
});

test("players move only their own pin through the RPC", () => {
  const { db, calls } = fakeDb();
  maps.moveOwnPin(db, { mapId: "m1", pinId: "p1", x: 3, y: 4 });
  assert.deepEqual(calls, [[["rpc", "move_own_pin", { p_map_id: "m1", p_pin_id: "p1", p_x: 3, p_y: 4 }]]]);
});

test("world entity changes keep campaign and version guards", () => {
  const { db, calls } = fakeDb();
  world.updateEntity(db, { id: "e1", version: 2 }, "c1", { name: "Ana" });
  world.deleteEntity(db, { id: "e1", version: 2 }, "c1");
  world.createEntity(db, { campaignId: "c1", createdBy: "u1", kind: "npc", name: "Ana", body: {} }, "id,name,kind");
  assert.deepEqual(calls, [
    [["from", "world_entities"], ["update", { name: "Ana" }], ["eq", "id", "e1"], ["eq", "campaign_id", "c1"], ["eq", "version", 2], ["select", "id"]],
    [["from", "world_entities"], ["delete"], ["eq", "id", "e1"], ["eq", "campaign_id", "c1"], ["eq", "version", 2], ["select", "id"]],
    [["from", "world_entities"], ["insert", { campaign_id: "c1", kind: "npc", name: "Ana", body: {}, created_by: "u1" }], ["select", "id,name,kind"], ["single"]],
  ]);
});
test("journal sessions and events are guarded by updated_at and factions by version", () => {
  const { db, calls } = fakeDb();
  const row = { id: "r1", updated_at: "2026-11-20T10:00:00Z" };
  journal.updateDated(db, "campaign_events", row, "c1", { title: "Ataque" });
  journal.deleteDated(db, "campaign_sessions", row, "c1");
  journal.updateFaction(db, { id: "f1", version: 3 }, "c1", { tension: 2 });
  assert.deepEqual(calls, [
    [["from", "campaign_events"], ["update", { title: "Ataque" }], ["eq", "id", "r1"], ["eq", "campaign_id", "c1"], ["eq", "updated_at", row.updated_at], ["select", "id"], ["maybeSingle"]],
    [["from", "campaign_sessions"], ["delete"], ["eq", "id", "r1"], ["eq", "campaign_id", "c1"], ["eq", "updated_at", row.updated_at], ["select", "id"], ["maybeSingle"]],
    [["from", "campaign_factions"], ["update", { tension: 2 }], ["eq", "id", "f1"], ["eq", "campaign_id", "c1"], ["eq", "version", 3], ["select", "id"], ["maybeSingle"]],
  ]);
});

test("an invite is accepted by id or by code, never both", () => {
  const { db, calls } = fakeDb();
  campaign.acceptInvite(db, { inviteId: "i1" });
  campaign.acceptInvite(db, { code: "ABC123DEF456" });
  assert.deepEqual(calls, [
    [["rpc", "accept_campaign_invite", { p_code: null, p_invite_id: "i1" }]],
    [["rpc", "accept_campaign_invite", { p_code: "ABC123DEF456", p_invite_id: null }]],
  ]);
});

test("pending invites exclude expired ones at the given time", () => {
  const { db, calls } = fakeDb();
  campaign.listPendingInvites(db, "c1", new Date("2026-11-20T12:00:00Z"));
  assert.deepEqual(calls[0].slice(3), [["eq", "status", "pending"], ["gt", "expires_at", "2026-11-20T12:00:00.000Z"], ["order", "created_at", { ascending: false }]]);
});