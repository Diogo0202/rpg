/** Edição de modelos de ficha e coleta de valores, sem React. */

import { characterNameField, type FieldKind, type FieldValue, type SheetField, type SheetTemplate } from "../../../shared/rules/sheet-template.ts";
import { fieldOptions, isFieldActive } from "../../../shared/rules/sheet-creation.ts";

export const STEP_LABELS = { identity: "Identidade", attributes: "Atributos", skills: "Habilidades", traits: "Poderes e vantagens", resources: "Recursos", story: "História", other: "Outros" };
export const IDENTITY_LABELS = { race: "Raça", subrace: "Sub-raça", clan: "Clã", predator: "Predador", creed: "Credo", lineage: "Linhagem", origin: "Origem", archetype: "Arquétipo" };
/** Coleções que ganham links para o compêndio. */
export const COMPENDIUM_COLLECTIONS = ["disciplinas", "vantagens"];

const ROLL_EXPRESSION = /^[1-9][0-9]?d[1-9][0-9]{0,3}(?:[+-][0-9]{1,5})?$/i;

export const INITIAL_TEMPLATE: SheetTemplate = {
  name: "Investigador do Outro Lado",
  version: 1,
  fields: [
    { id: "nome", label: "Nome", kind: "text", required: true, options: [], expression: null },
    { id: "vigor", label: "Vigor", kind: "number", required: true, options: [], expression: null },
    { id: "astucia", label: "Astúcia", kind: "number", required: true, options: [], expression: null },
    { id: "perfil", label: "Área de atuação", kind: "select", required: false, options: ["Investigação", "Medicina", "Ocultismo"], expression: null },
    { id: "ferimentos", label: "Ferimentos", kind: "number", required: false, options: [], expression: null },
    { id: "contatos", label: "Contatos", kind: "collection", required: false, options: [], expression: null },
    { id: "protegido", label: "Tem proteção", kind: "checkbox", required: false, options: [], expression: null },
    { id: "parada", label: "Parada de investigação", kind: "formula", required: false, options: [], expression: "vigor + astucia" },
    { id: "teste", label: "Teste de risco", kind: "roll", required: false, options: [], expression: "2d6+3" },
  ],
};

/** Todas as opções que um campo de escolha pode ter, somando os casos de dependência. */
export function possibleTemplateOptions(field: SheetField): string[] {
  return [...new Set(field.depends_on ? field.depends_on.cases.flatMap((item) => item.options) : field.options)];
}

/** Ligar `childId` a `proposedParentId` fecharia um ciclo de dependências? */
export function createsDependencyCycle(template: SheetTemplate, childId: string, proposedParentId: string): boolean {
  let current = template.fields.find((field) => field.id === proposedParentId);
  const visited = new Set<string>();
  while (current?.depends_on) {
    if (current.id === childId || visited.has(current.id)) return true;
    visited.add(current.id);
    current = template.fields.find((field) => field.id === current?.depends_on?.field_id);
  }
  return current?.id === childId;
}

/** O primeiro caso de dependência cujo valor não existe mais nas opções do campo controlador. */
export function orphanedDependencyCase(template: SheetTemplate): { field: SheetField; equals: string } | null {
  for (const field of template.fields) {
    if (!field.depends_on) continue;
    const parent = template.fields.find((candidate) => candidate.id === field.depends_on?.field_id);
    const parentOptions = parent ? possibleTemplateOptions(parent) : [];
    const orphan = field.depends_on.cases.find((item) => !parentOptions.includes(item.equals));
    if (orphan) return { field, equals: orphan.equals };
  }
  return null;
}

/** Campos que dependiam de `parentId` passam a ter opções fixas, com a união dos casos. */
export function releaseDependents(fields: SheetField[], parentId: string): SheetField[] {
  return fields.map((field) => field.depends_on?.field_id === parentId
    ? { ...field, options: [...new Set(field.depends_on.cases.flatMap((item) => item.options))], depends_on: undefined }
    : field);
}

