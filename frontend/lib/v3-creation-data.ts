import type { CollectionPointsRule, PriorityPoints, SpecialtyPicksRule } from "./sheet-template.ts";

/**
 * Vampire V3 creation as names and numbers only: attributes, abilities,
 * clan disciplines, backgrounds, virtues, Paths, Merits and Flaws, clan
 * weaknesses and the priority budgets. No rules text or book prose is copied;
 * every catalog is marked for checking in the book. V3 has no predator type:
 * old sheets that carried the V5 one are migrated by backend/app/services/system_rolls.py.
 */

export const V3_ATTRIBUTE_GROUPS: Array<{ label: string; fields: Array<[id: string, label: string]> }> = [
  { label: "Físicos", fields: [["forca", "Força"], ["destreza", "Destreza"], ["vigor", "Vigor"]] },
  { label: "Sociais", fields: [["carisma", "Carisma"], ["manipulacao", "Manipulação"], ["aparencia", "Aparência"]] },
  { label: "Mentais", fields: [["percepcao", "Percepção"], ["inteligencia", "Inteligência"], ["raciocinio", "Raciocínio"]] },
];

export const V3_ABILITY_GROUPS: Array<{ label: string; fields: Array<[id: string, label: string]> }> = [
  { label: "Talentos", fields: [
    ["prontidao", "Prontidão"], ["esportes", "Esportes"], ["briga", "Briga"], ["esquiva", "Esquiva"], ["empatia", "Empatia"],
    ["expressao", "Expressão"], ["intimidacao", "Intimidação"], ["lideranca", "Liderança"], ["manha", "Manha"], ["labia", "Lábia"],
  ] },
  { label: "Perícias", fields: [
    ["empatia_animais", "Empatia com Animais"], ["oficios", "Ofícios"], ["conducao", "Condução"], ["etiqueta", "Etiqueta"], ["armas_de_fogo", "Armas de Fogo"],
    ["armas_brancas", "Armas Brancas"], ["performance", "Performance"], ["seguranca", "Segurança"], ["furtividade", "Furtividade"], ["sobrevivencia", "Sobrevivência"],
  ] },
  { label: "Conhecimentos", fields: [
    ["academicos", "Acadêmicos"], ["computador", "Computador"], ["financas", "Finanças"], ["investigacao", "Investigação"], ["direito", "Direito"],
    ["linguistica", "Linguística"], ["medicina", "Medicina"], ["ocultismo", "Ocultismo"], ["politica", "Política"], ["ciencia", "Ciência"],
  ] },
];

export const V3_DISCIPLINES: Array<[id: string, label: string]> = [
  ["disc_animalismo", "Animalismo"], ["disc_auspicios", "Auspícios"], ["disc_rapidez", "Rapidez"], ["disc_quimerismo", "Quimerismo"],
  ["disc_dementacao", "Dementação"], ["disc_dominacao", "Dominação"], ["disc_fortitude", "Fortitude"], ["disc_necromancia", "Necromancia"], ["disc_ofuscacao", "Ofuscação"],
  ["disc_obtenebracao", "Obtenebração"], ["disc_potencia", "Potência"], ["disc_presenca", "Presença"], ["disc_metamorfose", "Metamorfose"],
  ["disc_quietus", "Quietus"], ["disc_serpentis", "Serpentis"], ["disc_taumaturgia", "Taumaturgia"], ["disc_vicissitude", "Vicissitude"],
];

const disciplineId = (label: string) => V3_DISCIPLINES.find(([, name]) => name === label)![0];

