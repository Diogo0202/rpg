/**
 * Runtime mode for RPG-Atlas Mobile. The app runs in explicit local mode until the
 * RPG-Atlas API and the existing Supabase Auth project are configured and wired.
 */
import { SyncHttpError, type SyncTransport } from "@/lib/mobile-sync/index.ts";

export const LOCAL_ACCOUNT_ID = "local-demo";
export const LOCAL_CAMPAIGN_ID = "campanha-demonstrativa";
export const LOCAL_CAMPAIGN_NAME = "Crônica demonstrativa";
export const REMOTE_BOOTSTRAP_ENTITIES = [
  "campaigns", "system_templates", "character_sheets", "character_inventory", "world_entities", "world_relations",
  "maps", "map_pins", "campaign_sessions", "campaign_factions", "campaign_events", "combat_sessions",
] as const;

/**
 * Writable fields for the LOCAL demo partition only. In connected mode this list must
 * come from GET /sync/capabilities; it is never inferred from forms or local data.
 */
export const LOCAL_ENTITY_FIELDS: Record<string, string[]> = {
  campaign_state: ["current_session_id", "scene"],
  character_sheets: ["name", "system_key", "template_name", "template_version", "template_fields", "values", "effects"],
  character_inventory: ["sheet_id", "name", "category", "quantity", "resource_cost", "damage_bonus", "protection", "notes", "acquired", "equipped", "sort_order", "custom_values"],
  world_entities: ["kind", "name", "description", "tags"],
  maps: ["name", "columns", "rows", "description"],
  map_pins: ["map_id", "label", "x", "y", "note"],
  journal_sessions: ["title", "session_date", "summary"],
  journal_notes: ["session_id", "title", "body"],
  music_links: ["title", "url"],
};

export type ConnectionStatus = {
  mode: "local" | "connected";
  apiUrlConfigured: boolean;
  supabaseUrlConfigured: boolean;
  publishableKeyConfigured: boolean;
  /** True only after real auth + capabilities succeed. Not implemented in this preview. */
  connected: boolean;
  pendingReason: string;
};

export function connectionStatus(mode: ConnectionStatus["mode"] = "local"): ConnectionStatus {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    mode,
    apiUrlConfigured: !!env.VITE_NEXUS_API_URL,
    supabaseUrlConfigured: !!env.VITE_SUPABASE_URL,
    publishableKeyConfigured: !!env.VITE_SUPABASE_PUBLISHABLE_KEY,
    connected: mode === "connected",
    pendingReason: mode === "connected" ? "Conectado à API RPG-Atlas com acesso controlado pelo servidor." : "Prévia local. Entre com uma conta existente e escolha uma campanha para conectar.",
  };
}

/** Transport for local mode: refuses every call, so nothing is ever confirmed by a fake server. */
export class LocalOnlyTransport implements SyncTransport {
  private fail(): never {
    throw new SyncHttpError("Modo local: a API RPG-Atlas não está configurada.", 0, undefined, "local_mode");
  }
  async listCampaigns(): Promise<never> { return this.fail(); }
  async capabilities(): Promise<never> { return this.fail(); }
  async push(): Promise<never> { return this.fail(); }
  async changes(): Promise<never> { return this.fail(); }
  async snapshot(): Promise<never> { return this.fail(); }
}

/** Server-imposed limit on concurrent remote tool calls (documented, enforced by the API). */
export const REMOTE_CONCURRENCY_LIMIT = 10;

