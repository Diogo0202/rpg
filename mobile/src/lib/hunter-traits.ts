import type { FieldValue, SheetField } from "./sheet-template.ts";

/**
 * Caçador: A Revanche v3, structured traits (mirrors backend/app/services/hunter_traits.py).
 * Credo and Ímpeto are closed lists; Pedras de Toque and Convicções are up to three pairs of
 * short texts that must be filled together; Redenção is short free text and Desespero (state)
 * a checkbox. Names and limits only, no rules text. The 1 to 3 pairs are marked for review
 * against the book (docs/CACADOR_CRIACAO_GUIADA.md).
 */
export const HUNTER_CREEDS = ["Empreendedor", "Devoto", "Inquisitivo", "Marcial", "Clandestino"];
export const HUNTER_PAIRS = 3;
export const HUNTER_LIMITS = { conviccao: 160, pedra_toque: 120, redencao: 240, celula: 120, notas: 10000 } as const;
export const HUNTER_DRIVE_LIST = ["Curiosidade", "Expiação", "Ganância", "Inveja", "Juramento", "Orgulho", "Vingança"];

function textField(id: string, label: string, max_length: number, extra: Partial<SheetField> = {}): SheetField {
  return { id, label, kind: "text", required: false, options: [], expression: null, max_length, ...extra };
}

/** Pair fields, in sheet order: Convicção 1, Pedra de Toque 1, Convicção 2... */
export const HUNTER_TRAIT_FIELDS: SheetField[] = Array.from({ length: HUNTER_PAIRS }, (_, index) => {
  const n = index + 1;
  return [
    textField(`conviccao_${n}`, `Convicção ${n}`, HUNTER_LIMITS.conviccao, { required: n === 1, paired_with: `pedra_toque_${n}` }),
    textField(`pedra_toque_${n}`, `Pedra de Toque ${n}`, HUNTER_LIMITS.pedra_toque, { required: n === 1, paired_with: `conviccao_${n}` }),
  ];
}).flat();
export const HUNTER_TRAIT_IDS = HUNTER_TRAIT_FIELDS.map((field) => field.id);

const SEPARATOR = /\s*(?::|—|–|->|=>|\|)\s*/;
const PARENTHESIS = /^(.+?)\s*\(([^()]+)\)\s*$/;

function key(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function closed(value: FieldValue | undefined, options: string[]): string | null {
  return typeof value === "string" ? options.find((option) => key(option) === key(value)) ?? null : null;
}

/** [pedra de toque, convicção] of a legacy Pilares item; a lone text is a conviction without touchstone. */
export function splitPillar(item: string): [string, string] {
  const parenthesis = PARENTHESIS.exec(item);
  if (parenthesis) return [parenthesis[2].trim(), parenthesis[1].trim()];
  const trimmed = item.trim();
  const match = SEPARATOR.exec(trimmed);
  if (match && match.index > 0 && match.index + match[0].length < trimmed.length) {
    return [trimmed.slice(0, match.index), trimmed.slice(match.index + match[0].length)];
  }
  return ["", trimmed];
}

function clip(text: string, limit: number, label: string, warnings: string[]): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  warnings.push(`${label} foi cortado em ${limit} caracteres; o texto completo foi para Notas`);
  return trimmed.slice(0, limit).trimEnd();
}

export type HunterMigration = { values: Record<string, FieldValue>; warnings: string[] };

