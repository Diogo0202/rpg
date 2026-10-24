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
  /** Owner and master only; never shown to the rest of the party or on overlays. */
  private?: boolean;
  /** Hard limits for number fields, enforced by the API and the database on every write. */
  min?: number | null;
  max?: number | null;
};

/**
 * Declarative creation rules, numbers only (mirrors backend/app/services/creation_rules.py).
 * Checked when a sheet is created; later advancement may leave the distribution.
 */
export type CreationDistribution = { label: string; counts: Record<string, number>; rest?: number };
export type CreationRule =
  | { type: "group_distribution"; id: string; label: string; fields: string[]; options: CreationDistribution[] }
  | { type: "group_sum"; id: string; label: string; fields: string[]; min?: number | null; max?: number | null }
  | { type: "points_budget"; id: string; label: string; fields: string[]; costs: Record<string, number>; budget: number; exact?: boolean };

/**
 * System-neutral resource such as V5 Willpower or D&D Inspiration.
 * "pool": spending lowers `field`. "track": spending raises a damage track.
 * Adjusted only through the spend_meta_currency RPC, never by overwriting values.
 */
export type MetaCurrency = {
  id: string;
  label: string;
  field: string;
  mode: "pool" | "track";
  max?: number | null;
  max_field?: string | null;
};

export type SheetTemplate = {
  name: string;
  version: number;
  fields: SheetField[];
  inventory_schema?: SheetField[];
  system_key?: string | null;
  rules_profile_version?: number | null;
  /** Number field holding available XP, changed only through increment_xp. */
  experience_field?: string | null;
  meta_currencies?: MetaCurrency[];
  creation_rules?: CreationRule[];
};
export type FieldValue = string | number | boolean | string[];
export type StoredTemplate = { id: string; name: string; version: number; schema: SheetTemplate };

export function characterNameField(template: SheetTemplate): SheetField | undefined {
  return template.fields.find((field) => field.character_name === true && field.kind === "text")
    ?? template.fields.find((field) => field.id === "nome" && field.kind === "text");
}
