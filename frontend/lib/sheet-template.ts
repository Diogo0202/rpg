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
};

export type SheetTemplate = {
  name: string;
  version: number;
  fields: SheetField[];
  system_key?: string | null;
  rules_profile_version?: number | null;
};
export type FieldValue = string | number | boolean | string[];
export type StoredTemplate = { id: string; name: string; version: number; schema: SheetTemplate };

export function characterNameField(template: SheetTemplate): SheetField | undefined {
  return template.fields.find((field) => field.character_name === true && field.kind === "text")
    ?? template.fields.find((field) => field.id === "nome" && field.kind === "text");
}
