import { SYSTEM_STARTERS, type SystemStarter } from "@/lib/system-starters.ts";
import type { FieldValue, SheetField, SheetTemplate } from "@/lib/sheet-template.ts";
import { createSheetBackup, mechanicallyEquivalentFields, type BackupField, type BackupInventoryItem, type SheetBackup } from "@/lib/sheet-backup.ts";
import { evaluateFormula, type FormulaResult } from "@/lib/formula";
import type { JsonValue } from "@/lib/mobile-sync/index.ts";
import { characterNameField, reconcileDependentValues, validateFields } from "@/lib/sheet-creation.ts";

export type SheetData = {
  name: string;
  system_key: string | null;
  template_name: string;
  template_version: number;
  template_fields?: BackupField[];
  values: Record<string, FieldValue>;
  effects: JsonValue[];
};

export type InventoryData = BackupInventoryItem & { sheet_id: string };

export const INVENTORY_CATEGORIES: { id: BackupInventoryItem["category"]; label: string }[] = [
  { id: "weapon", label: "Arma" }, { id: "armor", label: "Armadura" }, { id: "equipment", label: "Equipamento" },
  { id: "clothing", label: "Vestuário" }, { id: "dwelling", label: "Moradia" }, { id: "vehicle", label: "Veículo" },
  { id: "mount", label: "Montaria" }, { id: "animal", label: "Animal" },
];

export const IDENTITY_LABELS: Record<string, string> = {
  clan: "Clã", predator: "Predador", creed: "Credo", lineage: "Linhagem",
  race: "Raça", subrace: "Sub-raça", origin: "Origem", archetype: "Arquétipo",
};

export function starterById(id: string | null | undefined): SystemStarter | undefined {
  return SYSTEM_STARTERS.find((s) => s.id === id);
}

export function templateFor(sheet: SheetData): SheetTemplate {
  const starter = starterById(sheet.system_key);
  if (starter) return starter.template;
  return { name: sheet.template_name, version: sheet.template_version, fields: (sheet.template_fields ?? []) as SheetField[] };
}

export function computeFormulas(template: SheetTemplate, values: Record<string, FieldValue>): Record<string, FormulaResult> {
  const vars: Record<string, number | undefined> = Object.create(null);
  for (const f of template.fields) if (f.kind === "number" && typeof values[f.id] === "number") vars[f.id] = values[f.id] as number;
  const formulas = new Map(template.fields.filter((f) => f.kind === "formula" && f.expression).map((f) => [f.id, f.expression!]));
  const out: Record<string, FormulaResult> = Object.create(null);
  const visiting = new Set<string>();
  function resolve(id: string): FormulaResult {
    if (out[id]) return out[id];
    if (visiting.has(id)) return { ok: false, error: "Dependência circular entre campos calculados." };
    visiting.add(id);
    const expression = formulas.get(id)!;
    for (const dependency of new Set(expression.match(/[a-z_][a-z0-9_]*/g) ?? [])) {
      if (!formulas.has(dependency)) continue;
      const value = resolve(dependency);
      if (!value.ok) { visiting.delete(id); return out[id] = value; }
      vars[dependency] = value.value;
    }
    visiting.delete(id);
    return out[id] = evaluateFormula(expression, vars);
  }
  for (const id of formulas.keys()) resolve(id);
  for (const field of template.fields) if (field.kind === "roll") out[field.id] = { ok: false, error: "Rolagem somente por ação explícita em Dados." };
  return out;
}

/** Inputs only: formula/roll values are never stored or exported as trusted data. */
export function storableValues(template: SheetTemplate, values: Record<string, FieldValue>): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of template.fields) {
    if (f.kind === "formula" || f.kind === "roll") continue;
    const value = values[f.id];
    if (value !== undefined) out[f.id] = value;
  }
  return out;
}

export function toBackupFields(fields: SheetField[]): BackupField[] {
  return fields.map((f) => ({
    id: f.id, label: f.label, kind: f.kind, required: f.required, options: [...f.options], expression: f.expression,
    ...(f.depends_on ? { depends_on: f.depends_on } : {}),
  }));
}

export function exportSheet(sheet: SheetData, items: InventoryData[]): SheetBackup {
  const template = templateFor(sheet);
  return createSheetBackup({
    name: sheet.name,
    template: { name: template.name, version: template.version, fields: toBackupFields(template.fields) },
    values: storableValues(template, sheet.values),
    effects: sheet.effects,
    inventory: items.map(({ sheet_id: _s, ...item }) => item),
  });
}

export function matchStarter(doc: SheetBackup): SystemStarter | undefined {
  return SYSTEM_STARTERS.find((s) => s.template.name === doc.template.name && s.template.version === doc.template.version
    && mechanicallyEquivalentFields(doc.template.fields, s.template.fields));
}

/** Normalize the record name and its canonical input together before any write. */
export function prepareSheetValues(template: SheetTemplate, input: Record<string, FieldValue>, recordName: string) {
  const values = storableValues(template, reconcileDependentValues(template, input).values);
  const field = characterNameField(template);
  const name = String(field ? values[field.id] ?? "" : recordName).trim();
  const errors = validateFields(template.fields, values, template);
  if (!name || name.length > 120) errors[field?.id ?? "__name"] = "Informe um nome de 1 a 120 caracteres.";
  if (field) values[field.id] = name;
  return { name, values, errors };
}

export function sheetFromBackup(doc: SheetBackup): SheetData {
  const starter = matchStarter(doc);
  const template = starter?.template ?? doc.template;
  const values = { ...doc.values };
  const field = characterNameField(template);
  const name = doc.name.trim();
  if (!name) throw new Error("Informe o nome da ficha.");
  if (field) values[field.id] = name;
  return {
    name, system_key: starter?.id ?? null, template_name: doc.template.name,
    template_version: doc.template.version,
    ...(starter ? {} : { template_fields: doc.template.fields }),
    values: storableValues(template, values), effects: JSON.parse(JSON.stringify(doc.effects)) as JsonValue[],
  };
}

export function focusSheetError(prefix: string, errors: Record<string, string>) {
  const first = Object.keys(errors)[0];
  if (!first) return;
  requestAnimationFrame(() => document.getElementById(`${prefix}-${first}`)?.focus());
}

export function wizardTransition(steps: { fields: SheetField[] }[], current: number, target: number, values: Record<string, FieldValue>, template: SheetTemplate) {
  if (target <= current) return { step: Math.max(0, target), errors: {} };
  for (let i = 0; i < target; i++) {
    const fields = steps[i]?.fields ?? [];
    const errors = validateFields(fields, values, template);
    const nameField = characterNameField(template);
    if (nameField && fields.some((field) => field.id === nameField.id)) {
      const name = String(values[nameField.id] ?? "").trim();
      if (!name || name.length > 120) errors[nameField.id] = "Informe um nome de 1 a 120 caracteres.";
    }
    if (Object.keys(errors).length) return { step: i, errors };
  }
  return { step: Math.min(target, steps.length - 1), errors: {} };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ficha";
}

