import { isFieldActive, reconcileDependentValues } from "./sheet-creation.ts";
import type { SelectDependency, SheetTemplate } from "./sheet-template.ts";

export const SHEET_BACKUP_FORMAT = "rpg-nexus-sheet" as const;
export const VAULT_BACKUP_FORMAT = "rpg-nexus-vault" as const;
export const SHEET_BACKUP_VERSION = 1 as const;
export const MAX_SHEET_BACKUP_BYTES = 1_048_576;
export const MAX_VAULT_DOCUMENTS = 50;

export type BackupField = {
  id: string;
  label: string;
  kind: "text" | "number" | "select" | "checkbox" | "collection" | "formula" | "roll";
  required: boolean;
  options: string[];
  expression: string | null;
  depends_on?: SelectDependency;
};

const presentationOnlyFieldKeys = new Set(["creation_step", "identity_kind", "character_name"]);

/** Compare field mechanics while ignoring only approved-template presentation metadata. */
export function mechanicallyEquivalentFields(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const normalize = (fields: unknown[]) => fields.map((field) => {
    if (field === null || typeof field !== "object" || Array.isArray(field)) return field;
    return Object.fromEntries(Object.entries(field).filter(([key]) => !presentationOnlyFieldKeys.has(key)));
  });
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
    }
    return value;
  };
  return JSON.stringify(stable(normalize(left))) === JSON.stringify(stable(normalize(right)));
}

export type SheetBackup = {
  format: typeof SHEET_BACKUP_FORMAT;
  format_version: typeof SHEET_BACKUP_VERSION;
  name: string;
  template: { name: string; version: number; fields: BackupField[] };
  values: Record<string, string | number | boolean | string[]>;
  effects: BackupEffect[];
  inventory?: BackupInventoryItem[];
};

export type BackupInventoryItem = {
  custom_values?: Record<string, string | number | boolean | string[]>;
  name: string;
  category: "weapon" | "armor" | "equipment" | "clothing" | "dwelling" | "vehicle" | "mount" | "animal";
  quantity: number;
  resource_cost: number;
  damage_bonus: number;
  protection: number;
  notes: string;
  acquired: boolean;
  equipped: boolean;
  sort_order: number;
};

export type BackupEffect = {
  id: string;
  label: string;
  delta: number;
  enabled: boolean;
  applies_to_tags: string[];
  exempt_tags: string[];
  remaining_scenes: number | null;
  source_note: string | null;
};

export type VaultBackup = {
  format: typeof VAULT_BACKUP_FORMAT;
  format_version: typeof SHEET_BACKUP_VERSION;
  documents: SheetBackup[];
};

const fieldKinds = new Set<BackupField["kind"]>([
  "text", "number", "select", "checkbox", "collection", "formula", "roll",
]);
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const inventoryCategories = new Set<BackupInventoryItem["category"]>([
  "weapon", "armor", "equipment", "clothing", "dwelling", "vehicle", "mount", "animal",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeObjectTree(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error("O backup excede a profundidade permitida.");
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error("O backup contém listas grandes demais.");
    value.forEach((item) => assertSafeObjectTree(item, depth + 1));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) throw new Error("O backup contém uma chave proibida.");
    assertSafeObjectTree(child, depth + 1);
  }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(`${context} contém campos não reconhecidos.`);
}

function boundedString(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new Error(`${label} deve ter entre ${min} e ${max} caracteres.`);
  }
  return value;
}

