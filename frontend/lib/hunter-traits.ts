import type { FieldValue, SheetField } from "./sheet-template.ts";

/**
 * Caçador: A Revanche v3, structured traits (mirrors backend/app/services/hunter_traits.py).
 * Credo and Ímpeto are closed lists; Pedras de Toque and Convicções are up to three pairs of
 * short texts that must be filled together; Redenção is short free text and Despair (`em_desespero`)
 * a checkbox. Desesperação and Perigo live in the cell (hunter_cells), not in the sheet. Names and limits only, no rules text. The 1 to 3 pairs are marked for review
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
  // v1-v3 sheets kept the cell's Desperation in `desespero`; F4 moves it to hunter_cells.
  const desperation = values.desespero ?? 0;
  if (typeof desperation !== "number" || !Number.isInteger(desperation) || desperation < 0 || desperation > 5) problems.push("Desesperação (campo antigo da ficha) vai de 0 a 5");
  if (typeof (values.em_desespero ?? false) !== "boolean") problems.push("Em Desespero precisa ser marcado ou desmarcado");
  problems.push(...hunterEdgeProblems(values));
  return problems;
}

/**
 * F4: Triunfos (Edges) e Distinções (Perks), mechanical names only (same lists in
 * backend/app/services/hunter_traits.py). Portuguese names and the Perks of each Edge are
 * provisional and marked for review against the book (docs/CACADOR_CRIACAO_GUIADA.md, F4).
 */
export const HUNTER_EDGES: Record<string, string[]> = {
  Arsenal: ["Requisição de Equipe", "Especializado", "Excepcional", "Irrastreável"],
  Frota: ["Blindagem", "Desempenho", "Vigilância", "Irrastreável"],
  Artilharia: ["Cargas Múltiplas", "Entrega Não Convencional", "Entrega Disfarçada", "Preparo de Carga"],
  Biblioteca: ["Onde se Escondem", "Onde São Fracos", "Quem São", "Pesquisa Rápida"],
  "Equipamento Improvisado": ["Frugal", "Fabricação Rápida", "Produção em Massa", "Especializado"],
  "Acesso Global": ["Porta dos Fundos", "Lista de Vigilância", "Catraca", "Acesso Total"],
  "Piloto de Drone": ["Drone Armado", "Drone Autônomo", "Vigilância", "Carga Útil"],
  "Encantador de Feras": ["Mensageiro", "Matilha", "Incorruptível", "Elo Telepático"],
  "Vira-Casaca": ["Agente Duplo", "Lábia", "Conhecimento Interno", "Disfarce Persistente"],
  "Sentir o Sobrenatural": ["Precisão", "Alcance", "Reconhecer", "Sentido Ampliado"],
  "Repelir o Sobrenatural": ["Barreira", "Dano", "Reação Rápida", "Recuo"],
  "Frustrar o Sobrenatural": ["Rastreio", "Resistência", "Proteção de Grupo", "Contrafeitiço"],
  Artefato: ["Fortalecer", "Detecção", "Dano", "Escudo"],
  "Purificar o Sobrenatural": ["Purificação em Grupo", "Ritual", "Expulsão", "Santuário"],
};
export const HUNTER_EDGE_NAMES = Object.keys(HUNTER_EDGES);
export const HUNTER_PERKS = Object.entries(HUNTER_EDGES).flatMap(([edge, perks]) => perks.map((perk) => `${edge}: ${perk}`));
/** At creation: two Edges and one Perk, or one Edge and two Perks (marked for review). */
export const HUNTER_EDGE_STARTS: Array<[edges: number, perks: number]> = [[2, 1], [1, 2]];

function items(value: FieldValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

/** Every Edge is a catalog name; every Perk is "Triunfo: Distinção" of an Edge the sheet has. */
export function hunterEdgeProblems(values: Record<string, FieldValue>): string[] {
  const problems: string[] = [];
  const edges = items(values.triunfos);
  const perks = items(values.distincoes);
  if (new Set(edges).size !== edges.length || new Set(perks).size !== perks.length) problems.push("Triunfos e Distinções não se repetem");
  for (const edge of edges) if (!(edge in HUNTER_EDGES)) problems.push(`Triunfo ${edge} fora do catálogo`);
  for (const perk of perks) {
    const at = perk.indexOf(":");
    const edge = (at < 0 ? perk : perk.slice(0, at)).trim();
    const name = at < 0 ? "" : perk.slice(at + 1).trim();
    if (!(edge in HUNTER_EDGES) || !HUNTER_EDGES[edge].includes(name)) problems.push(`Distinção ${perk} fora do catálogo (formato Triunfo: Distinção)`);
    else if (!edges.includes(edge)) problems.push(`Distinção ${perk} pede o Triunfo ${edge}`);
  }
  return problems;
}

/** Trait problems plus the starting count of Edges and Perks. */
export function hunterCreationProblems(values: Record<string, FieldValue>): string[] {
  const problems = hunterTraitProblems(values);
  const counts = [items(values.triunfos).length, items(values.distincoes).length];
  if (!HUNTER_EDGE_STARTS.some(([edges, perks]) => edges === counts[0] && perks === counts[1])) problems.push("Na criação: 2 Triunfos e 1 Distinção, ou 1 Triunfo e 2 Distinções");
  return problems;
}

export const inDespair = (values: Record<string, FieldValue>) => values.em_desespero === true;

/** Edges are blocked while the hunter is in Despair (conferir no livro). */
export function usableEdges(values: Record<string, FieldValue>): string[] {
  return inDespair(values) ? [] : items(values.triunfos);
}

export type HunterOutcome = {
  successes: number; success: boolean; critical_pairs: number; critical: boolean;
  desperation_ones: number; desperation_consequence: "table_choice" | "despair" | null;
};

/** Mirror of private.hunter_roll_outcome: 6+ succeed, each pair of 10s adds 2, a Desperation 1 asks the table. */
export function hunterRollOutcome(normal: number[], desperation: number[], difficulty: number): HunterOutcome {
  const faces = [...normal, ...desperation];
  const pairs = Math.floor(faces.filter((face) => face === 10).length / 2);
  const successes = faces.filter((face) => face >= 6).length + 2 * pairs;
  const success = successes >= difficulty;
  const ones = desperation.filter((face) => face === 1).length;
  return { successes, success, critical_pairs: pairs, critical: success && pairs > 0, desperation_ones: ones,
    desperation_consequence: !ones ? null : success ? "table_choice" : "despair" };
}

/** What the table may pick: Overreach only on a success (conferir no livro). */
export function desperationChoices(outcome: Pick<HunterOutcome, "success" | "desperation_ones">): Array<"overreach" | "despair"> {
  return !outcome.desperation_ones ? [] : outcome.success ? ["overreach", "despair"] : ["despair"];
}

/** A sheet made with the v1/v2 starters: free Pilares and no structured pairs. */
export function isLegacyHunterSheet(values: Record<string, FieldValue>): boolean {
  return "pilares" in values || !HUNTER_TRAIT_IDS.some((id) => id in values);
}
