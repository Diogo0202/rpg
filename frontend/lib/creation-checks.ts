import type { CollectionPointsRule, FieldValue, SelectRangeDefault, SelectRangesRule, SheetTemplate, SpecialtyPicksRule } from "./sheet-template.ts";

/**
 * Closed catalogs on collection_points, select_ranges and specialty_picks, mirroring
 * backend/app/services/creation_rules.py and
 * supabase/migrations/20261027150000_v5_creation_catalog.sql. The same file lives in
 * mobile/src/lib/creation-checks.ts; keep both identical. Granted items (a predator's
 * advantages or specialty) are passed in so this module needs no grant logic.
 */

type Values = Record<string, FieldValue>;

const TRAILING_POINTS = /(?:^|[ (])([0-9]{1,2})\)? *$/;
const DETAIL = /^(.+?) *\([^()]*\)$/;

const strings = (value: FieldValue | undefined) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const numeric = (value: FieldValue | undefined) => typeof value === "number" ? value : 0;

function points(item: string): number {
  const dots = [...item].filter((char) => char === "•").length;
  if (dots) return dots;
  const match = TRAILING_POINTS.exec(item);
  return match ? Number(match[1]) : 0;
}

/** Name without points or detail: "Aliados: polícia ••", "Aliados (polícia) (2)" and "Aliados 2" are "Aliados". */
export function itemName(item: string): string {
  const text = (item.includes("•") ? item.split("•").join("") : item.replace(TRAILING_POINTS, ""))
    .replace(/\s+/g, " ").trim().split(":")[0]!.trim();
  const match = DETAIL.exec(text);
  return match ? match[1]!.trim() : text;
}

export const itemNameKey = (item: string) => itemName(item).toLowerCase();

/** Why the player's own items break the rule's catalog; null when they fit or the rule has none. */
export function catalogProblem(rule: CollectionPointsRule, own: string[]): string | null {
  if (!rule.catalog?.length) return null;
  const entries = new Map(rule.catalog.map((entry) => [itemNameKey(entry.name), entry]));
  const outside: string[] = [];
  for (const item of own) {
    const entry = entries.get(itemNameKey(item));
    if (!entry) { if (!rule.allow_homebrew) outside.push(item); continue; }
    if (!entry.costs.includes(points(item))) {
      return `${item} vale ${points(item)}; ${entry.name} aceita ${entry.costs.join(", ")} ${entry.costs.length === 1 && entry.costs[0] === 1 ? "ponto" : "pontos"}`;
    }
  }
  return outside.length ? `${outside.join(", ")} fora do catálogo do modelo (o narrador pode liberar itens da casa no modelo)` : null;
}

export function selectRangeRules(template: SheetTemplate): SelectRangesRule[] {
  return (template.creation_rules ?? []).filter((rule): rule is SelectRangesRule => rule.type === "select_ranges");
}

export function specialtyRules(template: SheetTemplate): SpecialtyPicksRule[] {
  return (template.creation_rules ?? []).filter((rule): rule is SpecialtyPicksRule => rule.type === "specialty_picks");
}

/** Number fields a select_ranges rule constrains, across its cases. */
export function rangedFields(rule: SelectRangesRule): string[] {
  return [...new Set([...rule.cases, ...(rule.default ? [rule.default] : [])].flatMap((item) => Object.keys(item.ranges ?? {})))];
}

/** The case for the select's current value: the first listing it, otherwise `default`; none while empty. */
export function activeRangeCase(rule: SelectRangesRule, values: Values): SelectRangeDefault | undefined {
  const selected = values[rule.field];
  if (typeof selected !== "string" || !selected) return undefined;
  return rule.cases.find((item) => item.equals.includes(selected)) ?? rule.default ?? undefined;
}

export function selectRangeProblem(rule: SelectRangesRule, values: Values, labels: Map<string, string>): string | null {
  const item = activeRangeCase(rule, values);
  if (!item) return null;
  const selected = values[rule.field] as string;
  const problems: string[] = [];
  for (const [id, limit] of Object.entries(item.ranges ?? {})) {
    const value = values[id] ?? 0;
    if (typeof value !== "number" || value < limit.min || value > limit.max) problems.push(`${labels.get(id) ?? id} deve ficar entre ${limit.min} e ${limit.max} para ${selected}`);
  }
  for (const [id, refused] of Object.entries(item.exclude ?? {})) {
    const other = values[id];
    if (typeof other === "string" && refused.includes(other)) problems.push(`${labels.get(id) ?? id} ${other} não combina com ${selected}`);
  }
  return problems.length ? problems.join("; ") : null;
}

