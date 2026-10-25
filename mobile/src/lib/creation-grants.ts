import type { CreationRule, FieldValue, Grant, GrantCase, GrantChoice, GrantChoiceOption, PowerEntry, PowerPicksRule, PowerSource, SelectGrantsRule, SheetTemplate } from "./sheet-template.ts";

/**
 * Clan and predator packages (select_grants) and locked power lists (power_picks).
 * Port of frontend/lib/creation-grants.ts; the rules always come from
 * template.creation_rules, so campaign templates edited on the web apply here too.
 * At creation every field a select_grants rule lists must equal its base plus what
 * the selected cases and chosen options add. Adds on fields no rule lists (Blood
 * Potency) are applied by the wizard but not enforced.
 */

type Values = Record<string, FieldValue>;

export function grantRules(template: SheetTemplate): SelectGrantsRule[] {
  return (template.creation_rules ?? []).filter((rule): rule is SelectGrantsRule => rule.type === "select_grants");
}

export function powerRules(template: SheetTemplate): PowerPicksRule[] {
  return (template.creation_rules ?? []).filter((rule): rule is PowerPicksRule => rule.type === "power_picks");
}

/** Selects that store a grant pick; the wizard asks for them in a picker instead of the field grid. */
export function grantChoiceFieldIds(template: SheetTemplate): Set<string> {
  return new Set(grantRules(template).flatMap((rule) => rule.cases.flatMap((item) => (item.choices ?? []).map((choice) => choice.field))));
}

export function selectedCase(rule: SelectGrantsRule, values: Values): GrantCase | undefined {
  const selected = values[rule.field];
  return typeof selected === "string" ? rule.cases.find((item) => item.equals === selected) : undefined;
}

export function optionAllowed(option: GrantChoiceOption, values: Values): boolean {
  if (!option.requires) return true;
  const current = values[option.requires.field];
  return typeof current === "string" && option.requires.in.includes(current);
}

export function choiceOptions(choice: GrantChoice, values: Values): GrantChoiceOption[] {
  return choice.options.filter((option) => optionAllowed(option, values));
}

export function chosenOption(choice: GrantChoice, values: Values): GrantChoiceOption | undefined {
  const picked = values[choice.field];
  return typeof picked === "string" ? choice.options.find((option) => option.label === picked && optionAllowed(option, values)) : undefined;
}

export type ActiveGrant = { rule: SelectGrantsRule; case: GrantCase | undefined; grants: Grant[]; missing: GrantChoice[] };

export function activeGrants(template: SheetTemplate, values: Values): ActiveGrant[] {
  return grantRules(template).map((rule) => {
    const item = selectedCase(rule, values);
    const grants: Grant[] = item ? [item] : [];
    const missing: GrantChoice[] = [];
    for (const choice of item?.choices ?? []) {
      const option = chosenOption(choice, values);
      if (option) grants.push(option); else missing.push(choice);
    }
    return { rule, case: item, grants, missing };
  });
}

/** Enforced fields with the value they must hold, plus the adds on fields no rule enforces. */
export function grantedNumbers(template: SheetTemplate, values: Values): { enforced: Map<string, number>; deltas: Map<string, number> } {
  const enforced = new Map<string, number>();
  const deltas = new Map<string, number>();
  const active = activeGrants(template, values);
  for (const { rule } of active) for (const id of rule.fields) enforced.set(id, (enforced.get(id) ?? 0) + (rule.base?.[id] ?? 0));
  for (const { grants } of active) for (const grant of grants) for (const [id, amount] of Object.entries(grant.add ?? {})) {
    const target = enforced.has(id) ? enforced : deltas;
    target.set(id, (target.get(id) ?? 0) + amount);
  }
  return { enforced, deltas };
}

export function grantedItems(template: SheetTemplate, values: Values): Map<string, string[]> {
  const items = new Map<string, string[]>();
  for (const { grants } of activeGrants(template, values)) for (const grant of grants) for (const [collection, list] of Object.entries(grant.items ?? {})) {
    items.set(collection, [...new Set([...(items.get(collection) ?? []), ...list])]);
  }
  return items;
}

const strings = (value: FieldValue | undefined) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const numeric = (value: FieldValue | undefined) => typeof value === "number" ? value : 0;

/**
 * Field updates after a controlling choice changed from `before` to `after`:
 * enforced fields take their granted value, unenforced adds move by the
 * difference, and granted collection items are swapped. Powers no longer
 * allowed by the new dots are dropped.
 */
