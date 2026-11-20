import type { Db } from "./db.ts";

/** Campanha, membros, presença e chat. */

export function listMemberIds(db: Db, campaignId: string) {
  return db.from("campaign_members").select("user_id").eq("campaign_id", campaignId);
}
