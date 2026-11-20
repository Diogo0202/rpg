import type { Db } from "./db.ts";

/**
 * Diário da campanha: sessões, facções, eventos e as ligações dos eventos com
 * o mundo. Sessões e eventos usam `updated_at` como trava otimista; facções
 * usam `version`. Em toda escrita, `data` nulo indica que outra sessão mudou a linha.
 */

export type JournalTable = "campaign_sessions" | "campaign_events";

export function listSessions(db: Db, campaignId: string) {
  return db.from("campaign_sessions").select("*").eq("campaign_id", campaignId).order("sequence", { ascending: true });
}

export function listFactions(db: Db, campaignId: string) {
  return db.from("campaign_factions").select("*").eq("campaign_id", campaignId).order("name", { ascending: true });
}

export function listEvents(db: Db, campaignId: string) {
  return db.from("campaign_events").select("*").eq("campaign_id", campaignId).order("occurred_on", { ascending: true }).order("created_at", { ascending: true });
}

export function listLinkableEntities(db: Db, campaignId: string, kinds: readonly string[]) {
  return db.from("world_entities").select("id,kind,name").eq("campaign_id", campaignId).in("kind", [...kinds]).order("name", { ascending: true });
}

export function listEventLinks(db: Db, campaignId: string) {
  return db.from("campaign_event_entity_links").select("id,event_id,entity_id,link_kind,notes").eq("campaign_id", campaignId);
}

export function insertDated(db: Db, table: JournalTable, campaignId: string, values: Record<string, unknown>) {
  return db.from(table).insert({ campaign_id: campaignId, ...values });
}

export function updateDated(db: Db, table: JournalTable, row: { id: string; updated_at: string }, campaignId: string, values: Record<string, unknown>) {
  return db.from(table).update(values).eq("id", row.id).eq("campaign_id", campaignId).eq("updated_at", row.updated_at).select("id").maybeSingle();
}

export function deleteDated(db: Db, table: JournalTable, row: { id: string; updated_at: string }, campaignId: string) {
  return db.from(table).delete().eq("id", row.id).eq("campaign_id", campaignId).eq("updated_at", row.updated_at).select("id").maybeSingle();
}

export function insertFaction(db: Db, campaignId: string, values: Record<string, unknown>) {
  return db.from("campaign_factions").insert({ campaign_id: campaignId, ...values });
}

export function updateFaction(db: Db, faction: { id: string; version: number }, campaignId: string, values: Record<string, unknown>) {
  return db.from("campaign_factions").update(values).eq("id", faction.id).eq("campaign_id", campaignId).eq("version", faction.version).select("id").maybeSingle();
}

export function deleteFaction(db: Db, faction: { id: string; version: number }, campaignId: string) {
  return db.from("campaign_factions").delete().eq("id", faction.id).eq("campaign_id", campaignId).eq("version", faction.version).select("id").maybeSingle();
}

export function linkEventEntity(db: Db, link: { campaignId: string; eventId: string; entityId: string; kind: string }) {
  return db.from("campaign_event_entity_links").insert({ campaign_id: link.campaignId, event_id: link.eventId, entity_id: link.entityId, link_kind: link.kind });
}

export function unlinkEventEntity(db: Db, linkId: string, campaignId: string) {
  return db.from("campaign_event_entity_links").delete().eq("id", linkId).eq("campaign_id", campaignId).select("id").maybeSingle();
}
