import { cancellable, type Db } from "./db.ts";

/** RPCs e tabelas próprias do Vampiro V5. */

/** Argumentos montados por `damageRpcArgs` em `lib/v5-action-roll.ts`. */
export type V5DamageArgs = Record<string, unknown>;

export function applyV5Damage(db: Db, args: V5DamageArgs, signal?: AbortSignal) {
  return cancellable(db.rpc("apply_v5_damage", args), signal);
}

export function listNpcNames(db: Db, campaignId: string) {
  return db.from("world_entities").select("id,name").eq("campaign_id", campaignId).eq("kind", "npc").order("name");
}
