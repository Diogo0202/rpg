import type { CatalogEntry, CollectionPointsRule, CreationDistribution, SpecialtyPicksRule } from "./sheet-template.ts";

// Caçador: A Revanche, pp. 54, 57, 61 and character sheet p. 282.
// Numeric contracts and short labels only. Existing field IDs are preserved.
export const HUNTER_SKILLS: Array<[string, string]> = [
  ["armas_brancas", "Armas Brancas"], ["armas_de_fogo", "Armas de Fogo"], ["atletismo", "Atletismo"],
  ["briga", "Briga"], ["ciencia", "Ciência"], ["conducao", "Condução"],
  ["trato_com_animais", "Empatia com Animais"], ["academicos", "Erudição"], ["etiqueta", "Etiqueta"],
  ["financas", "Finanças"], ["furtividade", "Furtividade"], ["intimidacao", "Intimidação"],
  ["investigacao", "Investigação"], ["ladroagem", "Ladroagem"], ["lideranca", "Liderança"],
  ["manha", "Manha"], ["medicina", "Medicina"], ["ocultismo", "Ocultismo"],
  ["oficios", "Ofícios"], ["percepcao", "Percepção"], ["performance", "Performance"],
  ["persuasao", "Persuasão"], ["politica", "Política"], ["empatia", "Sagacidade"],
  ["sobrevivencia", "Sobrevivência"], ["subterfugio", "Subterfúgio"], ["tecnologia", "Tecnologia"],
];

export const HUNTER_SKILL_DISTRIBUTIONS: CreationDistribution[] = [
  { label: "Especialista", counts: { 4: 1, 3: 3, 2: 3, 1: 3 }, rest: 0 },
  { label: "Pau para toda obra", counts: { 3: 1, 2: 8, 1: 10 }, rest: 0 },
  { label: "Equilibrado", counts: { 3: 3, 2: 5, 1: 7 }, rest: 0 },
];

export const HUNTER_DRIVES = ["Curiosidade", "Expiação", "Ganância", "Inveja", "Juramento", "Orgulho", "Vingança"];

export const HUNTER_STEP_HELP: Record<string, string> = {
  identity: "Escolha o credo e o ímpeto do caçador. O arquétipo continua disponível nesta etapa (p. 57). A célula é vinculada pelo narrador no painel de células.",
  attributes: "Distribua os valores finais entre os nove atributos: 4/3/3/3/2/2/2/2/1. Não some esses pontos ao valor inicial (pp. 54 e 57).",
  skills: "Escolha um modo e distribua os pontos nas 27 habilidades. As demais ficam em zero. Você escolhe quais habilidades recebem cada valor (p. 61).",
  traits: "Confira especializações e pontos de Vantagens/Defeitos. Na criação, escolha 2 Triunfos ou 1 Triunfo e 2 Distinções (p. 90). Registre o equipamento.",
  story: "Complete Ambição, Desejo e até 3 Pilares, pessoas com vínculos significativos (pp. 56 e 282). Redenção liga o fim da Aflição ao Ímpeto.",
};

/** Skills that always get a free specialty when they have dots; one more goes to any skill with dots (p. 61). */
export const HUNTER_SPECIALTY_REQUIRED = ["ciencia", "academicos", "oficios", "performance"];

export const HUNTER_SPECIALTY_RULE: SpecialtyPicksRule = {
  type: "specialty_picks", id: "especializacoes", label: "Especializações", collection: "especialidades",
  skills: HUNTER_SKILLS.map(([field, label]) => ({ field, label })), required: HUNTER_SPECIALTY_REQUIRED, free: 1, fields: [],
};

const upTo = (max: number) => Array.from({ length: max }, (_, index) => index + 1);
const entries = (list: Array<[name: string, costs: number[]]>): CatalogEntry[] => list.map(([name, costs]) => ({ name, costs }));

/**
 * Advantage and Flaw names with the points each may take, names and numbers only. The list is
 * provisional and marked for review against the book; the narrator can set allow_homebrew in
 * the template. Recursos is the number field, so it stays out of the list.
 */
export const HUNTER_ADVANTAGE_CATALOG: CatalogEntry[] = entries([
  ["Aliados", upTo(5)], ["Contatos", upTo(3)], ["Fama", upTo(5)], ["Influência", upTo(5)], ["Máscara", upTo(2)],
  ["Lacaios", upTo(3)], ["Refúgio", upTo(3)], ["Status", upTo(5)], ["Linguística", upTo(5)], ["Bela", [2]], ["Deslumbrante", [4]],
]);

export const HUNTER_FLAW_CATALOG: CatalogEntry[] = entries([
  ["Inimigo", upTo(5)], ["Infame", upTo(3)], ["Antipatizado", [1]], ["Desprezado", [2]], ["Rejeitado", [2]], ["Segredo Sombrio", upTo(3)],
  ["Analfabeto", [2]], ["Feio", [1]], ["Repulsivo", [2]], ["Vício", [1]], ["Vício Irremediável", [2]], ["Destituído", [1]],
  ["Perseguidores", [1]], ["Suspeito", [1]], ["Sem Refúgio", [1]], ["Refúgio Comprometido", [2]], ["Farol do Profano", [1]],
]);

/** 7 points of Advantages (Recursos counts toward them) and 2 of Flaws. */
export const HUNTER_ADVANTAGE_RULES: CollectionPointsRule[] = [
  { type: "collection_points", id: "vantagens_pontos", label: "Vantagens", collection: "vantagens", fields: ["recursos"], points: 7, catalog: HUNTER_ADVANTAGE_CATALOG, allow_homebrew: false },
  { type: "collection_points", id: "defeitos_pontos", label: "Defeitos", collection: "defeitos", fields: [], points: 2, catalog: HUNTER_FLAW_CATALOG, allow_homebrew: false },
];

/** Rules the table should confirm against the book (F4). */
export const HUNTER_REVIEW_RULES = [
  "Catálogo dos Triunfos e Distinções conferido no livro básico, pp. 89–100; opções antigas Vira-Casaca e Purificar o Sobrenatural ficam fora das escolhas novas.",
  "Criação: 2 Triunfos, ou 1 Triunfo e 2 Distinções (p. 90).",
  "Catálogo de Vantagens e Defeitos e seus pontos (7 e 2).",
  "Desesperação: em sucesso, o jogador escolhe Forçar a Barra e eleva Perigo por cada 1, ou falha e entra em Aflição. Em falha com 1 há Aflição (pp. 127–128).",
  "Em Aflição não se rolam dados de Desesperação; Distinções continuam disponíveis (p. 90).",
  "Rerrolagem de Vontade: até 3 dados comuns, uma vez por teste, gastando 1 de Vontade.",
  "Redenção: cumprir o Ímpeto encerra o Despair, com decisão do narrador.",
];
