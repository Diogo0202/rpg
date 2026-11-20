/**
 * Details the generators write only for the narrator. world_entities is read by
 * every campaign member, so these keys never reach the saved body. The hooks
 * repeat the secret or the weakness in their text, so they go too.
 */
export const NARRATOR_ONLY_DETAILS = ["secret", "story_hook", "weakness", "encounter_hook", "combat_block"] as const;

/** GER-05: bloco de combate genérico devolvido pela API (números a conferir no livro). */
export type CombatBlock = {
  system: string; system_label: string; tier: string; tier_label: string; seed: number;
  initiative: number; initiative_rule: string; health: number; health_label: string;
  defense: number; defense_label: string; attack: string; damage: string;
  stats: Record<string, number | string | boolean>; abilities: string[];
  needs_book_check: boolean; review_note: string;
};

export function combatBlockOf(details: Record<string, unknown>): CombatBlock | null {
  const block = details.combat_block;
  if (!block || typeof block !== "object" || Array.isArray(block)) return null;
  const value = block as Partial<CombatBlock>;
  return typeof value.initiative === "number" && typeof value.health === "number" && typeof value.system === "string" ? value as CombatBlock : null;
}

export function narratorOnlyDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(NARRATOR_ONLY_DETAILS.filter((key) => key in details).map((key) => [key, details[key]]));
}

export function publicGeneratedEntry<T extends { details: Record<string, unknown> }>(entry: T): T {
  const details = Object.fromEntries(Object.entries(entry.details).filter(([key]) => !(NARRATOR_ONLY_DETAILS as readonly string[]).includes(key)));
  return { ...entry, details };
}