export function applyGrants(template: SheetTemplate, before: Values, after: Values): Values {
  const patch: Values = {};
  const old = grantedNumbers(template, before);
  const next = grantedNumbers(template, after);
  for (const [id, value] of next.enforced) if (after[id] !== value) patch[id] = value;
  for (const id of new Set([...old.deltas.keys(), ...next.deltas.keys()])) {
    const change = (next.deltas.get(id) ?? 0) - (old.deltas.get(id) ?? 0);
    if (change) patch[id] = numeric(after[id]) + change;
  }
  const oldItems = grantedItems(template, before);
  const newItems = grantedItems(template, after);
  for (const collection of new Set([...oldItems.keys(), ...newItems.keys()])) {
    const keep = strings(after[collection]).filter((item) => !(oldItems.get(collection) ?? []).includes(item) || (newItems.get(collection) ?? []).includes(item));
    const result = [...new Set([...keep, ...(newItems.get(collection) ?? [])])];
    if (result.join("\n") !== strings(after[collection]).join("\n")) patch[collection] = result;
  }
  const merged = { ...after, ...patch };
  for (const rule of powerRules(template)) {
    const allowed = new Set(powerStatus(rule, merged).flatMap((status) => status.available.map((power) => powerItem(status.source, power))));
    const chosen = strings(merged[rule.collection]);
    const kept = chosen.filter((item) => allowed.has(item));
    if (kept.length !== chosen.length) patch[rule.collection] = kept;
  }
  return patch;
}

export function powerItem(source: PowerSource, power: PowerEntry): string {
  return `${source.label}: ${power.name}`;
}

export type PowerStatus = { source: PowerSource; dots: number; allowed: number; maxLevel: number; available: PowerEntry[]; chosen: string[] };

function limit(value: "dots" | number | undefined, dots: number): number {
  return value === undefined || value === "dots" ? dots : dots > 0 ? value : 0;
}

export function powerStatus(rule: PowerPicksRule, values: Values): PowerStatus[] {
  const chosen = strings(values[rule.collection]);
  return rule.sources.map((source) => {
    const dots = numeric(values[source.field]);
    const maxLevel = limit(source.max_level, dots);
    const available = source.powers.filter((power) => power.level <= maxLevel && (!power.requires || numeric(values[power.requires.field]) >= power.requires.min));
    return { source, dots, allowed: limit(source.count, dots), maxLevel, available, chosen: chosen.filter((item) => item.startsWith(`${source.label}: `)) };
  });
}

/** Local reasons a step cannot advance; the server repeats every check when the sheet is saved. */
export function grantProblems(template: SheetTemplate, values: Values, fieldIds: Set<string>, labels: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const { rule, case: item, missing } of activeGrants(template, values)) {
    if (!fieldIds.has(rule.field)) continue;
    if (item) for (const choice of missing) problems.push(`${rule.label}: escolha ${choice.label.toLowerCase()}.`);
  }
  for (const rule of powerRules(template)) {
    if (!fieldIds.has(rule.collection)) continue;
    for (const status of powerStatus(rule, values)) if (status.chosen.length !== status.allowed) {
      problems.push(`${rule.label}: ${status.source.label} pede ${status.allowed} ${status.allowed === 1 ? "escolha" : "escolhas"}, há ${status.chosen.length}.`);
    }
  }
  const { enforced } = grantedNumbers(template, values);
  for (const [id, value] of enforced) if (fieldIds.has(id) && numeric(values[id]) !== value) problems.push(`${labels.get(id) ?? id} deve ficar em ${value}.`);
  return problems;
}

/** Choice fields holding an option the current values no longer allow (a clan-only pick after changing clan). */
export function staleGrantChoices(template: SheetTemplate, values: Values): string[] {
  return grantRules(template).flatMap((rule) => (selectedCase(rule, values)?.choices ?? [])
    .filter((choice) => typeof values[choice.field] === "string" && !chosenOption(choice, values))
    .map((choice) => choice.field));
}

/** Player-facing reason for a violated rule. */
export function ruleMessage(rule: CreationRule): string {
  if (rule.type === "group_distribution") {
    const describe = (option: (typeof rule.options)[number]) => {
      const entries = Object.entries(option.counts).filter(([, count]) => count > 0).sort(([a], [b]) => Number(b) - Number(a));
      const left = rule.fields.length - entries.reduce((sum, [, count]) => sum + count, 0);
      const slots = entries.map(([value, count]) => `${count} em ${value}`);
      if (left > 0) slots.push(`${left} em ${option.rest ?? 0}`);
      return `${option.label} (${slots.join(", ")})`;
    };
    return `${rule.label}: distribua como ${rule.options.map(describe).join(" ou ")}.`;
  }
  if (rule.type === "group_sum") return `${rule.label}: a soma deve ficar${typeof rule.min === "number" ? ` a partir de ${rule.min}` : ""}${typeof rule.max === "number" ? ` até ${rule.max}` : ""}.`;
  if (rule.type === "points_budget") return `${rule.label}: gaste ${(rule.exact ?? true) ? "exatamente" : "até"} ${rule.budget} pontos.`;
  if (rule.type === "select_grants") return `${rule.label}: os valores e escolhas concedidos não conferem.`;
  return `${rule.label}: escolha um poder da lista por ponto, até o nível permitido.`;
}

