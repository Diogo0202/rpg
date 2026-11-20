import type { Db } from "./db.ts";

/** Trilhas da campanha: playlists ligadas, deixas de música e o "tocando agora". */

const CUE_COLUMNS = "id,campaign_id,session_id,title,scene_type,duration_seconds,brief,notes,audio_url,spotify_uri,version,created_at,updated_at";
const NOW_PLAYING_COLUMNS = "campaign_id,context_uri,track_uri,track_name,position_ms,is_playing,started_at,updated_by,updated_at";

export function listPlaylistLinks(db: Db, campaignId: string) {
  return db.from("campaign_playlist_links").select("playlist_id").eq("campaign_id", campaignId).order("created_at");
}

/** Um link repetido falha com o código 23505; a tela trata como "já está na campanha". */
export function linkPlaylist(db: Db, campaignId: string, playlistId: string) {
  return db.from("campaign_playlist_links").insert({ campaign_id: campaignId, playlist_id: playlistId });
}

export function unlinkPlaylist(db: Db, campaignId: string, playlistId: string) {
  return db.from("campaign_playlist_links").delete().eq("campaign_id", campaignId).eq("playlist_id", playlistId);
}

/** Linha do dono, se o usuário for o dono da campanha. */
export function ownedCampaign(db: Db, campaignId: string, userId: string) {
  return db.from("campaigns").select("id").eq("id", campaignId).eq("owner_id", userId).maybeSingle();
}

export function listCues(db: Db, campaignId: string) {
  return db.from("campaign_music_cues").select(CUE_COLUMNS).eq("campaign_id", campaignId).order("updated_at", { ascending: false });
}

export function listSessionTitles(db: Db, campaignId: string) {
  return db.from("campaign_sessions").select("id,title,sequence").eq("campaign_id", campaignId).order("sequence", { ascending: false });
}

export function insertCue(db: Db, campaignId: string, values: Record<string, unknown>) {
  return db.from("campaign_music_cues").insert({ ...values, campaign_id: campaignId }).select("id").single();
}

/** Grava a deixa só na versão lida; `data` nulo indica conflito. */
export function updateCue(db: Db, cue: { id: string; version: number }, campaignId: string, values: Record<string, unknown>) {
  return db.from("campaign_music_cues").update(values).eq("id", cue.id).eq("campaign_id", campaignId).eq("version", cue.version).select("id").maybeSingle();
}

export function deleteCue(db: Db, cue: { id: string; version: number }, campaignId: string) {
  return db.from("campaign_music_cues").delete().eq("id", cue.id).eq("campaign_id", campaignId).eq("version", cue.version).select("id").maybeSingle();
}

export function nowPlaying(db: Db, campaignId: string) {
  return db.from("campaign_now_playing").select(NOW_PLAYING_COLUMNS).eq("campaign_id", campaignId).maybeSingle();
}

/** Só o narrador ou o dono grava (RLS). */
export function publishNowPlaying(db: Db, state: Record<string, unknown>) {
  return db.from("campaign_now_playing").upsert(state, { onConflict: "campaign_id" });
}
