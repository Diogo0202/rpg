import type { CreationDistribution, CreationRule, FieldValue, SheetTemplate } from "./sheet-template.ts";

export type DistributionRule = Extract<CreationRule, { type: "group_distribution" }>;
/** One row per value the option asks for, highest first, plus the `rest` row for the fields left over. */
export type DistributionSlot = { value: number; need: number; have: number; rest: boolean };
export type DistributionTally = { slots: DistributionSlot[]; complete: boolean; outside: string[] };

/** Distribution rules whose fields belong to these field ids, in template order. */
export function distributionRulesFor(template: SheetTemplate, fieldIds: Iterable<string>): DistributionRule[] {
  const ids = new Set(fieldIds);
  return (template.creation_rules ?? []).filter((rule): rule is DistributionRule => rule.type === "group_distribution" && rule.fields.some((id) => ids.has(id)));
}

/**
 * Compares the filled values with one distribution, mirroring
 * backend/app/services/creation_rules.py: missing numbers count as `rest`.
 */
export function tallyDistribution(rule: DistributionRule, option: CreationDistribution, values: Record<string, FieldValue>): DistributionTally {
  const rest = option.rest ?? 0;
  const numbers = rule.fields.map((id) => typeof values[id] === "number" ? values[id] as number : rest);
  const listed = Object.values(option.counts).reduce((sum, count) => sum + count, 0);
  const needs = new Map<number, number>();
  for (const [key, count] of Object.entries(option.counts)) if (count > 0) needs.set(Number(key), (needs.get(Number(key)) ?? 0) + count);
  const restNeed = rule.fields.length - listed;
  const slots: DistributionSlot[] = [...needs.entries()].sort(([a], [b]) => b - a)
    .map(([value, need]) => ({ value, need: need + (value === rest ? restNeed : 0), have: numbers.filter((number) => number === value).length, rest: false }));
  if (restNeed > 0 && !needs.has(rest)) slots.push({ value: rest, need: restNeed, have: numbers.filter((number) => number === rest).length, rest: true });
  const outside = rule.fields.filter((_, index) => !slots.some((slot) => slot.value === numbers[index]));
  return { slots, complete: outside.length === 0 && slots.every((slot) => slot.have === slot.need), outside };
}

/** Index of the first option the values already satisfy, or -1. */
export function matchingDistribution(rule: DistributionRule, values: Record<string, FieldValue>): number {
  return rule.options.findIndex((option) => tallyDistribution(rule, option, values).complete);
}