const CLAN_DISCIPLINES: Record<string, string[]> = {
  Assamita: ["Rapidez", "Ofuscação", "Quietus"],
  Brujah: ["Rapidez", "Potência", "Presença"],
  Gangrel: ["Animalismo", "Fortitude", "Metamorfose"],
  Giovanni: ["Dominação", "Necromancia", "Potência"],
  Lasombra: ["Dominação", "Obtenebração", "Potência"],
  // Revisado: Dementação no lugar de Dominação (conferir no livro).
  Malkaviano: ["Auspícios", "Dementação", "Ofuscação"],
  Nosferatu: ["Animalismo", "Ofuscação", "Potência"],
  Ravnos: ["Animalismo", "Quimerismo", "Fortitude"],
  "Seguidores de Set": ["Ofuscação", "Presença", "Serpentis"],
  Toreador: ["Auspícios", "Rapidez", "Presença"],
  Tremere: ["Auspícios", "Dominação", "Taumaturgia"],
  Tzimisce: ["Animalismo", "Auspícios", "Vicissitude"],
  Ventrue: ["Dominação", "Fortitude", "Presença"],
};

/** Caitiff have no clan; every discipline is open to them. */
export const V3_CLANS = [...Object.keys(CLAN_DISCIPLINES), "Caitiff"];

export const V3_SECTS = ["Camarilla", "Sabá", "Independente", "Anarquista", "Sem seita"];

export const V3_BACKGROUNDS: Array<[id: string, label: string]> = [
  ["ant_aliados", "Aliados"], ["ant_contatos", "Contatos"], ["ant_fama", "Fama"], ["ant_geracao", "Geração"], ["ant_rebanho", "Rebanho"],
  ["ant_influencia", "Influência"], ["ant_mentor", "Mentor"], ["ant_recursos", "Recursos"], ["ant_lacaios", "Lacaios"], ["ant_status", "Status"],
];

export const V3_VIRTUES: Array<[id: string, label: string]> = [["consciencia", "Consciência"], ["autocontrole", "Autocontrole"], ["coragem", "Coragem"]];

/** Every virtue field: the Humanity pair plus the alternatives (Convicção, Instintos) the Paths use. */
export const V3_PATH_VIRTUES: Array<[id: string, label: string]> = [
  ["consciencia", "Consciência"], ["conviccao", "Convicção"], ["autocontrole", "Autocontrole"], ["instintos", "Instintos"], ["coragem", "Coragem"],
];

/**
 * Paths of Enlightenment: names and the two virtues each uses besides Coragem.
 * Humanidade is one of them. Names and virtue pairs are marked for checking in the book.
 */
export const V3_PATHS: Array<{ name: string; virtues: ["consciencia" | "conviccao", "autocontrole" | "instintos"] }> = [
  { name: "Humanidade", virtues: ["consciencia", "autocontrole"] },
  { name: "Trilha de Caim", virtues: ["conviccao", "instintos"] },
  { name: "Trilha da Catarse", virtues: ["conviccao", "instintos"] },
  { name: "Trilha da Besta", virtues: ["conviccao", "instintos"] },
  { name: "Trilha da Noite", virtues: ["conviccao", "instintos"] },
  { name: "Trilha da Morte e da Alma", virtues: ["conviccao", "autocontrole"] },
  { name: "Trilha da Harmonia", virtues: ["consciencia", "instintos"] },
  { name: "Trilha do Poder e da Voz Interior", virtues: ["conviccao", "instintos"] },
  { name: "Trilha das Revelações Malignas", virtues: ["conviccao", "instintos"] },
  { name: "Trilha da Metamorfose", virtues: ["conviccao", "instintos"] },
  { name: "Trilha dos Ossos", virtues: ["conviccao", "autocontrole"] },
  { name: "Trilha de Lilith", virtues: ["conviccao", "instintos"] },
  { name: "Trilha de Tifão", virtues: ["conviccao", "autocontrole"] },
  { name: "Trilha do Paradoxo", virtues: ["conviccao", "autocontrole"] },
  { name: "Trilha do Sangue", virtues: ["conviccao", "autocontrole"] },
  { name: "Trilha do Acordo Honrado", virtues: ["consciencia", "autocontrole"] },
  { name: "Trilha do Céu", virtues: ["consciencia", "autocontrole"] },
  { name: "Trilha dos Reis", virtues: ["conviccao", "autocontrole"] },
];
export const V3_PATH_NAMES = V3_PATHS.map((path) => path.name);

