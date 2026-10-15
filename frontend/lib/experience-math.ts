export type ExperienceKind = "attribute" | "skill" | "discipline" | "outOfClanDiscipline" | "bloodPotency";

const multipliers: Record<ExperienceKind, number> = {
  attribute: 5,
  skill: 3,
  discipline: 5,
  outOfClanDiscipline: 7,
  bloodPotency: 10,
};

export function calculateExperienceCost(kind: ExperienceKind, current: number, target: number): number {
  if (!Object.prototype.hasOwnProperty.call(multipliers,kind)) throw new RangeError("Categoria de avanço inválida.");
  if (!Number.isInteger(current) || current < 0 || current > 5) throw new RangeError("O nível atual deve ficar entre 0 e 5.");
  if (!Number.isInteger(target) || target < 1 || target > 5) throw new RangeError("O nível desejado deve ficar entre 1 e 5.");
  if (target <= current) throw new RangeError("O nível desejado deve superar o nível atual.");
  let cost = 0;
  for (let rank = current + 1; rank <= target; rank += 1) cost += rank * multipliers[kind];
  return cost;
}
