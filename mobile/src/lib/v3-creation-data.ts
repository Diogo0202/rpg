/**
 * Vampire V3 creation as names and numbers only: attributes, abilities,
 * clan disciplines, backgrounds, virtues and the priority budgets. No rules
 * text or book prose is copied. The V5 predator list is added by the starter as
 * a house option; V3 itself has no predator type.
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
  ["disc_dominacao", "Dominação"], ["disc_fortitude", "Fortitude"], ["disc_necromancia", "Necromancia"], ["disc_ofuscacao", "Ofuscação"],
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
  Malkaviano: ["Auspícios", "Dominação", "Ofuscação"],
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

/** Disciplines each clan may raise at creation, by clan option. */
export const V3_ALLOWED_DISCIPLINES: Record<string, string[]> = {
  ...Object.fromEntries(Object.entries(CLAN_DISCIPLINES).map(([clan, labels]) => [clan, labels.map(disciplineId)])),
  Caitiff: V3_DISCIPLINES.map(([id]) => id),
};