/** Clan weakness: a short mechanical name per clan, marked for checking in the book. */
export const V3_CLAN_WEAKNESSES: Record<string, string> = {
  Assamita: "Vício em vitae de Membros",
  Brujah: "Fúria fácil (+2 na dificuldade para resistir ao frenesi)",
  Gangrel: "Traço animal a cada frenesi",
  Giovanni: "Beijo doloroso (dano dobrado ao se alimentar)",
  Lasombra: "Sem reflexo",
  Malkaviano: "Perturbação permanente",
  Nosferatu: "Aparência 0",
  Ravnos: "Compulsão por um vício ou crime",
  "Seguidores de Set": "Sensibilidade à luz",
  Toreador: "Fascínio pela beleza",
  Tremere: "Laço com o clã (um passo a menos)",
  Tzimisce: "Terra natal no descanso",
  Ventrue: "Paladar exigente (uma presa)",
  Caitiff: "Sem clã (estigma social)",
};

/** Merits and Flaws: mechanical names and costs only, marked for checking in the book. */
export const V3_MERITS: Array<{ name: string; costs: number[] }> = [
  { name: "Sentido Aguçado", costs: [1] }, { name: "Ambidestro", costs: [1] }, { name: "Comer Comida", costs: [1] },
  { name: "Rubor da Saúde", costs: [2] }, { name: "Voz Encantadora", costs: [2] }, { name: "Destemido", costs: [3] },
  { name: "Digestão Eficiente", costs: [3] }, { name: "Tamanho Enorme", costs: [4] },
  { name: "Bom Senso", costs: [1] }, { name: "Concentração", costs: [1] }, { name: "Senso do Tempo", costs: [1] },
  { name: "Código de Honra", costs: [2] }, { name: "Memória Eidética", costs: [2] }, { name: "Sono Leve", costs: [2] },
  { name: "Coração Calmo", costs: [3] }, { name: "Vontade de Ferro", costs: [3] },
  { name: "Líder Nato", costs: [1] }, { name: "Senhor Prestigioso", costs: [1] }, { name: "Dívida de Gratidão", costs: [1, 2, 3] },
  { name: "Médium", costs: [2] }, { name: "Resistência à Magia", costs: [2] }, { name: "Diablerie Oculta", costs: [3] },
  { name: "Habilidade Oracular", costs: [3] }, { name: "Mentor Espiritual", costs: [3] }, { name: "Sortudo", costs: [3] },
  { name: "Imune ao Laço", costs: [3] }, { name: "Amor Verdadeiro", costs: [4] }, { name: "Disciplina Adicional", costs: [5] },
  { name: "Fé Verdadeira", costs: [7] },
];
export const V3_FLAWS: Array<{ name: string; costs: number[] }> = [
  { name: "Audição Ruim", costs: [1] }, { name: "Baixo", costs: [1] }, { name: "Cheiro de Túmulo", costs: [1] },
  { name: "Visão Ruim", costs: [1, 3] }, { name: "Décima Quarta Geração", costs: [2] }, { name: "Desfigurado", costs: [2] },
  { name: "Criança", costs: [3] }, { name: "Deformidade", costs: [3] }, { name: "Manco", costs: [3] }, { name: "Monstruoso", costs: [3] },
  { name: "Ferimento Permanente", costs: [3] }, { name: "Cura Lenta", costs: [3] }, { name: "Mudo", costs: [4] },
  { name: "Sangue Fraco", costs: [4] }, { name: "Carne de Cadáver", costs: [5] }, { name: "Vício", costs: [3] },
  { name: "Sono Pesado", costs: [1] }, { name: "Pesadelos", costs: [1] }, { name: "Exclusão de Presa", costs: [1] },
  { name: "Tímido", costs: [1] }, { name: "Coração Mole", costs: [1] }, { name: "Problema de Fala", costs: [1] },
  { name: "Amnésia", costs: [2] }, { name: "Lunático", costs: [2] }, { name: "Fobia", costs: [2] }, { name: "Pavio Curto", costs: [2] },
  { name: "Territorial", costs: [2] }, { name: "Vingativo", costs: [2] }, { name: "Objetivo Obsessivo", costs: [3] }, { name: "Ódio", costs: [3] },
  { name: "Intolerância", costs: [1] }, { name: "Excesso de Confiança", costs: [1] }, { name: "Baixa Autoestima", costs: [2] },
  { name: "Vontade Fraca", costs: [3] }, { name: "Segredo Sombrio", costs: [1] }, { name: "Senhor Infame", costs: [1] },
  { name: "Identidade Trocada", costs: [1] }, { name: "Ressentimento do Senhor", costs: [1] }, { name: "Inimigo", costs: [1, 2, 3, 4, 5] },
  { name: "Caçado", costs: [4] }, { name: "Membro em Observação", costs: [4] }, { name: "Inimizade de Clã", costs: [2] },
  { name: "Notoriedade", costs: [3] }, { name: "Repelido por Alho", costs: [1] }, { name: "Sem Reflexo", costs: [1] },
  { name: "Não Atravessa Água Corrente", costs: [3] }, { name: "Assombrado", costs: [3] }, { name: "Amaldiçoado", costs: [1, 2, 3, 4, 5] },
  { name: "Repelido por Cruzes", costs: [3] }, { name: "Sensível à Luz", costs: [5] }, { name: "Toque Gélido", costs: [1] },
  { name: "Farol do Profano", costs: [2] }, { name: "Presença Sinistra", costs: [2] }, { name: "Destino Sombrio", costs: [5] },
];
/** Flaw points converted into extra freebie points at creation. */
export const V3_FLAW_FREEBIE_CAP = 7;

