import type { CreationDistribution } from "./sheet-template.ts";

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
  identity: "Escolha o credo e o ímpeto do caçador. O arquétipo e a célula continuam disponíveis nesta etapa (p. 57).",
  attributes: "Distribua os valores finais entre os nove atributos: 4/3/3/3/2/2/2/2/1. Não some esses pontos ao valor inicial (pp. 54 e 57).",
  skills: "Escolha um modo e distribua os pontos nas 27 habilidades. As demais ficam em zero. Você escolhe quais habilidades recebem cada valor (p. 61).",
  traits: "Registre uma especialidade livre e as especialidades de Ciência, Erudição, Ofícios e Performance quando tiver pontos nessas habilidades (p. 61). Vantagens: 7 pontos; Defeitos: 2 pontos. Triunfos: 2, ou 1 com 2 Distinções (p. 54). Esses registros textuais passam pela revisão do narrador.",
  story: "Complete Ambição, Desejo e Pilares. O campo Redenção também está disponível, conforme a ficha do livro (pp. 54 e 282).",
};
