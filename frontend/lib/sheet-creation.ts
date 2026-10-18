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

export type FieldValidation = { valid: true } | { valid: false; message: string };

export function validateField(field: SheetField, value: FieldValue | undefined): FieldValidation {
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
  if (field.kind === "select" && text && !field.options.includes(text)) return { valid: false, message: "Escolha uma das opções disponíveis." };
  if (value !== undefined && typeof value !== "string") return { valid: false, message: "Informe um texto válido." };
  return { valid: true };
}

export function validateFields(fields: SheetField[], values: Record<string, FieldValue>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const result = validateField(field, values[field.id]);
    if (!result.valid) errors[field.id] = result.message;
  }
  return errors;
}
