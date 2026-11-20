/** Textos e contas do assistente de criação de ficha, sem React. */

import type { DistributionTally } from "../../../shared/rules/sheet-creation.ts";
import type { CreationDistribution, FieldValue } from "../../../shared/rules/sheet-template.ts";
import type { PriorityTally } from "../../../shared/rules/priority-points.ts";

/** Pares [valor, quantidade] de um modo, do maior valor ao menor; o resto do grupo fica em `rest`. */
export function slotsOf(option: CreationDistribution, size: number): Array<[number, number]> {
  const rest = option.rest ?? 0;
  const slots = Object.entries(option.counts).map(([value, count]) => [Number(value), count] as [number, number]).filter(([, count]) => count > 0).sort(([a], [b]) => b - a);
  const left = size - slots.reduce((sum, [, count]) => sum + count, 0);
  return left > 0 ? [...slots, [rest, left]] : slots;
}

export function describeOption(option: CreationDistribution, size: number): string {
  return slotsOf(option, size).map(([value, count]) => `${count} em ${value}`).join(" · ");
}

/** Extra fields at the lowest value are just points not yet placed, not a mistake. */
export function isOver(tally: DistributionTally, slot: DistributionTally["slots"][number]): boolean {
  return slot.have > slot.need && slot.value > Math.min(...tally.slots.map((item) => item.value));
}

export function describeMissing(tally: DistributionTally): string {
  const parts = tally.slots.filter((slot) => slot.have < slot.need || isOver(tally, slot)).map((slot) => slot.have < slot.need
    ? `falta${slot.need - slot.have > 1 ? "m" : ""} ${slot.need - slot.have} em ${slot.value}`
    : `${slot.have - slot.need} a mais em ${slot.value}`);
  if (tally.outside.length) parts.push(`${tally.outside.length} fora da tabela`);
  return parts.length ? `${parts.join(", ")}.` : "confira os valores.";
}

/** Bônus gasto além do disponível, ou o que ainda resta. */
export function bonusStatus(tally: PriorityTally): string {
  return tally.remaining < 0
    ? `Bônus: ${-tally.remaining} a mais que os ${tally.remaining + tally.bonus} disponíveis.`
    : `Pontos de bônus: restam ${tally.remaining} de ${tally.remaining + tally.bonus}.`;
}

export function formatValue(value: FieldValue | undefined): string {
  if (value === undefined || value === "") return "Não informado";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}

export function stringItems(value: FieldValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Erros de um passo sem a lista de regras; a regra única leva o foco ao quadro de regras. */
export function firstInvalidTarget(errors: Record<string, string>, identityStep: boolean): string | null {
  if (errors.$rules && Object.keys(errors).length === 1) return "sheet-rules";
  const first = identityStep && errors.$name ? "$name" : Object.keys(errors)[0];
  if (!first) return null;
  return first === "$name" ? "sheet-character-name" : `sheet-field-${first}`;
}
