export type DamageType = "superficial" | "aggravated";

export const DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
  superficial: "Superficial",
  aggravated: "Agravado",
};

export function damageTypeLabel(value: string | null | undefined): string {
  return value === "aggravated" ? DAMAGE_TYPE_LABELS.aggravated : DAMAGE_TYPE_LABELS.superficial;
}
