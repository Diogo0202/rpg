import type { Db } from "./db.ts";

/**
 * Inventário, favoritos do arsenal e listas de compras de uma ficha.
 * Toda escrita filtra pela ficha ou pela versão para que o RLS e a trava
 * otimista recusem a mudança feita sobre dados velhos.
 */

export type InventoryPatch = Record<string, unknown>;

export function listFavorites(db: Db, sheetId: string, campaignId: string) {
  return db.from("character_catalog_favorites").select("catalog_item_id").eq("sheet_id", sheetId).eq("campaign_id", campaignId);
}

export function addFavorite(db: Db, input: { userId: string; sheetId: string; campaignId: string; itemId: string }) {
  return db.from("character_catalog_favorites").insert({ user_id: input.userId, sheet_id: input.sheetId, campaign_id: input.campaignId, catalog_item_id: input.itemId });
}

export function removeFavorite(db: Db, input: { userId: string; sheetId: string; itemId: string }) {
  return db.from("character_catalog_favorites").delete().eq("user_id", input.userId).eq("sheet_id", input.sheetId).eq("catalog_item_id", input.itemId);
}

export function listItems(db: Db, sheetId: string, campaignId: string) {
  return db.from("character_inventory").select("*").eq("sheet_id", sheetId).eq("campaign_id", campaignId).order("sort_order").order("name");
}

export function insertItem(db: Db, sheetId: string, campaignId: string, patch: InventoryPatch) {
  return db.from("character_inventory").insert({ ...patch, sheet_id: sheetId, campaign_id: campaignId }).select("id");
}

export function updateItem(db: Db, item: { id: string; version: number }, sheetId: string, campaignId: string, patch: InventoryPatch) {
  return db.from("character_inventory").update(patch).eq("id", item.id).eq("sheet_id", sheetId).eq("campaign_id", campaignId).eq("version", item.version).select("id");
}

export function deleteItem(db: Db, item: { id: string; version: number }, sheetId: string) {
  return db.from("character_inventory").delete().eq("id", item.id).eq("sheet_id", sheetId).eq("version", item.version).select("id");
}

export function unequipItem(db: Db, item: { id: string; version: number }) {
  return db.from("character_inventory").update({ equipped: false }).eq("id", item.id).eq("version", item.version).select("id");
}

/** A RPC desequipa o item anterior do mesmo tipo na mesma transação. */
export function equipItem(db: Db, item: { id: string; version: number }) {
  return db.rpc("equip_character_item", { p_item_id: item.id, p_expected_version: item.version });
}

export function listShoppingLists(db: Db, sheetId: string, campaignId: string) {
  return db.from("character_shopping_lists").select("id,name,owner_id,shared_with_master,notes,version,updated_at").eq("sheet_id", sheetId).eq("campaign_id", campaignId).order("created_at");
}

export function listShoppingTotals(db: Db, sheetId: string, campaignId: string) {
  return db.from("character_shopping_list_totals").select("*").eq("sheet_id", sheetId).eq("campaign_id", campaignId);
}

export function listShoppingItems(db: Db, listIds: string[]) {
  return db.from("character_shopping_list_items").select("id,list_id,catalog_item_id,name,category,resource_cost,quantity,notes").in("list_id", listIds).order("sort_order").order("created_at");
}

export function createShoppingList(db: Db, sheetId: string, campaignId: string, name: string) {
  return db.from("character_shopping_lists").insert({ sheet_id: sheetId, campaign_id: campaignId, name }).select("id");
}

export function addShoppingItem(db: Db, item: {
  listId: string; campaignId: string; catalogItemId: string; name: string; category: string; resourceCost: number; quantity: number;
}) {
  return db.from("character_shopping_list_items").insert({
    list_id: item.listId, campaign_id: item.campaignId, catalog_item_id: item.catalogItemId, name: item.name,
    category: item.category, resource_cost: item.resourceCost, quantity: item.quantity,
  }).select("id");
}

export function removeShoppingItem(db: Db, itemId: string) {
  return db.from("character_shopping_list_items").delete().eq("id", itemId).select("id");
}

export function shareShoppingList(db: Db, list: { id: string; version: number }, shared: boolean) {
  return db.from("character_shopping_lists").update({ shared_with_master: shared }).eq("id", list.id).eq("version", list.version).select("id");
}

export function deleteShoppingList(db: Db, list: { id: string; version: number }) {
  return db.from("character_shopping_lists").delete().eq("id", list.id).eq("version", list.version).select("id");
}
