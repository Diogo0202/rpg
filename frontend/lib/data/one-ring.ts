import type { Db } from "./db.ts";

/** Consultas da Companhia de O Um Anel que preparam o modo offline. */

export function listPlayedSessions(db: Db, campaignId: string) {
  return db.from("campaign_sessions").select("id,sequence,title,status").eq("campaign_id", campaignId).in("status", ["played"]).order("sequence", { ascending: false });
}

export function findSessionStatus(db: Db, campaignId: string, sessionId: string) {
  return db.from("campaign_sessions").select("id,status").eq("campaign_id", campaignId).eq("id", sessionId).maybeSingle();
}

export function listSheetCandidates(db: Db, campaignId: string) {
  return db.from("character_sheets").select("id,name,owner_id,template_id").eq("campaign_id", campaignId).order("name");
}

export function templateSchemas(db: Db, templateIds: string[]) {
  return db.from("system_templates").select("id,schema").in("id", templateIds);
}

/** Modelos aprovados do perfil de regras 3 de O Um Anel. */
export function listApprovedV3Templates(db: Db, campaignId: string) {
  return db.from("system_templates").select("id,name").eq("campaign_id", campaignId).eq("status", "approved").eq("version", 3).contains("schema", { system_key: "one-ring", rules_profile_version: 3 });
}