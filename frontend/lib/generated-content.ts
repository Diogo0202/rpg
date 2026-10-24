/**
 * Details the generators write only for the narrator. world_entities is read by
 * every campaign member, so these keys never reach the saved body. The hooks
 * repeat the secret or the weakness in their text, so they go too.
 */
export const NARRATOR_ONLY_DETAILS = ["secret", "story_hook", "weakness", "encounter_hook"] as const;

export function narratorOnlyDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(NARRATOR_ONLY_DETAILS.filter((key) => key in details).map((key) => [key, details[key]]));
}

export function publicGeneratedEntry<T extends { details: Record<string, unknown> }>(entry: T): T {
  const details = Object.fromEntries(Object.entries(entry.details).filter(([key]) => !(NARRATOR_ONLY_DETAILS as readonly string[]).includes(key)));
  return { ...entry, details };
}
