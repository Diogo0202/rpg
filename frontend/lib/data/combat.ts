import type { Db } from "./db.ts";

/**
 * Cenas e combates (`combat_sessions`) e as notas de cena (`combat_events`).
 * A inclusão de participantes com nova tentativa fica em `lib/combat-state.ts`.
 */

export const SCENE_COLUMNS = "id,campaign_id,title,state,active,created_by,version,created_at";
const NOTE_COLUMNS = "id,combat_id,actor_id,event_type,payload,created_at";

export function listScenes(db: Db, campaignId: string) {
  return db.from("combat_sessions").select(SCENE_COLUMNS).eq("campaign_id", campaignId).order("created_at", { ascending: false });
}

export function listActiveCombats(db: Db, campaignId: string) {
  return db.from("combat_sessions").select("id,title").eq("campaign_id", campaignId).eq("active", true).order("created_at", { ascending: false }).limit(50);
}

export function createScene(db: Db, scene: { campaignId: string; title: string; state: unknown; createdBy: string }) {
  return db.from("combat_sessions").insert({ campaign_id: scene.campaignId, title: scene.title, state: scene.state, active: true, created_by: scene.createdBy }).select(SCENE_COLUMNS).single();
}

/** Muda a cena só na versão lida; `data` nulo indica que outra sessão mudou a cena. */
export function updateScene(db: Db, scene: { id: string; campaignId: string; version: number }, patch: { state?: unknown; active?: boolean }) {
  return db.from("combat_sessions").update(patch).eq("id", scene.id).eq("campaign_id", scene.campaignId).eq("version", scene.version).select(SCENE_COLUMNS).maybeSingle();
}

export function listSceneNotes(db: Db, combatIds: string[]) {
  return db.from("combat_events").select(NOTE_COLUMNS).in("combat_id", combatIds).eq("event_type", "notes").order("created_at", { ascending: false }).limit(500);
}

export function addSceneNote(db: Db, note: { combatId: string; actorId: string; description: string }) {
  return db.from("combat_events").insert({ combat_id: note.combatId, actor_id: note.actorId, event_type: "notes", payload: { description: note.description } }).select(NOTE_COLUMNS).single();
}