function stringArray(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} contém uma lista inválida.`);
  return value.map((item) => boundedString(item, label, maxLength, 1));
}

function validateField(value: unknown, index: number): BackupField {
  const label = `Campo ${index + 1}`;
  if (!isPlainObject(value)) throw new Error(`${label} deve ser um objeto.`);
  exactKeys(value, ["id", "label", "kind", "required", "options", "expression", "depends_on"], label);
  const id = boundedString(value.id, `${label}: id`, 64, 2);
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(id)) throw new Error(`${label} tem id inválido.`);
  if (!fieldKinds.has(value.kind as BackupField["kind"])) throw new Error(`${label} tem tipo desconhecido.`);
  if (typeof value.required !== "boolean") throw new Error(`${label}: required deve ser booleano.`);
  const options = stringArray(value.options, `${label}: opções`, 100, 160);
  const expression = value.expression === null ? null : boundedString(value.expression, `${label}: expressão`, 120);
  const dependency = value.depends_on === undefined ? undefined : validateDependency(value.depends_on, label);
  if (dependency && value.kind !== "select") throw new Error(`${label}: somente campos de seleção aceitam dependência.`);
  if (value.kind === "select" && options.length === 0 && !dependency) throw new Error(`${label} precisa de opções.`);
  if (["formula","roll"].includes(String(value.kind)) && !expression?.trim()) throw new Error(`${label} precisa de expressão.`);
  return {
    id,
    label: boundedString(value.label, `${label}: rótulo`, 120, 1),
    kind: value.kind as BackupField["kind"],
    required: value.required,
    options,
    expression,
    ...(dependency ? { depends_on: dependency } : {}),
  };
}

function validateDependency(value: unknown, label: string): SelectDependency {
  if (!isPlainObject(value)) throw new Error(`${label}: dependência inválida.`);
  exactKeys(value, ["field_id", "cases"], `${label}: dependência`);
  const field_id = boundedString(value.field_id, `${label}: campo controlador`, 64, 2);
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(field_id)) throw new Error(`${label}: id do campo controlador inválido.`);
  if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 100) throw new Error(`${label}: casos de dependência inválidos.`);
  const seen = new Set<string>();
  const cases = value.cases.map((item, index) => {
    const caseLabel = `${label}: caso ${index + 1}`;
    if (!isPlainObject(item)) throw new Error(`${caseLabel} deve ser um objeto.`);
    exactKeys(item, ["equals", "options"], caseLabel);
    const equals = boundedString(item.equals, `${caseLabel}: valor`, 160, 1);
    if (seen.has(equals)) throw new Error(`${label}: há casos repetidos para o mesmo valor.`);
    seen.add(equals);
    const options = stringArray(item.options, `${caseLabel}: opções`, 100, 160);
    if (!options.length || options.length !== new Set(options).size) throw new Error(`${caseLabel}: informe opções únicas.`);
    return { equals, options };
  });
  return { field_id, cases };
}

function validateEffects(value: unknown): BackupEffect[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error("A lista de efeitos é inválida ou excede 30 itens.");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const label = `Efeito ${index + 1}`;
    if (!isPlainObject(item)) throw new Error(`${label} deve ser um objeto.`);
    exactKeys(item, ["id", "label", "delta", "enabled", "applies_to_tags", "exempt_tags", "remaining_scenes", "source_note"], label);
    const id = boundedString(item.id, `${label}: id`, 64, 1);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id) || seen.has(id)) throw new Error(`${label} tem id inválido ou repetido.`);
    seen.add(id);
    if (!Number.isInteger(item.delta) || (item.delta as number) < -10 || (item.delta as number) > 10) throw new Error(`${label}: delta deve ser inteiro entre -10 e 10.`);
    if (typeof item.enabled !== "boolean") throw new Error(`${label}: enabled deve ser booleano.`);
    const remaining = item.remaining_scenes;
    if (remaining !== null && (!Number.isInteger(remaining) || (remaining as number) < 0 || (remaining as number) > 1000)) throw new Error(`${label}: cenas restantes inválidas.`);
    const note = item.source_note === null ? null : boundedString(item.source_note, `${label}: observação`, 500);
    return {
      id,
      label: boundedString(item.label, `${label}: rótulo`, 120, 1),
      delta: item.delta as number,
      enabled: item.enabled,
      applies_to_tags: stringArray(item.applies_to_tags, `${label}: etiquetas`, 20, 64),
      exempt_tags: stringArray(item.exempt_tags, `${label}: exceções`, 20, 64),
      remaining_scenes: remaining as number | null,
      source_note: note,
    };
  });
}

function validateCustomItemValues(value: unknown): Record<string, string | number | boolean | string[]> {
  if (!isPlainObject(value) || Object.keys(value).length > 200) throw new Error("Atributos de item inválidos.");
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) throw new Error("Id de atributo inválido.");
    if (typeof item === "string" && item.length <= 10000 || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 1000000) continue;
    if (Array.isArray(item) && item.length <= 200 && item.every((entry) => typeof entry === "string" && entry.length <= 500)) continue;
    throw new Error("Valor de atributo de item inválido.");
  }
  return structuredClone(value) as Record<string, string | number | boolean | string[]>;
}

function validateInventory(value: unknown): BackupInventoryItem[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("A lista de equipamento excede 500 itens.");
  const equippedCategories=new Set<string>();
  return value.map((item, index) => {
    const label = `Item ${index + 1}`;
    if (!isPlainObject(item)) throw new Error(`${label} deve ser um objeto.`);
    exactKeys(item, ["name", "category", "quantity", "resource_cost", "damage_bonus", "protection", "notes", "acquired", "equipped", "sort_order", "custom_values"], label);
    if (!inventoryCategories.has(item.category as BackupInventoryItem["category"])) throw new Error(`${label}: categoria inválida.`);
    if (!Number.isInteger(item.quantity) || (item.quantity as number) < 1 || (item.quantity as number) > 999) throw new Error(`${label}: quantidade deve ficar entre 1 e 999.`);
    for (const field of ["resource_cost", "damage_bonus", "protection"] as const) {
      if (!Number.isInteger(item[field]) || (item[field] as number) < 0 || (item[field] as number) > 10) throw new Error(`${label}: ${field} deve ficar entre 0 e 10.`);
    }
    if (!Number.isInteger(item.sort_order) || (item.sort_order as number) < 0 || (item.sort_order as number) > 9999) throw new Error(`${label}: ordem inválida.`);
    if (typeof item.acquired !== "boolean" || typeof item.equipped !== "boolean") throw new Error(`${label}: estados de aquisição e uso devem ser booleanos.`);
    if (item.equipped) {
      if (!item.acquired || !["weapon","armor"].includes(String(item.category)) || equippedCategories.has(String(item.category))) throw new Error(`${label}: equipamento deve estar adquirido, ser arma ou armadura e ser único por categoria.`);
      equippedCategories.add(String(item.category));
    }
    return {
      name: boundedString(item.name, `${label}: nome`, 160, 1),
      category: item.category as BackupInventoryItem["category"],
      quantity: item.quantity as number,
      resource_cost: item.resource_cost as number,
      damage_bonus: item.damage_bonus as number,
      protection: item.protection as number,
      notes: boundedString(item.notes, `${label}: observações`, 4000),
      acquired: item.acquired,
      equipped: item.equipped,
      sort_order: item.sort_order as number,
      ...(item.custom_values === undefined ? {} : { custom_values: validateCustomItemValues(item.custom_values) }),
    };
  });
}

function validateSheetBackup(input: unknown): SheetBackup {
  if (!isPlainObject(input)) throw new Error("O backup deve ser um objeto JSON.");
  exactKeys(input, ["format", "format_version", "name", "template", "values", "effects", "inventory"], "Backup");
  if (input.format !== SHEET_BACKUP_FORMAT || input.format_version !== SHEET_BACKUP_VERSION) {
    throw new Error("Formato ou versão do backup não compatível.");
  }
  if (!isPlainObject(input.template)) throw new Error("O template do backup é inválido.");
  exactKeys(input.template, ["name", "version", "fields"], "Template");
  if (!Number.isSafeInteger(input.template.version) || (input.template.version as number) < 1) throw new Error("A versão do template é inválida.");
  if (!Array.isArray(input.template.fields) || input.template.fields.length < 1 || input.template.fields.length > 200) throw new Error("O template deve conter entre 1 e 200 campos.");
  const fields = input.template.fields.map(validateField);
  const fieldIds = new Set<string>();
  fields.forEach((field) => {
    if (fieldIds.has(field.id)) throw new Error("O template contém ids de campo repetidos.");
    fieldIds.add(field.id);
  });
  for (const field of fields) {
    if (!field.depends_on) continue;
    const parent = fields.find((candidate) => candidate.id === field.depends_on?.field_id);
    if (!parent || parent.kind !== "select" || parent.id === field.id) throw new Error(`${field.label}: controlador inválido.`);
    const visited = new Set<string>([field.id]);
    let current: BackupField | undefined = parent;
    while (current?.depends_on) {
      if (visited.has(current.id)) throw new Error(`${field.label}: dependência circular.`);
      visited.add(current.id);
      current = fields.find((candidate) => candidate.id === current?.depends_on?.field_id);
    }
    if (current && visited.has(current.id)) throw new Error(`${field.label}: dependência circular.`);
  }
  if (!isPlainObject(input.values)) throw new Error("Os valores da ficha são inválidos.");
  const values: SheetBackup["values"] = Object.create(null) as SheetBackup["values"];
  for (const [key, value] of Object.entries(input.values)) {
    if (!fieldIds.has(key)) throw new Error("Os valores incluem um id que não existe no template.");
    const field = fields.find((candidate) => candidate.id === key)!;
    if (["formula","roll"].includes(field.kind)) throw new Error(`O campo calculado ${field.label} não aceita valor de entrada.`);
    if (typeof value === "string") {
      if (value.length > 10_000 || !["text","select"].includes(field.kind)) throw new Error(`Valor inválido para ${field.label}.`);
      if (field.kind === "select" && !field.depends_on && value !== "" && !field.options.includes(value)) throw new Error(`Opção inválida para ${field.label}.`);
      if (["checkbox", "collection", "formula", "roll"].includes(field.kind) && value !== "") throw new Error(`Tipo de valor incompatível para ${field.label}.`);
    } else if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000 || field.kind !== "number") throw new Error(`Valor numérico inválido para ${field.label}.`);
    } else if (typeof value === "boolean") {
      if (field.kind !== "checkbox") throw new Error(`Tipo de valor incompatível para ${field.label}.`);
    } else if (Array.isArray(value)) {
      if (field.kind !== "collection" || value.length > 200 || value.some((part) => typeof part !== "string" || part.length > 500)) throw new Error(`Coleção inválida para ${field.label}.`);
      values[key] = [...value] as string[];
    } else {
      throw new Error(`Valor inválido para ${field.label}.`);
    }
    if (!Array.isArray(value)) values[key] = value;
  }
  const reconciled = reconcileDependentValues({ fields } as SheetTemplate, values);
  const effectiveValues = reconciled.values;
  for(const field of fields){
    if(!isFieldActive({ fields } as SheetTemplate, field, effectiveValues))continue;
    if(!field.required || ["formula","roll"].includes(field.kind))continue;
    const value=effectiveValues[field.id];
    if(value===undefined || (typeof value==="string"&&!value.trim()) || (Array.isArray(value)&&value.length===0) || (field.kind==="checkbox"&&value!==true))throw new Error(`Campo obrigatório ausente: ${field.label}.`);
  }
  return {
    format: SHEET_BACKUP_FORMAT,
    format_version: SHEET_BACKUP_VERSION,
    name: boundedString(input.name, "Nome da ficha", 120, 1),
    template: { name: boundedString(input.template.name, "Nome do template", 120, 1), version: input.template.version as number, fields },
    values: effectiveValues,
    effects: validateEffects(input.effects),
    ...(input.inventory === undefined ? {} : { inventory: validateInventory(input.inventory) }),
  };
}

export function validateBackup(input: unknown): SheetBackup {
  assertSafeObjectTree(input);
  const copy = validateSheetBackup(input);
  if (new TextEncoder().encode(JSON.stringify(copy)).byteLength > MAX_SHEET_BACKUP_BYTES) throw new Error("O arquivo da ficha ultrapassa 1 MB.");
  return copy;
}

export function createSheetBackup(input: {
  name: string;
  template: { name: string; version: number; fields: unknown };
  values: unknown;
  effects: unknown;
  inventory?: unknown;
}): SheetBackup {
  return validateBackup({ ...input, format: SHEET_BACKUP_FORMAT, format_version: SHEET_BACKUP_VERSION });
}

export function validateVaultBackup(input: unknown): VaultBackup {
  assertSafeObjectTree(input);
  if (!isPlainObject(input)) throw new Error("O backup do cofre deve ser um objeto JSON.");
  exactKeys(input, ["format", "format_version", "documents"], "Backup do cofre");
  if (input.format !== VAULT_BACKUP_FORMAT || input.format_version !== SHEET_BACKUP_VERSION) throw new Error("Formato ou versão do cofre não compatível.");
  if (!Array.isArray(input.documents) || input.documents.length > MAX_VAULT_DOCUMENTS) throw new Error("O backup pode conter até 50 fichas.");
  const documents = input.documents.map(validateBackup);
  const totalBytes = new TextEncoder().encode(JSON.stringify(documents)).byteLength;
  if (totalBytes > MAX_SHEET_BACKUP_BYTES * MAX_VAULT_DOCUMENTS) throw new Error("O backup do cofre ultrapassa o limite total de 50 MB.");
  return { format: VAULT_BACKUP_FORMAT, format_version: SHEET_BACKUP_VERSION, documents };
}

export function parseBackupText(text: string): SheetBackup[] {
  if (new TextEncoder().encode(text).byteLength > MAX_SHEET_BACKUP_BYTES * MAX_VAULT_DOCUMENTS) throw new Error("O arquivo ultrapassa o limite de 50 MB.");
  let input: unknown;
  try { input = JSON.parse(text) as unknown; } catch { throw new Error("O arquivo não contém JSON válido."); }
  if (isPlainObject(input) && input.format === VAULT_BACKUP_FORMAT) return validateVaultBackup(input).documents;
  return [validateBackup(input)];
}

export function createVaultBackup(documents: SheetBackup[]): VaultBackup {
  return validateVaultBackup({ format: VAULT_BACKUP_FORMAT, format_version: SHEET_BACKUP_VERSION, documents });
}
