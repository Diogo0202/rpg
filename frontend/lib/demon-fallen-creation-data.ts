import type { GrantCase, PriorityPoints } from "./sheet-template.ts";

// Short labels and creation numbers checked against Demônio: A Queda, pp. 123-124,
// and the four-page character sheet. No book descriptions are stored here.
export const DEMON_HOUSES = ["Diabos", "Flagelos", "Malfeitores", "Infestos", "Profanadores", "Devoradores", "Algozes"];

export const DEMON_ATTRIBUTE_GROUPS: Array<{ label: string; fields: Array<[string, string]> }> = [
  { label: "Físicos", fields: [["forca", "Força"], ["destreza", "Destreza"], ["vigor", "Vigor"]] },
  { label: "Sociais", fields: [["carisma", "Carisma"], ["manipulacao", "Manipulação"], ["aparencia", "Aparência"]] },
  { label: "Mentais", fields: [["percepcao", "Percepção"], ["inteligencia", "Inteligência"], ["raciocinio", "Raciocínio"]] },
];

export const DEMON_ABILITY_GROUPS: Array<{ label: string; fields: Array<[string, string]> }> = [
  { label: "Talentos", fields: [
    ["prontidao", "Prontidão"], ["esportes", "Esportes"], ["presciencia", "Presciência"], ["briga", "Briga"],
    ["esquiva", "Esquiva"], ["empatia", "Empatia"], ["expressao", "Expressão"], ["intimidacao", "Intimidação"],
    ["intuicao", "Intuição"], ["lideranca", "Liderança"], ["manha", "Manha"], ["labia", "Lábia"],
  ] },
  { label: "Perícias", fields: [
    ["empatia_animais", "Empatia com Animais"], ["oficios", "Ofícios"], ["demolicoes", "Demolições"],
    ["conducao", "Condução"], ["etiqueta", "Etiqueta"], ["armas_de_fogo", "Armas de Fogo"],
    ["armas_brancas", "Armas Brancas"], ["performance", "Performance"], ["seguranca", "Segurança"],
    ["furtividade", "Furtividade"], ["sobrevivencia", "Sobrevivência"], ["tecnologia", "Tecnologia"],
  ] },
  { label: "Conhecimentos", fields: [
    ["instrucao", "Instrução"], ["computador", "Computador"], ["financas", "Finanças"],
    ["investigacao", "Investigação"], ["direito", "Direito"], ["linguistica", "Linguística"],
    ["medicina", "Medicina"], ["ocultismo", "Ocultismo"], ["politica", "Política"],
    ["religiao", "Religião"], ["pesquisa", "Pesquisa"], ["ciencia", "Ciência"],
  ] },
];

export const DEMON_BACKGROUNDS: Array<[string, string]> = [
  ["ant_aliados", "Aliados"], ["ant_celebridade", "Celebridade"], ["ant_contatos", "Contatos"],
  ["ant_fama", "Fama"], ["ant_influencia", "Influência"], ["ant_legado", "Legado"],
  ["ant_mentor", "Mentor"], ["ant_modelo", "Modelo"], ["ant_pactos", "Pactos"],
  ["ant_recursos", "Recursos"], ["ant_seguidores", "Seguidores"],
];

export const DEMON_LORES: Array<[string, string]> = [
  ["dou_carne", "Carne"], ["dou_chama", "Chama"], ["dou_fera", "Fera"], ["dou_forja", "Forja"],
  ["dou_humanidade", "Humanidade"], ["dou_luz", "Luz"], ["dou_morte", "Morte"],
  ["dou_natureza", "Natureza"], ["dou_terra", "Terra"], ["dou_transfiguracao", "Transfiguração"],
  ["dou_tempestades", "Tempestades"], ["dou_desejo", "Desejo"], ["dou_despertar", "Despertar"],
  ["dou_espirito", "Espírito"], ["dou_esplendor", "Esplendor"], ["dou_firmamento", "Firmamento"],
  ["dou_fundamento", "Fundamento"], ["dou_caminhos", "Caminhos"], ["dou_celestiais", "Celestiais"],
  ["dou_padroes", "Padrões"], ["dou_portais", "Portais"], ["dou_reinos", "Reinos"],
  ["dou_ventos", "Ventos"],
];

export const DEMON_VIRTUES: Array<[string, string]> = [
  ["consciencia", "Consciência"], ["conviccao", "Convicção"], ["coragem", "Coragem"],
];

