/**
 * GER-04: converts the narrator's key/value rows into the `system_fields` object the generator API accepts.
 * Mirrors backend limits (app/routes/generators.py): at most 40 keys and 8 KB of JSON.
 */
export const SYSTEM_FIELD_LIMITS = { maxKeys: 40, maxKeyLength: 60, maxValueLength: 500, maxJsonLength: 8192 } as const;

export type SystemFieldRow = { key: string; value: string };
export type SystemFieldValue = string | number | boolean;
export type SystemFieldsResult = { fields: Record<string, SystemFieldValue>; errors: string[] };

const KEY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/** "12" becomes 12 and "true"/"false" become booleans; everything else stays text. */
export function coerceFieldValue(raw: string): SystemFieldValue {
  const text = raw.trim();
  if (/^-?\d{1,15}(\.\d{1,6})?$/.test(text)) return Number(text);
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

/** Rows with an empty key and value are ignored; a value without key (or the reverse) is an error. */
export function buildSystemFields(rows: readonly SystemFieldRow[]): SystemFieldsResult {
  const fields: Record<string, SystemFieldValue> = {};
  const errors: string[] = [];
  rows.forEach((row, index) => {
    const key = row.key.trim();
    const value = row.value.trim();
    const label = `Campo ${index + 1}`;
    if (!key && !value) return;
    if (!key) { errors.push(`${label}: informe o nome do campo.`); return; }
    if (!value) { errors.push(`${label} (${key}): informe o valor.`); return; }
    if (key.length > SYSTEM_FIELD_LIMITS.maxKeyLength) { errors.push(`${label}: o nome passou de ${SYSTEM_FIELD_LIMITS.maxKeyLength} caracteres.`); return; }
    if (!KEY_PATTERN.test(key) || RESERVED.has(key)) { errors.push(`${label}: use só letras, números, espaço, ponto, hífen e sublinhado no nome.`); return; }
    if (value.length > SYSTEM_FIELD_LIMITS.maxValueLength) { errors.push(`${label} (${key}): o valor passou de ${SYSTEM_FIELD_LIMITS.maxValueLength} caracteres.`); return; }
    if (Object.prototype.hasOwnProperty.call(fields, key)) { errors.push(`${label}: o nome "${key}" está repetido.`); return; }
    fields[key] = coerceFieldValue(value);
  });
  if (Object.keys(fields).length > SYSTEM_FIELD_LIMITS.maxKeys) errors.push(`Use no máximo ${SYSTEM_FIELD_LIMITS.maxKeys} campos.`);
  if (JSON.stringify(fields).length > SYSTEM_FIELD_LIMITS.maxJsonLength) errors.push("Os campos do sistema passaram de 8 KB.");
  return { fields: errors.length ? {} : fields, errors };
}

/** Turns a stored `system.fields` object into editable rows (nested values are kept as JSON text). */
export function fieldsToRows(fields: Record<string, unknown> | null | undefined): SystemFieldRow[] {
  if (!fields || typeof fields !== "object") return [];
  return Object.entries(fields).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value) ?? "",
  }));
}
