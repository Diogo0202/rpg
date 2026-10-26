import type { FieldValue, PriorityPoints, PriorityPool, SheetTemplate } from "./sheet-template.ts";

/**
 * Local mirror of backend/app/services/creation_rules.py (priority_points): the
 * wizard shows what is left while the API stays the authority. Free budgets can
 * be matched to groups in any order, so spending sorted high to low must cover
 * the budgets sorted high to low; freebies spent = sum of
 * (points spent - sum of budgets) x cost over the pools.
 */

type Values = Record<string, FieldValue>;

export function priorityRules(template: SheetTemplate): PriorityPoints[] {
  return (template.creation_rules ?? []).filter((rule): rule is PriorityPoints => rule.type === "priority_points");
}

const numeric = (value: FieldValue | undefined) => typeof value === "number" && Number.isFinite(value) ? value : 0;

export function poolBase(pool: PriorityPool, values: Values): number {
  const highest = (pool.base_from_highest ?? []).map((id) => numeric(values[id])).sort((a, b) => b - a);
  return (pool.base ?? 0) + (pool.base_from ?? []).reduce((sum, id) => sum + numeric(values[id]), 0)
    + highest.slice(0, pool.highest_count ?? 0).reduce((sum, value) => sum + value, 0);
}

/** Fields the select's current value does not let rise above base; all of them while nothing is chosen. */
export function lockedFieldIds(template: SheetTemplate, values: Values): Set<string> {
  const locked = new Set<string>();
  for (const rule of priorityRules(template)) for (const pool of rule.pools) {
    if (!pool.allowed) continue;
    const selected = values[pool.allowed.field];
    const permitted = new Set(typeof selected === "string" ? pool.allowed.cases[selected] ?? [] : []);
    for (const group of pool.groups) for (const id of group.fields) if (!permitted.has(id)) locked.add(id);
  }
  return locked;
}

export type GroupTally = { label: string; spent: number; free: number; fieldIds: string[] };
export type PoolTally = { pool: PriorityPool; base: number; groups: GroupTally[]; shortfall: number; bonus: number; problems: string[] };
export type PriorityTally = { rule: PriorityPoints; pools: PoolTally[]; bonus: number; remaining: number; complete: boolean; problems: string[] };

export function tallyPriority(template: SheetTemplate, rule: PriorityPoints, values: Values): PriorityTally {
  const labels = new Map(template.fields.map((field) => [field.id, field.label]));
  const locked = lockedFieldIds(template, values);
  const pools: PoolTally[] = rule.pools.map((pool) => {
    const base = poolBase(pool, values);
    const problems: string[] = [];
    const spent = pool.groups.map((group) => group.fields.reduce((sum, id) => {
      const value = numeric(values[id]);
      if (!Number.isInteger(value)) problems.push(`${labels.get(id) ?? id} precisa ser inteiro`);
      else if (value < base) problems.push(`${labels.get(id) ?? id} fica abaixo de ${base}`);
      else if (locked.has(id) && value !== base) problems.push(`${labels.get(id) ?? id} não está disponível para esta escolha`);
      return sum + (value - base);
    }, 0));
    // The i-th largest spending takes the i-th largest budget.
    const order = spent.map((_, index) => index).sort((a, b) => spent[b] - spent[a]);
    const budgets = [...pool.budgets].sort((a, b) => b - a);
    const free = new Array<number>(spent.length).fill(0);
    order.forEach((groupIndex, rank) => { free[groupIndex] = budgets[rank] ?? 0; });
    const shortfall = order.reduce((sum, groupIndex, rank) => sum + Math.max(0, (budgets[rank] ?? 0) - spent[groupIndex]), 0);
    const total = spent.reduce((sum, value) => sum + value, 0);
    // Clamped: a pool still short of its budgets has bought nothing yet (the shortfall is reported on its own).
    const bonus = Math.max(0, total - pool.budgets.reduce((sum, value) => sum + value, 0)) * pool.cost;
    return {
      pool, base, shortfall, bonus, problems: [...new Set(problems)],
      groups: pool.groups.map((group, index) => ({ label: group.label, spent: spent[index], free: free[index], fieldIds: group.fields })),
    };
  });
  const bonus = pools.reduce((sum, item) => sum + item.bonus, 0);
  const exact = rule.exact !== false;
  const problems = pools.flatMap((item) => [
    ...item.problems,
    ...(item.shortfall ? [`${item.pool.label}: faltam ${item.shortfall} ${item.shortfall === 1 ? "ponto" : "pontos"} da distribuição inicial`] : []),
  ]);
  if (exact && bonus !== rule.freebies) problems.push(bonus < rule.freebies ? `Bônus: restam ${rule.freebies - bonus} de ${rule.freebies}` : `Bônus: ${bonus - rule.freebies} a mais que os ${rule.freebies} disponíveis`);
  else if (!exact && bonus > rule.freebies) problems.push(`Bônus: ${bonus - rule.freebies} a mais que os ${rule.freebies} disponíveis`);
  return { rule, pools, bonus, remaining: rule.freebies - bonus, complete: problems.length === 0, problems };
}

/**
 * Field updates after a controlling value changed: fields whose base comes from
 * other fields keep the points bought above it (humanity follows virtues), and
 * fields the new selection locks fall back to their base.
 */
export function priorityPatch(template: SheetTemplate, before: Values, after: Values): Values {
  const patch: Values = {};
  for (const rule of priorityRules(template)) for (const pool of rule.pools) {
    const oldBase = poolBase(pool, before);
    const newBase = poolBase(pool, after);
    if (oldBase === newBase) continue;
    for (const group of pool.groups) for (const id of group.fields) {
      if (typeof after[id] !== "number") continue;
      patch[id] = Math.max(newBase, newBase + numeric(after[id]) - oldBase);
    }
  }
  const merged = { ...after, ...patch };
  const locked = lockedFieldIds(template, merged);
  for (const rule of priorityRules(template)) for (const pool of rule.pools) {
    const base = poolBase(pool, merged);
    for (const group of pool.groups) for (const id of group.fields) {
      if (locked.has(id) && numeric(merged[id]) !== base) patch[id] = base;
    }
  }
  return patch;
}