/**
 * Blood pool and blood per turn by generation (conferir): 13th..8th through the Generation
 * background (0..5 dots). The starter's formulas give the same numbers:
 * sangue_max = 10 + ant_geracao; sangue_por_turno = 1 + (ant_geracao // 4) * (ant_geracao - 3).
 */
export const V3_BLOOD_BY_GENERATION: Record<number, { max: number; perTurn: number }> = {
  13: { max: 10, perTurn: 1 }, 12: { max: 11, perTurn: 1 }, 11: { max: 12, perTurn: 1 }, 10: { max: 13, perTurn: 1 },
  9: { max: 14, perTurn: 2 }, 8: { max: 15, perTurn: 3 }, 7: { max: 20, perTurn: 4 }, 6: { max: 30, perTurn: 6 },
  5: { max: 40, perTurn: 8 }, 4: { max: 50, perTurn: 10 },
};

/** The seven health levels and their dice penalty (conferir); Incapacitado cannot act. */
export const V3_HEALTH_LEVELS: Array<{ label: string; penalty: number | null }> = [
  { label: "Escoriado", penalty: 0 }, { label: "Machucado", penalty: -1 }, { label: "Ferido", penalty: -1 },
  { label: "Ferido Gravemente", penalty: -2 }, { label: "Espancado", penalty: -2 }, { label: "Aleijado", penalty: -5 },
  { label: "Incapacitado", penalty: null },
];

/** Disciplines each clan may raise at creation, by clan option. */
export const V3_ALLOWED_DISCIPLINES: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(CLAN_DISCIPLINES).map(([clan, labels]) => [clan, labels.map(disciplineId)])),
  Caitiff: V3_DISCIPLINES.map(([id]) => id),
};

const ids = (list: Array<[string, string]>) => list.map(([id]) => id);

/** Virtues the chosen Path opens (its pair plus Coragem); the others stay at 1. */
export const V3_PATH_VIRTUE_CASES: Record<string, string[]> = Object.fromEntries(V3_PATHS.map((path) => [path.name, [...path.virtues, "coragem"]]));

