export type ProbabilityInputs = {
  sheetId: string | null;
  pool: number;
  hunger: number;
  difficulty: number;
  willpowerDice: number;
  contextTags: string[];
};

/** A saved sheet's Hunger, effects and damage come from the authenticated server. */
export function probabilityRequest(inputs: ProbabilityInputs) {
  const action = {
    pool: inputs.pool,
    difficulty: inputs.difficulty,
    willpower_dice: inputs.willpowerDice,
    context_tags: inputs.contextTags,
  };
  if (inputs.sheetId) return {
    path: `/api/v1/v5/sheets/${encodeURIComponent(inputs.sheetId)}/probabilities`,
    body: action,
  };
  return {
    path: "/api/v1/v5/probabilities",
    body: { ...action, hunger: inputs.hunger, effects: [], damage: null },
  };
}
