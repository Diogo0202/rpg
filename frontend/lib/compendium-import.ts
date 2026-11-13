import { COMPENDIUM_ENTRY_TYPES, type CompendiumEntryType } from "./compendium-types.ts";

export const COMPENDIUM_IMPORT_MAX = 200;

/** Linha pronta para o RPC compendium_import_entries (mesmos campos de campaign_compendium_entries). */
export type CompendiumImportEntry = {
  title: string;
  entry_type: CompendiumEntryType;
  level: number;
  tags: string[];
  cost: string;
  pool: string;
  duration: string;
  description: string;
  source_title: string;
  source_page: number | null;
  source_kind: "homebrew" | "licensed";
};

/** index = posição do verbete (base 0); -1 indica um erro do arquivo inteiro. */
export type CompendiumImportError = { index: number; message: string };
export type CompendiumImportResult = { entries: CompendiumImportEntry[]; errors: CompendiumImportError[] };

const REQUIRED_COLUMNS = ["title", "entry_type", "description", "source_title"];

/** CSV RFC 4180: campos entre aspas, "" como aspas literais, quebras de linha dentro de aspas. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let touched = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") { quoted = true; touched = true; }
    else if (char === ",") { row.push(field); field = ""; touched = true; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && src[i + 1] === "\n") i += 1;
      if (touched || field !== "") { row.push(field); rows.push(row); }
      row = []; field = ""; touched = false;
    } else { field += char; touched = true; }
  }
  if (quoted) throw new Error("Aspas não fechadas no CSV.");
  if (touched || field !== "") { row.push(field); rows.push(row); }
  return rows;
}

function textField(raw: unknown, label: string, max: number, required: boolean, errors: string[]): string {
  if (raw === undefined || raw === null || raw === "") {
    if (required) errors.push(`${label} é obrigatório.`);
    return "";
  }
  if (typeof raw !== "string") { errors.push(`${label} deve ser texto.`); return ""; }
  const value = raw.trim();
  if (required && !value) errors.push(`${label} é obrigatório.`);
  if (value.length > max) errors.push(`${label} aceita até ${max} caracteres.`);
  return value;
}

function intField(raw: unknown, label: string, min: number, max: number, fallback: number | null, errors: string[]): number | null {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return fallback;
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${label} deve ser um inteiro de ${min} a ${max}.`);
    return fallback;
  }
  return value;
}

function tagsField(raw: unknown, errors: string[]): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  let list: unknown[];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string") list = raw.split(";");
  else { errors.push("Etiquetas devem ser uma lista de textos."); return []; }
  const tags: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") { errors.push("Etiquetas devem ser uma lista de textos."); return []; }
    const tag = item.trim().toLocaleLowerCase("pt-BR");
    if (!tag) continue;
    if (tag.length > 40) { errors.push("Cada etiqueta aceita até 40 caracteres."); continue; }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > 20) errors.push("Use até 20 etiquetas.");
  return tags;
}

/** Valida um objeto com as mesmas regras do banco. Devolve a linha normalizada ou a lista de erros. */
export function normalizeCompendiumImportEntry(raw: unknown): { entry?: CompendiumImportEntry; errors: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { errors: ["O verbete deve ser um objeto."] };
  const source = raw as Record<string, unknown>;
  const errors: string[] = [];
  const title = textField(source.title, "Título", 120, true, errors);
  const type = typeof source.entry_type === "string" ? source.entry_type.trim() : source.entry_type;
  if (typeof type !== "string" || !(COMPENDIUM_ENTRY_TYPES as readonly string[]).includes(type)) {
    errors.push(`entry_type inválido. Use: ${COMPENDIUM_ENTRY_TYPES.join(", ")}.`);
  }
  const level = intField(source.level, "Nível", 0, 5, 0, errors) ?? 0;
  const tags = tagsField(source.tags, errors);
  const cost = textField(source.cost, "Custo", 240, false, errors);
  const pool = textField(source.pool, "Parada", 240, false, errors);
  const duration = textField(source.duration, "Duração", 240, false, errors);
  const description = textField(source.description, "Descrição", 4000, true, errors);
  const sourceTitle = textField(source.source_title, "Fonte", 240, true, errors);
  const page = intField(source.source_page, "Página", 1, 5000, null, errors);
  const kindRaw = typeof source.source_kind === "string" ? source.source_kind.trim() : source.source_kind;
  const kind = kindRaw === undefined || kindRaw === null || kindRaw === "" ? "homebrew" : kindRaw;
  if (kind !== "homebrew" && kind !== "licensed") errors.push("source_kind deve ser homebrew ou licensed.");
  if (kind === "licensed" && page === null) errors.push("Fonte licenciada exige a página (source_page).");
  if (errors.length) return { errors };
  return {
    errors,
    entry: {
      title, entry_type: type as CompendiumEntryType, level, tags, cost, pool, duration, description,
      source_title: sourceTitle, source_page: page, source_kind: kind as "homebrew" | "licensed",
    },
  };
}

function finish(rawEntries: unknown[]): CompendiumImportResult {
  const entries: CompendiumImportEntry[] = [];
  const errors: CompendiumImportError[] = [];
  if (rawEntries.length === 0) return { entries, errors: [{ index: -1, message: "Nenhum verbete encontrado no arquivo." }] };
  if (rawEntries.length > COMPENDIUM_IMPORT_MAX) {
    return { entries, errors: [{ index: -1, message: `Importe no máximo ${COMPENDIUM_IMPORT_MAX} verbetes por vez (encontrados ${rawEntries.length}).` }] };
  }
  rawEntries.forEach((raw, index) => {
    const result = normalizeCompendiumImportEntry(raw);
    if (result.entry) entries.push(result.entry);
    for (const message of result.errors) if (result.entry === undefined) errors.push({ index, message });
  });
  return { entries, errors };
}

/**
 * JSON: lista de objetos. CSV: linha de cabeçalho (title,entry_type,level,tags,cost,pool,duration,
 * description,source_title,source_page,source_kind) com etiquetas separadas por ";".
 * `entries` traz só os verbetes válidos; o envio ao servidor só deve ocorrer sem `errors`.
 */
export function parseCompendiumImport(text: string, format: "json" | "csv"): CompendiumImportResult {
  if (!text.trim()) return { entries: [], errors: [{ index: -1, message: "Cole ou escolha um arquivo com os verbetes." }] };
  if (format === "json") {
    let data: unknown;
    try { data = JSON.parse(text.replace(/^﻿/, "")); }
    catch { return { entries: [], errors: [{ index: -1, message: "JSON inválido." }] }; }
    if (!Array.isArray(data)) return { entries: [], errors: [{ index: -1, message: "O JSON deve ser uma lista de objetos." }] };
    return finish(data);
  }
  let rows: string[][];
  try { rows = parseCsvRows(text); }
  catch (error) { return { entries: [], errors: [{ index: -1, message: error instanceof Error ? error.message : "CSV inválido." }] }; }
  if (rows.length === 0) return { entries: [], errors: [{ index: -1, message: "O CSV está vazio." }] };
  const header = rows[0].map((name) => name.trim().toLowerCase().replace(/^type$/, "entry_type"));
  const missing = REQUIRED_COLUMNS.filter((name) => !header.includes(name));
  if (missing.length) return { entries: [], errors: [{ index: -1, message: `Colunas obrigatórias ausentes no cabeçalho: ${missing.join(", ")}.` }] };
  const objects = rows.slice(1).map((cells) => {
    const object: Record<string, string> = {};
    header.forEach((name, column) => { if (name) object[name] = cells[column] ?? ""; });
    return object;
  });
  return finish(objects);
}