/**
 * 7/5/3 attributes, 13/9/5 abilities, 3 disciplines, 5 backgrounds, 7 virtues of the chosen Path and
 * 15 freebie points. Merits are bought with freebies; Flaws add freebies, at most 7 (conferir).
 * The Path rating starts at the sum of its two virtues: the four alternatives are summed and the
 * two the Path keeps closed sit at 1 each, hence the base of -2.
 */
export const V3_PRIORITY_RULE: PriorityPoints = {
  type: "priority_points", id: "criacao_v3", label: "Criação por prioridades", freebies: 15, exact: true,
  freebie_items: { spend: ["meritos"], earn: { collection: "defeitos", max: V3_FLAW_FREEBIE_CAP } },
  fields: [],
  pools: [
    { id: "atributos", label: "Atributos", base: 1, cost: 5, budgets: [7, 5, 3], groups: V3_ATTRIBUTE_GROUPS.map((group) => ({ label: group.label, fields: ids(group.fields) })) },
    { id: "habilidades", label: "Habilidades", base: 0, cost: 2, budgets: [13, 9, 5], groups: V3_ABILITY_GROUPS.map((group) => ({ label: group.label, fields: ids(group.fields) })) },
    { id: "disciplinas", label: "Disciplinas", base: 0, cost: 7, budgets: [3], groups: [{ label: "Disciplinas", fields: ids(V3_DISCIPLINES) }],
      allowed: { field: "cla", cases: V3_ALLOWED_DISCIPLINES } },
    { id: "antecedentes", label: "Antecedentes", base: 0, cost: 1, budgets: [5], groups: [{ label: "Antecedentes", fields: ids(V3_BACKGROUNDS) }] },
    { id: "virtudes", label: "Virtudes", base: 1, cost: 2, budgets: [7], groups: [{ label: "Virtudes", fields: ids(V3_PATH_VIRTUES) }],
      allowed: { field: "trilha", cases: V3_PATH_VIRTUE_CASES } },
    { id: "humanidade", label: "Humanidade / Trilha", base: -2, base_from: ["consciencia", "conviccao", "autocontrole", "instintos"], cost: 1, budgets: [0], groups: [{ label: "Humanidade / Trilha", fields: ["humanidade"] }] },
    { id: "vontade", label: "Força de Vontade", base: 0, base_from: ["coragem"], cost: 1, budgets: [0], groups: [{ label: "Força de Vontade", fields: ["forca_vontade"] }] },
  ],
};
V3_PRIORITY_RULE.fields = [...new Set([
  ...V3_PRIORITY_RULE.pools.flatMap((pool) => pool.groups.flatMap((group) => group.fields)),
  ...V3_PRIORITY_RULE.pools.flatMap((pool) => pool.base_from ?? []),
])];

/** Catalogs for Merits and Flaws; the freebie arithmetic lives in V3_PRIORITY_RULE.freebie_items. */
export const V3_MERIT_FLAW_RULES: CollectionPointsRule[] = [
  { type: "collection_points", id: "meritos_v3", label: "Qualidades", collection: "meritos", fields: [], points: 15 + V3_FLAW_FREEBIE_CAP, exact: false, catalog: V3_MERITS },
  { type: "collection_points", id: "defeitos_v3", label: "Defeitos", collection: "defeitos", fields: [], points: V3_FLAW_FREEBIE_CAP, exact: false, catalog: V3_FLAWS },
];

/** One specialization for every attribute and ability at 4 or more, and only there (conferir). */
export const V3_SPECIALTY_RULE: SpecialtyPicksRule = {
  type: "specialty_picks", id: "especializacoes_v3", label: "Especializações", collection: "especialidades",
  skills: [...V3_ATTRIBUTE_GROUPS, ...V3_ABILITY_GROUPS].flatMap((group) => group.fields.map(([field, label]) => ({ field, label }))),
  required: [...V3_ATTRIBUTE_GROUPS, ...V3_ABILITY_GROUPS].flatMap((group) => ids(group.fields)), free: 0, min_value: 4, fields: [],
};