/**
 * Violated rules, mirroring private.creation_rule_violations (and its grant and
 * power helpers) in supabase/migrations/20261025130000_creation_grants.sql, so
 * the wizard refuses offline what the server would refuse after sync.
 */
export function creationRuleViolations(template: SheetTemplate, values: Values): CreationRule[] {
  const rules = template.creation_rules ?? [];
  const violated = new Set<string>();
  for (const rule of rules) {
    if (rule.type !== "group_distribution" && rule.type !== "group_sum" && rule.type !== "points_budget") continue;
    if (rule.fields.some((id) => values[id] !== undefined && typeof values[id] !== "number")) { violated.add(rule.id); continue; }
    const numbers = rule.fields.map((id) => numeric(values[id]));
    if (rule.type === "group_distribution") {
      const actual = [...numbers].sort((a, b) => a - b).join(",");
      const matched = rule.options.some((option) => {
        const entries = Object.entries(option.counts);
        const listed = entries.reduce((sum, [, count]) => sum + count, 0);
        if (listed > numbers.length) return false;
        const expected = [...entries.flatMap(([value, count]) => Array<number>(count).fill(Number(value))), ...Array<number>(numbers.length - listed).fill(option.rest ?? 0)];
        return expected.sort((a, b) => a - b).join(",") === actual;
      });
      if (!matched) violated.add(rule.id);
    } else if (rule.type === "group_sum") {
      const total = numbers.reduce((sum, item) => sum + item, 0);
      if ((typeof rule.min === "number" && total < rule.min) || (typeof rule.max === "number" && total > rule.max)) violated.add(rule.id);
    } else {
      if (numbers.some((item) => !Number.isInteger(item) || !(String(item) in rule.costs))) { violated.add(rule.id); continue; }
      const spent = numbers.reduce((sum, item) => sum + rule.costs[String(item)]!, 0);
      if (spent > rule.budget || ((rule.exact ?? true) && spent !== rule.budget)) violated.add(rule.id);
    }
  }
  for (const id of grantViolations(template, values)) violated.add(id);
  for (const rule of powerRules(template)) if (powerViolated(rule, values)) violated.add(rule.id);
  return rules.filter((rule) => violated.has(rule.id));
}

function grantViolations(template: SheetTemplate, values: Values): Set<string> {
  const rules = grantRules(template);
  const violated = new Set<string>();
  const expected = new Map<string, number>();
  for (const rule of rules) for (const id of rule.fields) expected.set(id, (expected.get(id) ?? 0) + (rule.base?.[id] ?? 0));
  for (const rule of rules) {
    const item = selectedCase(rule, values);
    if (!item) continue;
    // The case itself, then the option picked for each of its choices.
    const picked = (item.choices ?? []).map((choice) => {
      const value = values[choice.field];
      return typeof value === "string" ? choice.options.find((option) => option.label === value) : undefined;
    });
    for (const grant of [item, ...picked.filter((option): option is GrantChoiceOption => option !== undefined)]) {
      if ("requires" in grant && grant.requires && !optionAllowed(grant, values)) { violated.add(rule.id); continue; }
      for (const [id, amount] of Object.entries(grant.add ?? {})) expected.set(id, (expected.get(id) ?? 0) + amount);
      for (const [collection, list] of Object.entries(grant.items ?? {})) {
        const held = values[collection];
        if (list.some((entry) => !Array.isArray(held) || !held.includes(entry))) violated.add(rule.id);
      }
    }
    if (picked.some((option) => option === undefined)) violated.add(rule.id);
  }
  for (const rule of rules) for (const id of rule.fields) {
    if ((values[id] !== undefined && typeof values[id] !== "number") || numeric(values[id]) !== expected.get(id)) violated.add(rule.id);
  }
  return violated;
}

function powerViolated(rule: PowerPicksRule, values: Values): boolean {
  const raw = values[rule.collection] ?? [];
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string") || new Set(raw).size !== raw.length) return true;
  const counts = new Map<string, number>();
  for (const item of raw as string[]) {
    const source = rule.sources.find((candidate) => item.startsWith(`${candidate.label}: `));
    if (!source) return true;
    const power = source.powers.find((candidate) => candidate.name === item.slice(source.label.length + 2));
    const dots = numeric(values[source.field]);
    if (!power || power.level > limit(source.max_level, dots) || (power.requires && numeric(values[power.requires.field]) < power.requires.min)) return true;
    counts.set(source.label, (counts.get(source.label) ?? 0) + 1);
  }
  return rule.sources.some((source) => (counts.get(source.label) ?? 0) !== limit(source.count, numeric(values[source.field])));
}
