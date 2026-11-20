import type { Db } from "./db.ts";

/** Mapas da campanha: o narrador lê e grava a tabela; os jogadores usam as RPCs de mapa compartilhado. */

export const MAP_COLUMNS = "id,campaign_id,name,document,version,system_key,shared_with_players,updated_at";

export function listMaps(db: Db, campaignId: string) {
  return db.from("maps").select(MAP_COLUMNS).eq("campaign_id", campaignId).order("updated_at", { ascending: false });
}

export function createMap(db: Db, map: { campaignId: string; name: string; createdBy: string; systemKey: string | null; document: unknown }) {
  return db.from("maps")
    .insert({ campaign_id: map.campaignId, name: map.name, created_by: map.createdBy, system_key: map.systemKey, document: map.document })
    .select(MAP_COLUMNS).single();
}

/** Mapa gerado pela API; o sistema fica com o padrão do banco. */
export function createGeneratedMap(db: Db, map: { campaignId: string; name: string; createdBy: string; document: unknown }) {
  return db.from("maps").insert({ campaign_id: map.campaignId, name: map.name, document: map.document, created_by: map.createdBy }).select("id").single();
}

export function deleteMap(db: Db, map: { id: string; version: number }, campaignId: string) {
  return db.from("maps").delete().eq("id", map.id).eq("campaign_id", campaignId).eq("version", map.version).select("id").maybeSingle();
}

/** Grava o mapa só na versão lida; `data` nulo indica que outra sessão mudou o mapa. */
export function saveMap(db: Db, map: { id: string; campaign_id: string; version: number }, patch: Record<string, unknown>) {
  return db.from("maps").update(patch)
    .eq("id", map.id).eq("campaign_id", map.campaign_id).eq("version", map.version)
    .select(MAP_COLUMNS).maybeSingle();
}

export function listPlayerMaps(db: Db, campaignId: string) {
  return db.rpc("list_player_maps", { p_campaign_id: campaignId });
}

export function getPlayerMap(db: Db, mapId: string) {
  return db.rpc("get_player_map", { p_map_id: mapId });
}

/** O jogador só move o pin do próprio personagem; a RPC confere o dono. */
export function moveOwnPin(db: Db, pin: { mapId: string; pinId: string; x: number; y: number }) {
  return db.rpc("move_own_pin", { p_map_id: pin.mapId, p_pin_id: pin.pinId, p_x: pin.x, p_y: pin.y });
}

/** Referências usadas na importação: fichas com dono, entidades e membros da campanha. */
export function listSheetOwners(db: Db, campaignId: string) {
  return db.from("character_sheets").select("id,owner_id").eq("campaign_id", campaignId);
}

export function listOwnSheetIds(db: Db, campaignId: string, ownerId: string) {
  return db.from("character_sheets").select("id").eq("campaign_id", campaignId).eq("owner_id", ownerId);
}

export function listMapSheetOptions(db: Db, campaignId: string) {
  return db.from("character_sheets").select("id,name,portrait_path,owner_id").eq("campaign_id", campaignId).order("name");
}
