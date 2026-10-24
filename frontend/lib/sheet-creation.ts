import { characterNameField, creationSteps, type CreationStep, type FieldValue, type SheetField, type SheetTemplate } from "./sheet-template.ts";

export { characterNameField };

export type CreationGroup = { step: Exclude<CreationStep, "identity">; fields: SheetField[] };

const stepLabels: Record<CreationStep, string> = {
  identity: "Identidade",
  attributes: "Atributos",
  skills: "Habilidades",
  traits: "Traços",
  resources: "Recursos",
  story: "História",
  other: "Outros",
};

export function creationStepLabel(step: CreationStep): string {
  return stepLabels[step];
}

/** XP and pool meta currencies start at zero; only the campaign master grants them (enforced by the database). */
export function masterGrantedFieldIds(template: SheetTemplate): Set<string> {
  const ids = new Set<string>();
  if (template.experience_field) ids.add(template.experience_field);
  for (const currency of template.meta_currencies ?? []) if (currency.mode === "pool") ids.add(currency.field);
  return ids;
}

export function identityFields(template: SheetTemplate): SheetField[] {
  const nameField = characterNameField(template);
  return template.fields.filter((field) => field.id !== nameField?.id && field.creation_step === "identity");
}

export function creationGroups(template: SheetTemplate): CreationGroup[] {
  const nameField = characterNameField(template);
  return creationSteps
    .filter((step): step is Exclude<CreationStep, "identity"> => step !== "identity")
    .map((step) => ({
      step,
      fields: template.fields.filter((field) => {
        if (field.id === nameField?.id || field.creation_step === "identity") return false;
        const declaredStep = creationSteps.includes(field.creation_step as CreationStep) ? field.creation_step : "other";
        return declaredStep === step;
      }),
    }))
    .filter((group) => group.fields.length > 0);
}

export function isFieldActive(template: SheetTemplate, field: SheetField, values: Record<string, FieldValue>, visiting = new Set<string>()): boolean {
  const dependency = field.depends_on;
  if (!dependency) return true;
  if (visiting.has(field.id)) return false;
  const parent = template.fields.find((candidate) => candidate.id === dependency.field_id);
  if (!parent || parent.kind !== "select") return false;
  const path = new Set(visiting);
  path.add(field.id);
  if (!isFieldActive(template, parent, values, path)) return false;
  const selected = values[parent.id];
  if (typeof selected !== "string") return false;
  const parentOptions = parent.depends_on ? fieldOptions(template, parent, values) : parent.options;
  return parentOptions.includes(selected) && dependency.cases.some((item) => item.equals === selected);
}

export function fieldOptions(template: SheetTemplate, field: SheetField, values: Record<string, FieldValue>): string[] {
  if (!field.depends_on) return field.options;
  if (!isFieldActive(template, field, values)) return [];
  const parentValue = values[field.depends_on.field_id];
  if (typeof parentValue !== "string") return [];
  return field.depends_on.cases.find((item) => item.equals === parentValue)?.options ?? [];
}

export function reconcileDependentValues(template: SheetTemplate, values: Record<string, FieldValue>): { values: Record<string, FieldValue>; removedIds: string[] } {
  const next = { ...values };
  const removed = new Set<string>();
  for (let pass = 0; pass <= template.fields.length; pass += 1) {
    let changed = false;
    for (const field of template.fields) {
      if (!field.depends_on) continue;
      const active = isFieldActive(template, field, next);
      if (!active) {
        if (next[field.id] !== undefined) {
          delete next[field.id];
          changed = true;
        }
        removed.add(field.id);
        continue;
      }
      if (next[field.id] === undefined) continue;
      const value = next[field.id];
      const options = fieldOptions(template, field, next);
      const invalid = typeof value !== "string" || !options.includes(value);
      if (invalid) {
        delete next[field.id];
        removed.add(field.id);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { values: next, removedIds: [...removed] };
}

export type FieldValidation = { valid: true } | { valid: false; message: string };

export function validateField(field: SheetField, value: FieldValue | undefined, options = field.options): FieldValidation {
  if (field.kind === "formula" || field.kind === "roll") return { valid: true };
  if (field.kind === "checkbox") {
    if (value !== undefined && typeof value !== "boolean") return { valid: false, message: "Marque ou desmarque esta opção." };
    if (field.required && value !== true) return { valid: false, message: "Marque esta opção." };
    return { valid: true };
  }

  if (field.kind === "number") {
    const empty = value === undefined || value === "";
    if (empty && field.required) return { valid: false, message: "Informe um número." };
    if (!empty && (typeof value !== "number" || !Number.isFinite(value))) return { valid: false, message: "Informe um número válido." };
    return { valid: true };
  }

  if (field.kind === "collection") {
    const items = Array.isArray(value) ? value : [];
    if (field.required && items.length === 0) return { valid: false, message: "Adicione ao menos um item." };
    if (!Array.isArray(value) && value !== undefined) return { valid: false, message: "Informe uma lista de itens." };
    if (items.some((item) => typeof item !== "string")) return { valid: false, message: "A lista deve conter apenas textos." };
    return { valid: true };
  }

  const text = typeof value === "string" ? value.trim() : "";
  if (field.required && !text) return { valid: false, message: "Preencha este campo." };
  if (field.kind === "select" && text && !options.includes(text)) return { valid: false, message: "Escolha uma das opções disponíveis." };
  if (value !== undefined && typeof value !== "string") return { valid: false, message: "Informe um texto válido." };
  return { valid: true };
}

export function validateFields(fields: SheetField[], values: Record<string, FieldValue>, template?: SheetTemplate): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (template && !isFieldActive(template, field, values)) continue;
    const result = validateField(field, values[field.id], template ? fieldOptions(template, field, values) : field.options);
    if (!result.valid) errors[field.id] = result.message;
  }
  return errors;
}
