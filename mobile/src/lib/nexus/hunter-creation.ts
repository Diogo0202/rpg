import type { FieldValue, SheetTemplate } from "../../../../shared/rules/sheet-template.ts";
import {
  hunterCreationProblems,
  hunterTraitProblems,
  hunterV5CreationProblems,
} from "../../../../shared/rules/hunter-traits.ts";

/** Match the API's template_creation_problems dispatch, using the approved schema. */
export function hunterTemplateCreationProblems(
  template: SheetTemplate,
  values: Record<string, FieldValue>,
): string[] {
  if (template.system_key !== "hunter") return [];
  const ids = new Set(template.fields.map((field) => field.id));
  if (template.version >= 5 && ids.has("pilares")) return hunterV5CreationProblems(values);
  if (!ids.has("conviccao_1")) return [];
  return template.version >= 4 && ids.has("triunfos")
    ? hunterCreationProblems(values)
    : hunterTraitProblems(values);
}
