import { anyColumns, type Db } from "./db.ts";

/** Biblioteca do mundo (entidades e relações), compêndio da campanha e ligações com o diário. */

export function listEntities(db: Db, campaignId: string) {
  return db.from("world_entities").select("id,kind,name,body,version").eq("campaign_id", campaignId).order("name");
}

export function listEntityIds(db: Db, campaignId: string) {
  return db.from("world_entities").select("id").eq("campaign_id", campaignId);
}

/** PdMs e itens que podem virar pins no mapa. */
export function listMapEntityOptions(db: Db, campaignId: string) {
  return db.from("world_entities").select("id,name,kind").eq("campaign_id", campaignId).in("kind", ["npc", "item"]).order("name");
}

export function createEntity(db: Db, entity: { campaignId: string; createdBy: string; kind: string; name: string; body: Record<string, unknown> }, columns = "id") {
  return db.from("world_entities").insert({ campaign_id: entity.campaignId, kind: entity.kind, name: entity.name, body: entity.body, created_by: entity.createdBy }).select(anyColumns(columns)).single();
}

export function insertEntity(db: Db, campaignId: string, createdBy: string, patch: Record<string, unknown>) {
  return db.from("world_entities").insert({ ...patch, campaign_id: campaignId, created_by: createdBy }).select("id");
}

export function updateEntity(db: Db, entity: { id: string; version: number }, campaignId: string, patch: Record<string, unknown>) {
  return db.from("world_entities").update(patch).eq("id", entity.id).eq("campaign_id", campaignId).eq("version", entity.version).select("id");
}

export function deleteEntity(db: Db, entity: { id: string; version: number }, campaignId: string) {
  return db.from("world_entities").delete().eq("id", entity.id).eq("campaign_id", campaignId).eq("version", entity.version).select("id");
}

export function listRelations(db: Db, campaignId: string) {
  return db.from("world_relations").select("id,from_entity_id,to_entity_id,relation_type,notes").eq("campaign_id", campaignId);
}

export function createRelation(db: Db, relation: { campaignId: string; fromId: string; toId: string; type: string; createdBy: string }) {
  return db.from("world_relations").insert({ campaign_id: relation.campaignId, from_entity_id: relation.fromId, to_entity_id: relation.toId, relation_type: relation.type, created_by: relation.createdBy }).select("id");
}

export function deleteRelation(db: Db, relationId: string, campaignId: string) {
  return db.from("world_relations").delete().eq("id", relationId).eq("campaign_id", campaignId).select("id");
}

export function listJournalEntityLinks(db: Db, campaignId: string) {
  return db.from("campaign_event_entity_links").select("id,event_id,entity_id,link_kind").eq("campaign_id", campaignId);
}

export function listJournalEventTitles(db: Db, campaignId: string) {
  return db.from("campaign_events").select("id,title,status,occurred_on").eq("campaign_id", campaignId);
}

export function listCompendiumEntries(db: Db, campaignId: string, columns: string) {
  return db.from("campaign_compendium_entries").select(anyColumns(columns)).eq("campaign_id", campaignId).order("updated_at", { ascending: false }).limit(500);
}

export function importCompendiumEntries(db: Db, campaignId: string, entries: unknown[]) {
  return db.rpc("compendium_import_entries", { p_campaign_id: campaignId, p_entries: entries });
}

export function proposeCompendiumEntry(db: Db, payload: Record<string, unknown>) {
  return db.rpc("compendium_propose_entry", payload);
}

export function reviewCompendiumEntry(db: Db, entryId: string, action: string, note: string | null) {
  return db.rpc("compendium_review_entry", { p_entry_id: entryId, p_action: action, p_note: note });
}
