import type { GrantCase, GrantChoiceOption } from "./sheet-template.ts";

// Shadow of the Demon Lord, campaign Trench Crusade. Core numbers come from the campaign rules
// summary (d20 + attribute - 10, Defense = Agility, Health = Strength, Perception = Intellect).
// Ancestry numbers are short contracts that the game master must check against the book
// ("conferir no livro" in docs/SOTDL_CRIACAO_GUIADA.md). No book text is copied.
export const SOTDL_ATTRIBUTES: Array<[string, string]> = [
  ["forca", "Força"], ["agilidade", "Agilidade"], ["intelecto", "Intelecto"], ["vontade", "Vontade"],
];

/** Fields the ancestry fixes at level 0; the wizard locks them to base plus the ancestry adds. */
export const SOTDL_ANCESTRY_FIELDS = [
  ...SOTDL_ATTRIBUTES.map(([id]) => id), "bonus_defesa", "bonus_saude", "bonus_percepcao", "deslocamento", "corrupcao",
];

export const SOTDL_ANCESTRY_BASE: Record<string, number> = {
  forca: 10, agilidade: 10, intelecto: 10, vontade: 10, deslocamento: 10,
};

export const SOTDL_ANCESTRY_CHOICE_FIELD = "ancestralidade_atributo";

const raise = (amount: number): GrantChoiceOption[] =>
  SOTDL_ATTRIBUTES.map(([id, label]) => ({ label: `${label} +${amount}`, add: { [id]: amount } }));

export const SOTDL_ANCESTRY_CASES: GrantCase[] = [
  { equals: "Humano", add: {}, choices: [{ field: SOTDL_ANCESTRY_CHOICE_FIELD, label: "Atributo +1", options: raise(1) }] },
  { equals: "Transmorfo", add: { forca: -1, bonus_percepcao: 1 } },
  { equals: "Autômato", add: { forca: -1, agilidade: -2, intelecto: -1, vontade: -1, bonus_defesa: 5, deslocamento: -2 },
    choices: [{ field: SOTDL_ANCESTRY_CHOICE_FIELD, label: "Atributo +2", options: raise(2) }] },
  { equals: "Anão", add: { agilidade: -1, bonus_saude: 4, bonus_percepcao: 1, deslocamento: -2 } },
  { equals: "Goblin", add: { forca: -2, agilidade: 2, vontade: -1, bonus_percepcao: 1 } },
  { equals: "Orc", add: { forca: 1, intelecto: -1, vontade: -1, bonus_percepcao: 1, corrupcao: 1, deslocamento: 2 } },
];

export const SOTDL_ANCESTRIES = SOTDL_ANCESTRY_CASES.map((item) => item.equals);

export const SOTDL_FAITHS = ["Cristão", "Herege"];

export const SOTDL_AFFLICTIONS = ["Assustado", "Debilitado", "Lento", "Atordoado"];

export const SOTDL_STEP_HELP: Record<string, string> = {
  identity: "Escolha a ancestralidade: ela fixa os quatro atributos, o deslocamento e os bônus de Defesa, Saúde e Percepção no nível 0. Humano e Autômato escolhem um atributo para aumentar. Marque a fé (Cristão ou Herege) para a Crise de Convicção. Trilhas ficam para os níveis 1, 3 e 7.",
  attributes: "Os atributos vêm da ancestralidade e não são distribuídos. O modificador é sempre o valor menos 10.",
  resources: "Defesa = Agilidade, Saúde = Força e Percepção = Intelecto, mais os bônus da ancestralidade. Regras da campanha Trench Crusade: Pontos de Fervor (PF), Crise de Convicção ao chegar a 0 PF e Último Alento para heróis de nível 9+.",
  story: "Registre a origem e o que levou o personagem às trincheiras.",
};
