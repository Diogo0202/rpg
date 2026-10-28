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
    if (pool.primary_choice) {
      const choice = pool.primary_choice;
      const selected = values[choice.field];
      const primary = typeof selected === "string" ? choice.options[selected] : undefined;
      const ratings = pool.groups.flatMap((group) => group.fields.map((id) => numeric(values[id])));
      if (!primary || locked.has(primary) || numeric(values[primary]) <= 0
          || numeric(values[primary]) < Math.max(0, ...ratings)) {
        problems.push(`${pool.label}: escolha um campo principal permitido com pontuação máxima`);
      }
    }
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
  // V3 Merits cost freebies and Flaws add them, up to their cap (freebie_items).
  const items = freebieItemPoints(rule, values);
  const bonus = pools.reduce((sum, item) => sum + item.bonus, 0) + items.spent;
  const available = rule.freebies + items.earned;
  const exact = rule.exact !== false;
  const problems = pools.flatMap((item) => [
    ...item.problems,
    ...(item.shortfall ? [`${item.pool.label}: faltam ${item.shortfall} ${item.shortfall === 1 ? "ponto" : "pontos"} da distribuição inicial`] : []),
  ]);
  if (exact && bonus !== available) problems.push(bonus < available ? `Bônus: restam ${available - bonus} de ${available}` : `Bônus: ${bonus - available} a mais que os ${available} disponíveis`);
  else if (!exact && bonus > available) problems.push(`Bônus: ${bonus - available} a mais que os ${available} disponíveis`);
  for (const pair of rule.initial_equal ?? []) {
    if (numeric(values[pair.field]) !== numeric(values[pair.source])) {
      const message = `${labels.get(pair.field) ?? pair.field} deve começar igual a ${labels.get(pair.source) ?? pair.source}`;
      problems.push(message);
      pools.find((item) => item.pool.groups.some((group) => group.fields.includes(pair.source)))?.problems.push(message);
    }
  }
  return { rule, pools, bonus, remaining: available - bonus, complete: problems.length === 0, problems };
}

/** Same pattern as item_points in backend/app/services/creation_rules.py: "••" or a trailing number. */
const TRAILING_POINTS = /(?:^|[ (])([0-9]{1,2})\)? *$/;
function itemWorth(item: string): number {
  const dots = [...item].filter((char) => char === "•").length;
  if (dots) return dots;
  const match = TRAILING_POINTS.exec(item);
  return match ? Number(match[1]) : 0;
}
const collectionPoints = (value: FieldValue | undefined) => Array.isArray(value)
  ? value.reduce((sum, item) => sum + (typeof item === "string" ? itemWorth(item) : 0), 0) : 0;

/** Freebies the `spend` collections cost and the ones the `earn` collection adds (capped). */
export function freebieItemPoints(rule: PriorityPoints, values: Values): { spent: number; earned: number } {
  const spec = rule.freebie_items;
  if (!spec) return { spent: 0, earned: 0 };
  const spent = (spec.spend ?? []).reduce((sum, id) => sum + collectionPoints(values[id]), 0);
  const earned = spec.earn ? Math.min(spec.earn.max, collectionPoints(values[spec.earn.collection])) : 0;
  return { spent, earned };
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
  // V3: a Path change resets locked virtues, which moves the Path rating's base once more.
  const reset = { ...merged, ...patch };
  for (const rule of priorityRules(template)) for (const pool of rule.pools) {
    const oldBase = poolBase(pool, merged);
    const newBase = poolBase(pool, reset);
    if (oldBase === newBase) continue;
    for (const group of pool.groups) for (const id of group.fields) {
      if (typeof reset[id] !== "number" || locked.has(id)) continue;
      patch[id] = Math.max(newBase, newBase + numeric(reset[id]) - oldBase);
    }
  }
  for (const rule of priorityRules(template)) for (const pair of rule.initial_equal ?? []) {
    if (numeric(before[pair.source]) !== numeric(merged[pair.source])) {
      patch[pair.field] = numeric(merged[pair.source]);
    }
  }
  return patch;
}
