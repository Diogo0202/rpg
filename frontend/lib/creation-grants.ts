import type { CollectionPointsRule, FieldValue, Grant, GrantCase, GrantChoice, GrantChoiceOption, PowerEntry, PowerPicksRule, PowerSource, SelectGrantsRule, SheetField, SheetTemplate } from "./sheet-template.ts";
import { creationCheckProblems } from "./creation-checks.ts";

/**
 * Clan and predator packages (select_grants) and locked power lists (power_picks).
 * Mirrors backend/app/services/creation_rules.py: at creation every field a
 * select_grants rule lists must equal its base plus what the selected cases and
 * chosen options add (plus the `base_by` band, such as Blood Potency by generation),
 * across all such rules. Adds on fields no rule lists are applied but not enforced.
 * collection_points counts the player's own advantage and flaw points.
 */

type Values = Record<string, FieldValue>;

export function grantRules(template: SheetTemplate): SelectGrantsRule[] {
  return (template.creation_rules ?? []).filter((rule): rule is SelectGrantsRule => rule.type === "select_grants");
}

export function powerRules(template: SheetTemplate): PowerPicksRule[] {
  return (template.creation_rules ?? []).filter((rule): rule is PowerPicksRule => rule.type === "power_picks");
}

/** Selects that store a grant pick; the wizard asks for them in a dialog instead of the field grid. */
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

/** The `base_by` band the controlling number falls in (V5 generation -> Blood Potency); undefined when none matches. */
export function activeBand(rule: SelectGrantsRule, values: Values) {
  const value = values[rule.base_by?.field ?? ""];
  return rule.base_by && typeof value === "number" ? rule.base_by.bands.find((band) => band.min <= value && value <= band.max) : undefined;
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
  for (const { rule } of active) for (const id of rule.fields) enforced.set(id, (enforced.get(id) ?? 0) + (rule.base?.[id] ?? 0) + (activeBand(rule, values)?.add?.[id] ?? 0));
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

/** Local reasons the step cannot advance; the API repeats every check when the sheet is saved. */
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
  for (const rule of grantRules(template)) {
    if (!rule.base_by || !fieldIds.has(rule.base_by.field) || activeBand(rule, values)) continue;
    const bands = rule.base_by.bands;
    problems.push(`${labels.get(rule.base_by.field) ?? rule.base_by.field} fora das faixas de criação (${Math.min(...bands.map((band) => band.min))} a ${Math.max(...bands.map((band) => band.max))}).`);
  }
  const { enforced } = grantedNumbers(template, values);
  for (const [id, value] of enforced) if (fieldIds.has(id) && numeric(values[id]) !== value) problems.push(`${labels.get(id) ?? id} deve ficar em ${value}.`);
  for (const rule of collectionPointRules(template)) {
    if (!fieldIds.has(rule.collection) && !rule.fields.some((id) => fieldIds.has(id))) continue;
    const status = collectionPointStatus(template, rule, values);
    if (status.unpriced.length) problems.push(`${rule.label}: indique os pontos de ${status.unpriced.join(", ")} (•• ou (2)).`);
    else if (!status.complete) problems.push(`${rule.label}: ${status.spent} de ${rule.points} pontos.`);
  }
  problems.push(...creationCheckProblems(template, values, fieldIds, labels, grantedItems(template, values)));
  return problems;
}

export function collectionPointRules(template: SheetTemplate): CollectionPointsRule[] {
  return (template.creation_rules ?? []).filter((rule): rule is CollectionPointsRule => rule.type === "collection_points");
}

/** Same pattern as item_points in backend/app/services/creation_rules.py and the SQL mirror. */
const TRAILING_POINTS = /(?:^|[ (])([0-9]{1,2})\)? *$/;

/** "Aliados ••", "Aliados (2)" and "Aliados 2" are worth 2; an item with neither is worth 0. */
export function itemPoints(item: string): number {
  const dots = [...item].filter((char) => char === "•").length;
  if (dots) return dots;
  const match = TRAILING_POINTS.exec(item);
  return match ? Number(match[1]) : 0;
}

export type CollectionPointStatus = { spent: number; own: string[]; unpriced: string[]; complete: boolean };

/** Points the player's own items (granted ones excluded) and the listed number fields spend. */
export function collectionPointStatus(template: SheetTemplate, rule: CollectionPointsRule, values: Values): CollectionPointStatus {
  const granted = grantedItems(template, values).get(rule.collection) ?? [];
  const own = strings(values[rule.collection]).filter((item) => !granted.includes(item));
  const unpriced = own.filter((item) => itemPoints(item) === 0);
  const spent = own.reduce((sum, item) => sum + itemPoints(item), 0) + rule.fields.reduce((sum, id) => sum + numeric(values[id]), 0);
  const complete = unpriced.length === 0 && ((rule.exact ?? true) ? spent === rule.points : spent <= rule.points);
  return { spent, own, unpriced, complete };
}

export type HomebrewDiscipline = { label: string; powers: PowerEntry[]; rituals: PowerEntry[] };
export type HomebrewClan = { name: string; disciplines: string[]; newDisciplines: HomebrewDiscipline[] };

function slug(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
}

/** Parses "nível | nome" lines; blank and malformed lines are skipped. */
export function parsePowerLines(text: string): PowerEntry[] {
  return text.split("\n").map((line) => line.split("|").map((part) => part.trim())).flatMap(([level, name]) => {
    const value = Number(level);
    return name && Number.isInteger(value) && value >= 1 && value <= 5 ? [{ name: name.slice(0, 80), level: value }] : [];
  });
}

/**
 * Adds a homebrew clan: a clan option, its one-dot grants, and any new
 * discipline as a 0-5 number field with its own power and ritual lists.
 * `disciplines` holds existing discipline field ids; new ones are created.
 */
