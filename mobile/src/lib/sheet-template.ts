export const fieldKinds = ["text", "number", "select", "checkbox", "collection", "formula", "roll"] as const;
export type FieldKind = (typeof fieldKinds)[number];
export const creationSteps = ["identity", "attributes", "skills", "traits", "resources", "story", "other"] as const;
export type CreationStep = (typeof creationSteps)[number];
export const identityKinds = ["race", "subrace", "clan", "predator", "creed", "lineage", "origin", "archetype"] as const;
export type IdentityKind = (typeof identityKinds)[number];
export type SelectDependency = {
  field_id: string;
  cases: { equals: string; options: string[] }[];
};

export type SheetField = {
  min?: number | null;
  max?: number | null;
  id: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options: string[];
  depends_on?: SelectDependency;
  expression: string | null;
  creation_step?: CreationStep | null;
  identity_kind?: IdentityKind | null;
  character_name?: boolean;
};

/**
 * Declarative creation rules, numbers only (mirrors frontend/lib/sheet-template.ts
 * and backend/app/services/creation_rules.py). Checked when a sheet is created.
 */
export type CreationDistribution = { label: string; counts: Record<string, number>; rest?: number };
/** What one option grants: dots added to number fields and items a collection must hold. */
export type Grant = { add?: Record<string, number>; items?: Record<string, string[]> };
/** Shown only when another select already holds one of `in` (for example a clan-only discipline). */
export type GrantRequirement = { field: string; in: string[] };
export type GrantChoiceOption = Grant & { label: string; requires?: GrantRequirement | null };
/** A pick the player makes; stored in `field`, a select that depends on the rule's controlling select. */
export type GrantChoice = { field: string; label: string; options: GrantChoiceOption[] };
export type GrantCase = Grant & { equals: string; choices?: GrantChoice[]; homebrew?: boolean };
export type PowerEntry = { name: string; level: number; requires?: { field: string; min: number } | null };
/** Powers of one discipline. `count` and `max_level` are "dots" (the discipline's value) or a fixed number. */
export type PowerSource = { field: string; label: string; powers: PowerEntry[]; count?: "dots" | number; max_level?: "dots" | number };
export type SelectGrantsRule = { type: "select_grants"; id: string; label: string; field: string; fields: string[]; base?: Record<string, number>; cases: GrantCase[] };
export type PowerPicksRule = { type: "power_picks"; id: string; label: string; collection: string; fields: string[]; sources: PowerSource[] };
export type CreationRule =
  | { type: "group_distribution"; id: string; label: string; fields: string[]; options: CreationDistribution[] }
  | { type: "group_sum"; id: string; label: string; fields: string[]; min?: number | null; max?: number | null }
  | { type: "points_budget"; id: string; label: string; fields: string[]; costs: Record<string, number>; budget: number; exact?: boolean }
  | SelectGrantsRule
  | PowerPicksRule;

export type SheetTemplate = {
  name: string;
  version: number;
  fields: SheetField[];
  system_key?: string | null;
  rules_profile_version?: number | null;
  creation_rules?: CreationRule[];
};
export type FieldValue = string | number | boolean | string[];
export type StoredTemplate = { id: string; name: string; version: number; schema: SheetTemplate };

export function characterNameField(template: SheetTemplate): SheetField | undefined {
  return template.fields.find((field) => field.character_name === true && field.kind === "text")
    ?? template.fields.find((field) => field.id === "nome" && field.kind === "text");
}