export function specialtySkill(rule: SpecialtyPicksRule, item: string) {
  const text = item.trim();
  const lowered = text.toLowerCase();
  return rule.skills.find((skill) => {
    const prefix = `${skill.label.toLowerCase()} (`;
    return lowered.startsWith(prefix) && text.endsWith(")") && text.slice(prefix.length, -1).trim().length > 0;
  });
}

export type SpecialtyStatus = { own: string[]; expected: number; due: string[]; problem: string | null };

/** Own specialties (granted ones excluded), how many are expected, and the first problem. */
export function specialtyStatus(rule: SpecialtyPicksRule, values: Values, granted: string[]): SpecialtyStatus {
  const raw = values[rule.collection] ?? [];
  const labels = new Map(rule.skills.map((skill) => [skill.field, skill.label]));
  const due = rule.required.filter((id) => numeric(values[id]) >= 1);
  const expected = due.length + rule.free;
  const result = (own: string[], problem: string | null): SpecialtyStatus => ({ own, expected, due: due.map((id) => labels.get(id) ?? id), problem });
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) return result([], "a lista precisa conter textos");
  const own = strings(raw).filter((item) => !granted.includes(item));
  if (new Set(own.map((item) => item.trim().toLowerCase())).size !== own.length) return result(own, "há especializações repetidas");
  const picked = new Map<string, number>();
  for (const item of own) {
    const skill = specialtySkill(rule, item);
    if (!skill) return result(own, `${item} precisa seguir o formato Habilidade (especialização) com uma habilidade da lista`);
    if (numeric(values[skill.field]) < 1) return result(own, `${item} pede ao menos 1 ponto em ${skill.label}`);
    picked.set(skill.field, (picked.get(skill.field) ?? 0) + 1);
  }
  const missing = due.filter((id) => !picked.get(id)).map((id) => labels.get(id) ?? id);
  if (missing.length) return result(own, `falta especialização em ${missing.join(", ")}`);
  if (own.length !== expected) return result(own, `${own.length} ${own.length === 1 ? "especialização" : "especializações"}, o esperado é ${expected}`);
  return result(own, null);
}

function ownItems(rule: CollectionPointsRule, values: Values, granted: Map<string, string[]>): string[] {
  const extra = granted.get(rule.collection) ?? [];
  // Items without points are reported by the points check itself.
  return strings(values[rule.collection]).filter((item) => !extra.includes(item) && points(item) > 0);
}

/** Local reasons a wizard step cannot advance, for the fields on that step. */
export function creationCheckProblems(template: SheetTemplate, values: Values, fieldIds: Set<string>, labels: Map<string, string>, granted: Map<string, string[]>): string[] {
  const problems: string[] = [];
  for (const rule of selectRangeRules(template)) {
    if (!fieldIds.has(rule.field) && !rangedFields(rule).some((id) => fieldIds.has(id))) continue;
    const problem = selectRangeProblem(rule, values, labels);
    if (problem) problems.push(`${rule.label}: ${problem}.`);
  }
  for (const rule of specialtyRules(template)) {
    if (!fieldIds.has(rule.collection)) continue;
    const { problem } = specialtyStatus(rule, values, granted.get(rule.collection) ?? []);
    if (problem) problems.push(`${rule.label}: ${problem}.`);
  }
  for (const rule of template.creation_rules ?? []) {
    if (rule.type !== "collection_points" || !fieldIds.has(rule.collection)) continue;
    const problem = catalogProblem(rule, ownItems(rule, values, granted));
    if (problem) problems.push(`${rule.label}: ${problem}.`);
  }
  return problems;
}

/** Ids of violated select_ranges, specialty_picks and catalog checks, as the server would refuse them. */
export function creationCheckViolations(template: SheetTemplate, values: Values, granted: Map<string, string[]>): Set<string> {
  const violated = new Set<string>();
  const labels = new Map<string, string>();
  for (const rule of selectRangeRules(template)) if (selectRangeProblem(rule, values, labels)) violated.add(rule.id);
  for (const rule of specialtyRules(template)) if (specialtyStatus(rule, values, granted.get(rule.collection) ?? []).problem) violated.add(rule.id);
  for (const rule of template.creation_rules ?? []) {
    if (rule.type === "collection_points" && Array.isArray(values[rule.collection] ?? []) && catalogProblem(rule, ownItems(rule, values, granted))) violated.add(rule.id);
  }
  return violated;
}