export function addHomebrewClan(template: SheetTemplate, clan: HomebrewClan): SheetTemplate {
  const name = clan.name.trim();
  const clanRule = grantRules(template).find((rule) => template.fields.find((field) => field.id === rule.field)?.identity_kind === "clan");
  if (!clanRule) throw new Error("O modelo não tem uma regra de disciplinas por clã.");
  const clanField = template.fields.find((field) => field.id === clanRule.field)!;
  if (!name) throw new Error("Dê um nome ao clã.");
  if (clanField.options.includes(name)) throw new Error("Já existe um clã com esse nome.");
  const existing = new Set(template.fields.map((field) => field.id));
  const created: Array<{ field: SheetField; discipline: HomebrewDiscipline }> = [];
  for (const discipline of clan.newDisciplines) {
    const label = discipline.label.trim();
    if (!label || label.includes(":")) throw new Error("Cada disciplina nova precisa de um nome sem dois-pontos.");
    let id = `disc_${slug(label) || "nova"}`;
    for (let index = 2; existing.has(id); index += 1) id = `disc_${slug(label)}_${index}`;
    existing.add(id);
    created.push({ discipline: { ...discipline, label }, field: { id, label, kind: "number", required: false, options: [], expression: null, min: 0, max: 5, creation_step: "traits" } });
  }
  const disciplineIds = [...clan.disciplines, ...created.map((item) => item.field.id)];
  if (disciplineIds.length === 0) throw new Error("Escolha ao menos uma disciplina para o clã.");
  if (new Set(disciplineIds).size !== disciplineIds.length) throw new Error("Cada disciplina entra uma vez só.");
  const newIds = created.map((item) => item.field.id);
  const homebrewCase: GrantCase = { equals: name, add: Object.fromEntries(disciplineIds.map((id) => [id, 1])), homebrew: true };
  const powers = powerRules(template).find((rule) => rule.collection === "disciplinas") ?? powerRules(template)[0];
  const rituals = powerRules(template).find((rule) => rule.collection === "rituais");
  return {
    ...template,
    fields: [
      ...template.fields.map((field) => field.id === clanField.id ? { ...field, options: [...field.options, name] } : field),
      ...created.map((item) => item.field),
    ],
    creation_rules: (template.creation_rules ?? []).map((rule) => {
      if (rule.type === "select_grants") {
        const fields = [...rule.fields, ...newIds.filter((id) => rule.id === clanRule.id && !rule.fields.includes(id))];
        return rule.id === clanRule.id ? { ...rule, fields, cases: [...rule.cases, homebrewCase] } : rule;
      }
      if (rule.type === "power_picks" && rule.id === powers?.id) {
        const additions = created.filter((item) => item.discipline.powers.length).map(({ field, discipline }) => ({ field: field.id, label: discipline.label, count: "dots" as const, max_level: "dots" as const, powers: discipline.powers }));
        return { ...rule, fields: [...rule.fields, ...additions.map((item) => item.field)], sources: [...rule.sources, ...additions] };
      }
      if (rule.type === "power_picks" && rule.id === rituals?.id) {
        const additions = created.filter((item) => item.discipline.rituals.length).map(({ field, discipline }) => ({ field: field.id, label: discipline.label, count: 1, max_level: 1, powers: discipline.rituals }));
        return { ...rule, fields: [...rule.fields, ...additions.map((item) => item.field)], sources: [...rule.sources, ...additions] };
      }
      return rule;
    }),
  };
}

/** Removes a homebrew clan and the disciplines only it used. */
export function removeHomebrewClan(template: SheetTemplate, name: string): SheetTemplate {
  const clanRule = grantRules(template).find((rule) => rule.cases.some((item) => item.equals === name && item.homebrew));
  if (!clanRule) return template;
  const removed = clanRule.cases.find((item) => item.equals === name)!;
  const stillUsed = new Set(grantRules(template).flatMap((rule) => rule.cases.filter((item) => item !== removed).flatMap((item) => [
    ...Object.keys(item.add ?? {}), ...(item.choices ?? []).flatMap((choice) => choice.options.flatMap((option) => Object.keys(option.add ?? {}))),
  ])));
  const orphans = new Set(Object.keys(removed.add ?? {}).filter((id) => !stillUsed.has(id)));
  return {
    ...template,
    fields: template.fields.filter((field) => !orphans.has(field.id)).map((field) => field.id === clanRule.field ? { ...field, options: field.options.filter((option) => option !== name) } : field),
    creation_rules: (template.creation_rules ?? []).map((rule) => {
      if (rule.type === "select_grants") return { ...rule, fields: rule.fields.filter((id) => !orphans.has(id)), cases: rule.cases.filter((item) => item !== removed) };
      if (rule.type === "power_picks") return { ...rule, fields: rule.fields.filter((id) => !orphans.has(id)), sources: rule.sources.filter((source) => !orphans.has(source.field)) };
      return rule;
    }).filter((rule) => (rule.type !== "select_grants" && rule.type !== "power_picks") || rule.fields.length > 0),
  };
}

/** Narrator switch: a collection_points catalog also accepts names outside its list. */
export function allowHomebrew(template: SheetTemplate, ruleId: string, allowed: boolean): SheetTemplate {
  return { ...template, creation_rules: (template.creation_rules ?? []).map((rule) => rule.type === "collection_points" && rule.id === ruleId ? { ...rule, allow_homebrew: allowed } : rule) };
}

export function homebrewClans(template: SheetTemplate): GrantCase[] {
  return grantRules(template).flatMap((rule) => rule.cases.filter((item) => item.homebrew));
}
