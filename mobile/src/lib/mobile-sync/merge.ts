import type { FieldValue, JsonValue, Path, SyncChange, SyncRecord } from "./types.ts";

const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export function validateChanges(changes: SyncChange[], allowedFields?: string[]): SyncChange[] {
  if (!Array.isArray(changes) || changes.length > 200) throw new Error("changes must contain at most 200 entries");
  const paths: string[][] = [];
  const copy = changes.map((change) => {
    if (!change || !Array.isArray(change.path) || change.path.length < 1 || change.path.length > 12) throw new Error("invalid path depth");
    const path = change.path.map((part) => {
      if (typeof part !== "string" || !part || forbidden.has(part)) throw new Error("invalid path segment");
      return part;
    });
    if (allowedFields && !allowedFields.includes(path[0])) throw new Error(`field is not writable: ${path[0]}`);
    for (const previous of paths) {
      const overlap = previous.every((part, i) => path[i] === part) || path.every((part, i) => previous[i] === part);
      if (overlap) throw new Error("duplicate or overlapping paths");
    }
    paths.push(path);
    return { path, before: cloneField(change.before), after: cloneField(change.after) };
  });
  return copy;
}

function cloneField(field: FieldValue): FieldValue {
  if (!field || typeof field.exists !== "boolean") throw new Error("field value requires exists");
  if (!field.exists) {
    if ("value" in field) throw new Error("missing values cannot include value");
    return { exists: false };
  }
  if (!("value" in field)) throw new Error("present values require value");
  return { exists: true, value: cloneJson(field.value) };
}

function cloneJson(value: JsonValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
    return value;
  }
  if (Array.isArray(value)) return value.map(cloneJson);
  if (typeof value !== "object") throw new Error("value is not JSON");
  const result: Record<string, JsonValue> = Object.create(null);
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error("prototype paths are forbidden");
    result[key] = cloneJson(child);
  }
  return result;
}

function atPath(data: Record<string, JsonValue>, path: Path): FieldValue {
  let node: JsonValue | undefined = data;
  for (const part of path) {
    if (!node || typeof node !== "object" || Array.isArray(node) || !own(node, part)) return { exists: false };
    node = node[part];
  }
  return node === undefined ? { exists: false } : { exists: true, value: cloneJson(node) };
}

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
export function fieldValuesEqual(a: FieldValue, b: FieldValue): boolean {
  return a.exists === b.exists && (!a.exists || canonical(a.value) === canonical((b as { value: JsonValue }).value));
}

export function applyChanges(data: Record<string, JsonValue>, changes: SyncChange[], checkBefore = false): Record<string, JsonValue> {
  const result = cloneJson(data) as Record<string, JsonValue>;
  for (const change of validateChanges(changes)) {
    if (checkBefore && !fieldValuesEqual(atPath(result, change.path), change.before)) throw new Error(`before value mismatch at ${change.path.join(".")}`);
    let parent: Record<string, JsonValue> = result;
    for (const part of change.path.slice(0, -1)) {
      const child = parent[part];
      if (child === undefined || child === null || typeof child !== "object" || Array.isArray(child)) parent[part] = Object.create(null) as JsonValue;
      parent = parent[part] as Record<string, JsonValue>;
    }
    const key = change.path.at(-1)!;
    if (change.after.exists) parent[key] = cloneJson(change.after.value);
    else delete parent[key];
  }
  return result;
}

export function rebaseChanges(changes: SyncChange[], current: Record<string, JsonValue>): { safe: SyncChange[]; conflicts: Path[] } {
  const safe: SyncChange[] = [], conflicts: Path[] = [];
  for (const change of validateChanges(changes)) {
    if (fieldValuesEqual(atPath(current, change.path), change.before)) safe.push(change);
    else conflicts.push(change.path.slice());
  }
  return { safe, conflicts };
}

export function projectRecord(base: SyncRecord | undefined, changes: SyncChange[], deleted = false): SyncRecord | undefined {
  if (!base && !changes.length && !deleted) return undefined;
  const data = base ? cloneJson(base.data) as Record<string, JsonValue> : Object.create(null) as Record<string, JsonValue>;
  return { entity_type: base?.entity_type ?? "", id: base?.id ?? "", version: base?.version ?? 0, data: applyChanges(data, changes), ...(deleted ? { deleted: true } : {}) };
}