/** Troca o ID do campo nas dependências e nas expressões que citam o ID antigo. */
export function renameFieldInTemplate(template: SheetTemplate, fieldId: string, nextId: string): SheetTemplate {
  const reference = new RegExp(`(^|[^a-z0-9_])${fieldId}(?=$|[^a-z0-9_])`, "g");
  return {
    ...template,
    fields: template.fields.map((field) => ({
      ...field,
      ...(field.id === fieldId ? { id: nextId } : {}),
      ...(field.depends_on?.field_id === fieldId ? { depends_on: { ...field.depends_on, field_id: nextId } } : {}),
      ...(field.expression ? { expression: field.expression.replace(reference, `$1${nextId}`) } : {}),
    })),
  };
}

export function nextFieldId(template: SheetTemplate): string {
  let suffix = template.fields.length + 1;
  while (template.fields.some((field) => field.id === `campo_${suffix}`)) suffix += 1;
  return `campo_${suffix}`;
}

/** Ajustes de um campo quando o tipo muda: cada tipo guarda só o que usa. */
export function kindChange(field: SheetField, kind: FieldKind): Partial<SheetField> {
  return {
    kind,
    character_name: kind === "text" && field.character_name === true,
    identity_kind: kind === "select" ? field.identity_kind : null,
    depends_on: kind === "select" ? field.depends_on : undefined,
    options: kind === "select" ? (field.options.length ? field.options : ["Opção 1"]) : [],
    expression: kind === "formula" ? (field.expression ?? "") : kind === "roll" ? (field.expression ?? "2d6") : null,
  };
}

/** Casos de dependência para um novo controlador, reaproveitando os já configurados para ele. */
export function dependencyCases(field: SheetField, parent: SheetField) {
  const previous = field.depends_on?.field_id === parent.id ? field.depends_on.cases : [];
  const equalsValues = [...new Set(possibleTemplateOptions(parent))];
  return equalsValues.length
    ? equalsValues.map((equals) => ({ equals, options: previous.find((item) => item.equals === equals)?.options ?? field.options }))
    : previous;
}

export function linesToList(text: string): string[] {
  return text.split("\n").map((item) => item.trim()).filter(Boolean);
}

export function stringItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Os valores com o campo de nome sincronizado ao nome da ficha. */
export function valuesWithName(template: SheetTemplate, values: Record<string, FieldValue>, name: string): Record<string, FieldValue> {
  const nameField = characterNameField(template);
  return nameField ? { ...values, [nameField.id]: name } : values;
}

/**
 * Valores prontos para gravar: só campos ativos, sem fórmulas e rolagens, com números convertidos.
 * Com `partial`, campos obrigatórios vazios não interrompem (prévia enquanto a ficha é preenchida).
 */
export function collectSheetValues(template: SheetTemplate, values: Record<string, FieldValue>, sheetName: string, partial = false): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const nameFieldId = characterNameField(template)?.id;
  for (const field of template.fields) {
    if (!isFieldActive(template, field, values)) continue;
    if (field.kind === "formula" || field.kind === "roll") continue;
    const value = nameFieldId === field.id ? sheetName : values[field.id];

    if (field.kind === "number") {
      if (value === undefined || value === "") {
        if (field.required && !partial) throw new Error(`${field.label}: informe um número.`);
        continue;
      }
      if (typeof value !== "number" && typeof value !== "string") throw new Error(`${field.label}: informe um número válido.`);
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) throw new Error(`${field.label}: informe um número válido.`);
      output[field.id] = numberValue;
      continue;
    }

    if (field.kind === "checkbox") {
      const checked = value === true;
      if (field.required && !checked && !partial) throw new Error(`${field.label}: marque esta opção.`);
      output[field.id] = checked;
      continue;
    }

    if (field.kind === "collection") {
      const items = Array.isArray(value) ? value : [];
      if (field.required && items.length === 0 && !partial) throw new Error(`${field.label}: adicione ao menos um item.`);
      output[field.id] = items;
      continue;
    }

    const text = typeof value === "string" ? value.trim() : "";
    if (field.required && !text && !partial) throw new Error(`${field.label}: preencha este campo.`);
    if (field.kind === "select" && text && !fieldOptions(template, field, values).includes(text)) throw new Error(`${field.label}: escolha uma opção do modelo.`);
    if (text) output[field.id] = text;
  }

  for (const field of template.fields.filter((item) => item.kind === "roll")) {
    if (!field.expression || !ROLL_EXPRESSION.test(field.expression.replaceAll(" ", ""))) {
      throw new Error(`${field.label}: use uma rolagem como 2d6+3.`);
    }
  }
  return output;
}