// Módulo Básico, pp. 99, 101, 103, 105, 107, 109 e 111.
const houseSources: Array<[house: string, torment: number, lores: string[]]> = [
  ["Diabos", 4, ["Celestiais", "Chama", "Esplendor"]],
  ["Flagelos", 3, ["Ventos", "Despertar", "Firmamento"]],
  ["Malfeitores", 3, ["Terra", "Forja", "Caminhos"]],
  ["Infestos", 3, ["Luz", "Padrões", "Portais"]],
  ["Profanadores", 3, ["Desejo", "Tempestades", "Transfiguração"]],
  ["Devoradores", 4, ["Fera", "Carne", "Natureza"]],
  ["Algozes", 4, ["Morte", "Reinos", "Espírito"]],
];
const loreId = (label: string) => DEMON_LORES.find(([, name]) => name === label)![0];
export const DEMON_HOUSE_LORES: Record<string, string[]> = Object.fromEntries(houseSources.map(([house, , lores]) =>
  [house, [...lores.map(loreId), "dou_fundamento", "dou_humanidade"]]));
export const DEMON_TORMENT_CASES: GrantCase[] = houseSources.map(([equals, torment]) =>
  ({ equals, add: { tormento_permanente: torment } }));

const ids = (fields: Array<[string, string]>) => fields.map(([id]) => id);

export const DEMON_PRIORITY_RULE: PriorityPoints = {
  type: "priority_points", id: "criacao_demonio", label: "Criação por prioridades", freebies: 15, exact: true,
  fields: [], pools: [
    { id: "atributos", label: "Atributos", base: 1, cost: 5, budgets: [7, 5, 3],
      groups: DEMON_ATTRIBUTE_GROUPS.map((group) => ({ label: group.label, fields: ids(group.fields) })) },
    { id: "habilidades", label: "Habilidades", base: 0, cost: 2, budgets: [13, 9, 5],
      groups: DEMON_ABILITY_GROUPS.map((group) => ({ label: group.label, fields: ids(group.fields) })) },
    { id: "antecedentes", label: "Antecedentes", base: 0, cost: 1, budgets: [5],
      groups: [{ label: "Antecedentes", fields: ids(DEMON_BACKGROUNDS) }] },
    { id: "doutrinas", label: "Doutrinas", base: 0, cost: 7, budgets: [3],
      groups: [{ label: "Doutrinas", fields: ids(DEMON_LORES) }],
      allowed: { field: "casa", cases: DEMON_HOUSE_LORES } },
    { id: "virtudes", label: "Virtudes", base: 1, cost: 2, budgets: [3],
      groups: [{ label: "Virtudes", fields: ids(DEMON_VIRTUES) }] },
    { id: "fe", label: "Fé", base: 3, cost: 6, budgets: [0],
      groups: [{ label: "Fé", fields: ["fe_permanente"] }] },
    { id: "vontade", label: "Força de Vontade", base_from_highest: ids(DEMON_VIRTUES), highest_count: 2,
      cost: 1, budgets: [0], groups: [{ label: "Força de Vontade", fields: ["vontade_max"] }] },
  ],
};
DEMON_PRIORITY_RULE.fields = [...new Set(DEMON_PRIORITY_RULE.pools.flatMap((pool) => [
  ...pool.groups.flatMap((group) => group.fields), ...(pool.base_from ?? []), ...(pool.base_from_highest ?? []),
]))];

export const DEMON_STEP_HELP: Record<string, string> = {
  identity: "Defina Casa, facção, Natureza, Comportamento e hospedeiro. A Casa define o Tormento inicial e abre três Doutrinas próprias, além das comuns.",
  attributes: "Cada atributo começa em 1. Distribua 7, 5 e 3 pontos entre Físicos, Sociais e Mentais.",
  skills: "Distribua 13, 9 e 5 pontos entre Talentos, Perícias e Conhecimentos. Antes dos pontos bônus, nenhuma habilidade pode passar de 3.",
  traits: "Distribua 5 pontos em Antecedentes, 3 em Doutrinas e mais 3 nas Virtudes, que começam em 1. A Doutrina fundamental ainda pede conferência do narrador.",
  resources: "Fé começa em 3. A Força de Vontade inicial soma as duas maiores Virtudes; pontos acima dela custam bônus.",
};