/** v1/v2 values (free Pilares, free Ímpeto/Credo) to the v3 fields; same output as the backend. */
export function migrateHunterTraits(values: Record<string, FieldValue>): HunterMigration {
  const result: Record<string, FieldValue> = { ...values };
  delete result.pilares;
  const warnings: string[] = [];
  const notes: string[] = [];
  for (const [fieldId, options, label] of [["credo", HUNTER_CREEDS, "Credo"], ["impulso", HUNTER_DRIVE_LIST, "Ímpeto"]] as const) {
    const raw = values[fieldId];
    const matched = closed(raw, options);
    if (matched) result[fieldId] = matched;
    else if (typeof raw === "string" && raw.trim()) {
      delete result[fieldId];
      notes.push(`${label} anterior: ${raw.trim()}`);
      warnings.push(`${label} “${raw.trim()}” não está na lista; escolha uma opção`);
    }
  }
  const pillars = Array.isArray(values.pilares) ? values.pilares.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
  pillars.slice(0, HUNTER_PAIRS).forEach((item, index) => {
    const n = index + 1;
    const [touchstone, conviction] = splitPillar(item);
    result[`conviccao_${n}`] = clip(conviction, HUNTER_LIMITS.conviccao, `Convicção ${n}`, warnings);
    result[`pedra_toque_${n}`] = clip(touchstone, HUNTER_LIMITS.pedra_toque, `Pedra de Toque ${n}`, warnings);
    if (conviction.length > HUNTER_LIMITS.conviccao || touchstone.length > HUNTER_LIMITS.pedra_toque) notes.push(`Pilar ${n}: ${item}`);
    if (!touchstone) warnings.push(`Convicção ${n} ficou sem Pedra de Toque`);
  });
  for (const item of pillars.slice(HUNTER_PAIRS)) notes.push(`Pilar excedente: ${item}`);
  if (pillars.length > HUNTER_PAIRS) warnings.push(`${pillars.length - HUNTER_PAIRS} pilar(es) além de ${HUNTER_PAIRS} foram para Notas`);
  if (!pillars.length) warnings.push("Informe ao menos uma Convicção com sua Pedra de Toque");
  for (const [fieldId, label] of [["redencao", "Redenção"], ["celula", "Célula"]] as const) {
    const raw = values[fieldId];
    if (typeof raw !== "string") continue;
    if (raw.trim().length > HUNTER_LIMITS[fieldId]) notes.push(`${label} completa: ${raw.trim()}`);
    result[fieldId] = clip(raw, HUNTER_LIMITS[fieldId], label, warnings);
  }
  if (notes.length) {
    const previous = typeof values.notas === "string" ? values.notas.trim() : "";
    result.notas = [previous, ...notes].filter(Boolean).join("\n").slice(0, HUNTER_LIMITS.notas);
  }
  return { values: result, warnings: [...new Set(warnings)] };
}

const filled = (value: FieldValue | undefined) => typeof value === "string" && Boolean(value.trim());

/** What still keeps a v3 sheet from passing; empty when the traits are complete. */
export function hunterTraitProblems(values: Record<string, FieldValue>): string[] {
  const problems: string[] = [];
  if (typeof values.credo !== "string" || !HUNTER_CREEDS.includes(values.credo)) problems.push("Escolha um Credo da lista");
  if (typeof values.impulso !== "string" || !HUNTER_DRIVE_LIST.includes(values.impulso)) problems.push("Escolha um Ímpeto da lista");
  let pairs = 0;
  for (let n = 1; n <= HUNTER_PAIRS; n += 1) {
    const conviction = values[`conviccao_${n}`];
    const touchstone = values[`pedra_toque_${n}`];
    if (filled(conviction) !== filled(touchstone)) problems.push(`Par ${n}: preencha Convicção e Pedra de Toque juntas`);
    if (filled(conviction) && filled(touchstone)) pairs += 1;
    for (const [item, limit, label] of [[conviction, HUNTER_LIMITS.conviccao, "Convicção"], [touchstone, HUNTER_LIMITS.pedra_toque, "Pedra de Toque"]] as const) {
      if (typeof item === "string" && item.length > limit) problems.push(`${label} ${n} passa de ${limit} caracteres`);
    }
  }
  if (!pairs) problems.push("Informe ao menos uma Convicção com sua Pedra de Toque");
  if (typeof values.redencao === "string" && values.redencao.length > HUNTER_LIMITS.redencao) problems.push(`Redenção passa de ${HUNTER_LIMITS.redencao} caracteres`);
  const desperation = values.desespero ?? 0;
  if (typeof desperation !== "number" || !Number.isInteger(desperation) || desperation < 0 || desperation > 5) problems.push("Desespero vai de 0 a 5");
  return problems;
}

/** A sheet made with the v1/v2 starters: free Pilares and no structured pairs. */
export function isLegacyHunterSheet(values: Record<string, FieldValue>): boolean {
  return "pilares" in values || !HUNTER_TRAIT_IDS.some((id) => id in values);
}
