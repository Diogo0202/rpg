import type { CatalogEntry, CollectionPointsRule, GrantBaseBy, GrantCase, GrantChoice, GrantChoiceOption, PowerSource, SelectRangesRule, SpecialtyPicksRule } from "./sheet-template.ts";

/**
 * V5 creation packages as names and numbers only: which disciplines each clan
 * grants, what each predator type adds, and the power and ritual names a
 * character may pick at creation. No power effect or book prose is copied.
 * Names follow the Portuguese edition as closely as known and stay editable in
 * the template editor; the three supplement predators are flagged in REVIEW.
 */

export const V5_DISCIPLINES: Array<[id: string, label: string]> = [
  ["disc_animalismo", "Animalismo"], ["disc_auspicios", "Auspícios"], ["disc_dominacao", "Dominação"],
  ["disc_fortitude", "Fortitude"], ["disc_ofuscacao", "Ofuscação"], ["disc_potencia", "Potência"],
  ["disc_presenca", "Presença"], ["disc_metamorfose", "Metamorfose"], ["disc_rapidez", "Rapidez"],
  ["disc_feiticaria", "Feitiçaria do Sangue"], ["disc_oblivio", "Oblívio"], ["disc_alquimia", "Alquimia do Sangue-Ralo"],
];

const id = (label: string) => V5_DISCIPLINES.find(([, name]) => name === label)![0];
const dots = (...labels: string[]) => Object.fromEntries(labels.map((label) => [id(label), 1]));

const CLAN_DISCIPLINES: Record<string, string[]> = {
  "Banu Haqim": ["Feitiçaria do Sangue", "Ofuscação", "Rapidez"],
  Brujah: ["Potência", "Presença", "Rapidez"],
  Gangrel: ["Animalismo", "Fortitude", "Metamorfose"],
  Hecata: ["Auspícios", "Fortitude", "Oblívio"],
  Lasombra: ["Dominação", "Oblívio", "Potência"],
  Malkaviano: ["Auspícios", "Dominação", "Ofuscação"],
  Ministério: ["Metamorfose", "Ofuscação", "Presença"],
  Nosferatu: ["Animalismo", "Ofuscação", "Potência"],
  Ravnos: ["Animalismo", "Ofuscação", "Presença"],
  Salubri: ["Auspícios", "Dominação", "Fortitude"],
  Toreador: ["Auspícios", "Presença", "Rapidez"],
  Tremere: ["Auspícios", "Dominação", "Feitiçaria do Sangue"],
  Tzimisce: ["Animalismo", "Dominação", "Metamorfose"],
  Ventrue: ["Dominação", "Fortitude", "Presença"],
  "Sangue-Ralo": ["Alquimia do Sangue-Ralo"],
};

const anyDiscipline = (field: string, label: string): GrantChoice => ({
  field, label,
  options: V5_DISCIPLINES.filter(([, name]) => name !== "Alquimia do Sangue-Ralo").map(([fieldId, name]) => ({ label: name, add: { [fieldId]: 1 } })),
});

/** Caitiff have no clan disciplines: the player picks three, one dot each. */
export const CAITIFF_CHOICE_FIELDS = ["caitiff_disciplina_1", "caitiff_disciplina_2", "caitiff_disciplina_3"];

export const V5_CLAN_CASES: GrantCase[] = [
  ...Object.entries(CLAN_DISCIPLINES).map(([clan, labels]) => ({ equals: clan, add: dots(...labels) })),
  { equals: "Caitiff", choices: CAITIFF_CHOICE_FIELDS.map((field, index) => anyDiscipline(field, `Disciplina ${index + 1}`)) },
];

const sorcererClans = { field: "cla", in: ["Tremere", "Banu Haqim"] };
const discipline = (label: string, requires?: GrantChoiceOption["requires"]): GrantChoiceOption => ({ label, add: { [id(label)]: 1 }, ...(requires ? { requires } : {}) });
const specialty = (label: string): GrantChoiceOption => ({ label, items: { especialidades: [label] } });

type Predator = { name: string; specialties: string[]; disciplines: GrantChoiceOption[]; humanity?: number; potency?: number; advantages?: string[]; flaws?: string[] };

const PREDATORS: Predator[] = [
  { name: "Gato de Beco", specialties: ["Intimidação (Assaltos)", "Briga (Agarrar)"], disciplines: [discipline("Rapidez"), discipline("Potência")],
    humanity: -1, advantages: ["Contatos criminosos •••"] },
  { name: "Ensacador", specialties: ["Ladroagem (Arrombamento)", "Manha (Mercado negro)"],
    disciplines: [discipline("Feitiçaria do Sangue", sorcererClans), discipline("Oblívio", { field: "cla", in: ["Hecata"] }), discipline("Ofuscação")],
    advantages: ["Estômago de Ferro •••"], flaws: ["Inimigo ••"] },
  { name: "Sanguessuga", specialties: ["Briga (Membros)", "Furtividade (Contra Membros)"], disciplines: [discipline("Rapidez"), discipline("Metamorfose")],
    humanity: -1, potency: 1, flaws: ["Segredo Sombrio: Diablerista •• ou Rejeitado ••", "Exclusão de Presa: mortais ••"] },
  { name: "Talhador", specialties: ["Persuasão (Manipulação)", "Subterfúgio (Encobrimento)"], disciplines: [discipline("Dominação"), discipline("Animalismo")],
    advantages: ["Rebanho ••"], flaws: ["Segredo Sombrio: Talhador •"] },
  { name: "Consensualista", specialties: ["Medicina (Flebotomia)", "Persuasão (Vítimas)"], disciplines: [discipline("Auspícios"), discipline("Fortitude")],
    humanity: 1, flaws: ["Segredo Sombrio: quebra da Máscara •", "Exclusão de Presa: quem não consente •"] },
  { name: "Criador", specialties: ["Trato com Animais (animal específico)", "Sobrevivência (Caça)"], disciplines: [discipline("Animalismo"), discipline("Metamorfose")],
    humanity: 1, flaws: ["Vegano ••"] },
  { name: "Osíris", specialties: ["Ocultismo (tradição específica)", "Performance (área específica)"], disciplines: [discipline("Feitiçaria do Sangue", sorcererClans), discipline("Presença")],
    advantages: ["Fama e Rebanho: 3 pontos para dividir"], flaws: ["Inimigos e defeitos míticos: 2 pontos para dividir"] },
  { name: "Homem-Areia", specialties: ["Medicina (Anestésicos)", "Furtividade (Invasão)"], disciplines: [discipline("Auspícios"), discipline("Ofuscação")],
    advantages: ["Recursos •"] },
  { name: "Rainha da Cena", specialties: ["Etiqueta (cena específica)", "Liderança (cena específica)", "Manha (cena específica)"], disciplines: [discipline("Dominação"), discipline("Potência")],
    advantages: ["Fama •", "Contato •"], flaws: ["Desprezado • ou Exclusão de Presa: outra subcultura •"] },
  { name: "Sereia", specialties: ["Persuasão (Sedução)", "Subterfúgio (Sedução)"], disciplines: [discipline("Fortitude"), discipline("Presença")],
    advantages: ["Bela ••"], flaws: ["Inimigo • (amante rejeitado ou parceiro ciumento)"] },
  { name: "Assassino de Beira de Estrada", specialties: ["Sobrevivência (A estrada)", "Investigação (Rastrear vítimas)"], disciplines: [discipline("Fortitude"), discipline("Metamorfose")],
    advantages: ["Rebanho migratório ••"], flaws: ["Exclusão de Presa: moradores locais •"] },
  { name: "Extorsionista", specialties: ["Intimidação (Coerção)", "Ladroagem (Segurança)"], disciplines: [discipline("Dominação"), discipline("Potência")],
    advantages: ["Contatos e Recursos: 3 pontos para dividir"], flaws: ["Inimigo •• (polícia ou vítima)"] },
  { name: "Ladrão de Túmulos", specialties: ["Ocultismo (Ritos funerários)", "Medicina (Cadáveres)"], disciplines: [discipline("Fortitude"), discipline("Oblívio")],
    advantages: ["Estômago de Ferro •••", "Refúgio •"], flaws: ["Rebanho: Predador Óbvio ••"] },
];

/** Predators outside the core book; their numbers should be checked against the table's supplement. */
export const REVIEW_PREDATORS = ["Assassino de Beira de Estrada", "Extorsionista", "Ladrão de Túmulos"];

export const V5_PREDATOR_NAMES = PREDATORS.map((predator) => predator.name);

export const V5_PREDATOR_CASES: GrantCase[] = PREDATORS.map((predator) => ({
  equals: predator.name,
  add: { ...(predator.humanity ? { humanidade: predator.humanity } : {}), ...(predator.potency ? { potencia_sangue: predator.potency } : {}) },
  items: { ...(predator.advantages ? { vantagens: predator.advantages } : {}), ...(predator.flaws ? { defeitos: predator.flaws } : {}) },
  choices: [
    { field: "predador_disciplina", label: "Disciplina bônus", options: predator.disciplines },
    { field: "predador_especialidade", label: "Especialização", options: predator.specialties.map(specialty) },
  ],
}));

/** Starting Blood Potency by generation: 14th-16th (thin-blooded) 0, 12th-13th 1, 10th-11th 2; it joins the predator's adds. */
export const V5_POTENCY_BY_GENERATION: GrantBaseBy = {
  field: "geracao",
  bands: [{ min: 14, max: 16, add: { potencia_sangue: 0 } }, { min: 12, max: 13, add: { potencia_sangue: 1 } }, { min: 10, max: 11, add: { potencia_sangue: 2 } }],
};

const upTo = (max: number) => Array.from({ length: max }, (_, index) => index + 1);
const entries = (list: Array<[name: string, costs: number[]]>): CatalogEntry[] => list.map(([name, costs]) => ({ name, costs }));

/**
 * Closed lists of Advantage and Flaw names with the points each may take, names
 * and numbers only. Recursos is the number field, so it stays out of the list.
 * Detail goes after a colon or in parentheses: "Aliados: polícia ••".
 */
export const V5_ADVANTAGE_CATALOG: CatalogEntry[] = entries([
  ["Aliados", upTo(5)], ["Contatos", upTo(3)], ["Fama", upTo(5)], ["Influência", upTo(5)], ["Refúgio", upTo(3)],
  ["Máscara", upTo(2)], ["Mawla", upTo(5)], ["Rebanho", upTo(5)], ["Lacaios", upTo(3)], ["Status", upTo(5)],
  ["Linguística", upTo(5)], ["Bela", [2]], ["Deslumbrante", [4]], ["Farejador de Sangue", [1]], ["Estômago de Ferro", [3]], ["Comer Comida", [2]],
  // Thin-blood merits (one point each).
  ["Camaradas Anarquistas", [1]], ["Contato na Camarilla", [1]], ["Sangue Encadeador", [1]], ["Bebedor Diurno", [1]],
  ["Afinidade de Disciplina", [1]], ["Semblante Vivo", [1]], ["Alquimista Sangue-Ralo", [1]], ["Resiliência Vampírica", [1]],
]);

export const V5_FLAW_CATALOG: CatalogEntry[] = entries([
  ["Inimigo", upTo(5)], ["Infame", upTo(3)], ["Sem Refúgio", [1]], ["Refúgio Comprometido", [2]], ["Refúgio Sinistro", [1]], ["Refúgio Assombrado", upTo(3)],
  ["Antipatizado", [1]], ["Desprezado", [2]], ["Cadáver Conhecido", [1]], ["Identidade Conhecida", [2]], ["Dívidas de Prestação", upTo(3)],
  ["Destituído", [1]], ["Perseguidores", [1]], ["Suspeito", [1]], ["Rejeitado", [2]], ["Segredo Sombrio", upTo(3)],
  ["Analfabeto", [2]], ["Feio", [1]], ["Repulsivo", [2]], ["Exclusão de Presa", [1]], ["Sede de Matusalém", [1]], ["Organóvoro", [2]], ["Vegano", [2]],
  ["Predador Óbvio", [2]], ["Isca de Estaca", [2]], ["Perdição Folclórica", [1]], ["Bloqueio Folclórico", [1]], ["Estigmas", [1]],
  ["Vício", [1]], ["Vício Irremediável", [2]], ["Arcaico", [1]], ["Vivendo no Passado", [1]], ["Escravo do Vínculo", [2]], ["Viciado em Vínculo", [1]], ["Vínculo Duradouro", [1]],
  // Thin-blood flaws (one point each).
  ["Dentes de Leite", [1]], ["Temperamento Bestial", [1]], ["Marcado pela Camarilla", [1]], ["Maldição de Clã", [1]], ["Carne Morta", [1]],
  ["Fragilidade Mortal", [1]], ["Rejeitado pelos Anarquistas", [1]], ["Dependência de Vitae", [1]],
]);

/** 7 points of Advantages (Resources counts toward them) and 2 of Flaws; the predator's own advantages and flaws are extra. */
export const V5_ADVANTAGE_RULES: CollectionPointsRule[] = [
  { type: "collection_points", id: "vantagens_pontos", label: "Vantagens", collection: "vantagens", fields: ["recursos"], points: 7, catalog: V5_ADVANTAGE_CATALOG, allow_homebrew: false },
  { type: "collection_points", id: "defeitos_pontos", label: "Defeitos", collection: "defeitos", fields: [], points: 2, catalog: V5_FLAW_CATALOG, allow_homebrew: false },
];

/**
 * Clan and generation: thin-blooded only at 14th-16th, every other clan (Caitiff and
 * homebrew included) at 10th-13th, the starting bands of V5_POTENCY_BY_GENERATION
 * (neonate 12th-13th, ancilla 10th-11th). A narrator who wants neonates only narrows
 * `default` in the template. Thin-blood Blood Potency stays at 0, so the predator that
 * raises it is refused for them (kept in V5_REVIEW_RULES for the table to confirm).
 */
export const V5_CLAN_GENERATION_RULE: SelectRangesRule = {
  type: "select_ranges", id: "cla_geracao", label: "Clã e geração", field: "cla", fields: [],
  cases: [{ equals: ["Sangue-Ralo"], ranges: { geracao: { min: 14, max: 16 } }, exclude: { predador: ["Sanguessuga"] } }],
  default: { ranges: { geracao: { min: 10, max: 13 } } },
};

/** Skills that always get a free specialty when they have dots; one more goes to any skill with dots. */
export const V5_SPECIALTY_REQUIRED = ["academicos", "oficios", "performance", "ciencia"];

export function v5SpecialtyRule(skills: Array<[id: string, label: string]>): SpecialtyPicksRule {
  return { type: "specialty_picks", id: "especializacoes", label: "Especializações", collection: "especialidades",
    skills: skills.map(([field, label]) => ({ field, label })), required: V5_SPECIALTY_REQUIRED, free: 1, fields: [] };
}

/** Choices the table should confirm against its books. */
export const V5_REVIEW_RULES = [
  "Sangue-Ralo com predador Sanguessuga é recusado (Potência de Sangue dos Sangue-Ralo fica em 0).",
  "Gerações iniciais dos demais clãs: 10ª a 13ª (neófito ou ancilla); o narrador pode restringir no modelo.",
  "Méritos e defeitos de Sangue-Ralo contam nos 7 e 2 pontos como os demais.",
];

const powers = (...levels: string[][]) => levels.flatMap((names, index) => names.map((name) => ({ name, level: index + 1 })));
const needs = (name: string, level: number, label: string, min: number) => ({ name, level, requires: { field: id(label), min } });

const POWERS: Record<string, PowerSource["powers"]> = {
  Animalismo: [...powers(["Vínculo Famulus", "Sentir a Besta"], ["Sussurros Selvagens"], ["Suculência Animal", "Acalmar a Besta"], ["Subsumir o Espírito"], ["Domínio Animal", "Extrair a Besta"]),
    needs("Colmeia Morta-Viva", 3, "Ofuscação", 2)],
  Auspícios: [...powers(["Sentidos Aguçados", "Sentir o Invisível"], ["Premonição"], ["Ler a Alma", "Compartilhar os Sentidos"], ["Toque do Espírito"], ["Clarividência", "Telepatia"]),
    needs("Possessão", 5, "Dominação", 3)],
  Dominação: [...powers(["Nublar Memória", "Compelir"], ["Hipnotizar"], ["Mente Esquecida", "Diretiva Submersa"], ["Racionalizar"], ["Manipulação em Massa", "Decreto Terminal"]),
    needs("Demência", 2, "Ofuscação", 2)],
  Fortitude: [...powers(["Resiliência", "Mente Inabalável"], ["Robustez"], ["Desafiar a Ruína", "Fortificar a Fachada Interior"], ["Elixir da Resistência"], ["Carne de Mármore", "Proeza pela Dor"]),
    needs("Feras Resistentes", 2, "Animalismo", 1)],
  Ofuscação: powers(["Manto de Sombras", "Silêncio da Morte"], ["Passagem Invisível"], ["Fantasma na Máquina", "Máscara das Mil Faces"], ["Ocultar", "Desaparecer"], ["Ocultar a Reunião", "Disfarce do Impostor"]),
  Potência: [...powers(["Corpo Letal", "Salto Prodigioso"], ["Proeza"], ["Alimentação Brutal", "Pegada Sobrenatural"], ["Elixir do Poder"], ["Tremor de Terra", "Punho de Caim"]),
    needs("Centelha de Fúria", 3, "Presença", 3)],
  Presença: [...powers(["Fascínio", "Intimidar"], ["Beijo Persistente"], ["Olhar Aterrorizante", "Encantamento"], ["Convocar"], ["Majestade", "Magnetismo Estelar"]),
    needs("Voz Irresistível", 4, "Dominação", 1)],
  Metamorfose: powers(["Olhos da Besta", "Peso da Pena"], ["Armas Ferais"], ["Fusão com a Terra", "Mudar de Forma"], ["Metamorfose"], ["Forma de Névoa", "O Coração Liberto"]),
  Rapidez: powers(["Graça Felina", "Reflexos Rápidos"], ["Ligeireza"], ["Piscar", "Travessia"], ["Elixir da Elegância", "Mira Infalível"], ["Golpe Relâmpago", "Fração de Segundo"]),
  "Feitiçaria do Sangue": powers(["Vitae Corrosiva", "Gosto por Sangue"], ["Extinguir Vitae"], ["Sangue da Potência", "Toque do Escorpião"], ["Roubo de Vitae"], ["Carícia de Baal", "Caldeirão de Sangue"]),
  Oblívio: [...powers(["Manto de Sombra", "Visão do Oblívio"], ["Lançar Sombras"], ["Aura de Decadência", "Banquete de Paixões", "Perspectiva das Sombras", "Toque do Oblívio"], ["Praga Necrótica", "Mortalha Estígia"], ["Passo das Sombras", "Skuld Cumprido", "Avatar Tenebroso"]),
    needs("Braços de Ahriman", 2, "Potência", 2)],
  "Alquimia do Sangue-Ralo": powers(["Longo Alcance", "Névoa"], ["Envolver"], ["Desfracionar"], ["Impulso Aéreo"], ["Hieros Gamos Profano"]),
};

export const V5_POWER_SOURCES: PowerSource[] = V5_DISCIPLINES.map(([field, label]) => ({
  field, label, count: "dots", max_level: "dots", powers: [...POWERS[label]].sort((a, b) => a.level - b.level),
}));

/** A sorcerer starts with one level-1 ritual. */
export const V5_RITUAL_SOURCES: PowerSource[] = [{
  field: "disc_feiticaria", label: "Feitiçaria do Sangue", count: 1, max_level: 1,
  powers: powers(
    ["Caminhada de Sangue", "Aderência do Inseto", "Criar Pedra de Sangue", "Despertar com o Frescor da Noite", "Proteção contra Carniçais"],
    ["Comunicar-se com o Senhor", "Olhos de Babel", "Iluminar o Rastro da Presa", "Verdade do Sangue", "Proteção contra Espíritos", "Círculo de Proteção contra Carniçais"],
    ["Chamado de Dagon", "Desvio da Ruína de Madeira", "Essência do Ar", "Andar sobre o Fogo", "Proteção contra Lupinos", "Círculo de Proteção contra Espíritos"],
    ["Defesa do Refúgio Sagrado", "Olhos do Falcão Noturno", "Passagem Incorpórea", "Proteção contra Cainitas", "Círculo de Proteção contra Lupinos"],
    ["Fuga para o Santuário Verdadeiro", "Coração de Pedra", "Haste da Dissolução Tardia", "Círculo de Proteção contra Cainitas"],
  ),
}];

/**
 * F1: mechanical metadata of each Discipline power, numbers and short labels only
 * (no book text). `rouse` is the number of Rouse Checks to activate (0 = free,
 * null = varies), `pool` the dice pool or null when there is no roll. Every entry
 * is marked for the table to check against the book (V5_POWER_METADATA_REVIEW).
 */
export type V5PowerMetadata = { discipline: string; name: string; level: number; rouse: number | null; pool: string | null; duration: string; review: true };

const PASSIVE = "Passivo", SCENE = "Uma cena", TURN = "Um turno", NIGHT = "Uma noite", USE = "Um uso", UNTIL = "Até encerrar";
type Meta = [name: string, rouse: number | null, pool: string | null, duration: string];

const POWER_META: Record<string, Meta[]> = {
  Animalismo: [["Vínculo Famulus", 3, "Carisma + Trato com Animais", PASSIVE], ["Sentir a Besta", 0, "Determinação + Animalismo", PASSIVE],
    ["Sussurros Selvagens", 1, "Manipulação + Animalismo", SCENE], ["Suculência Animal", 0, null, PASSIVE], ["Acalmar a Besta", 1, "Carisma + Animalismo", SCENE],
    ["Colmeia Morta-Viva", 0, null, PASSIVE], ["Subsumir o Espírito", 1, "Manipulação + Animalismo", SCENE], ["Domínio Animal", 2, "Carisma + Animalismo", SCENE],
    ["Extrair a Besta", 1, "Raciocínio + Animalismo", SCENE]],
  Auspícios: [["Sentidos Aguçados", 0, "Raciocínio + Auspícios", UNTIL], ["Sentir o Invisível", 0, "Raciocínio + Auspícios", PASSIVE],
    ["Premonição", 0, "Determinação + Auspícios", PASSIVE], ["Ler a Alma", 1, "Inteligência + Auspícios", TURN], ["Compartilhar os Sentidos", 1, "Determinação + Auspícios", SCENE],
    ["Toque do Espírito", 1, "Inteligência + Auspícios", TURN], ["Clarividência", 1, "Inteligência + Auspícios", "Alguns minutos"],
    ["Possessão", 2, "Determinação + Auspícios", UNTIL], ["Telepatia", 1, "Determinação + Auspícios", "Um minuto"]],
  Dominação: [["Nublar Memória", 0, "Carisma + Dominação", "Indefinida"], ["Compelir", 0, "Carisma + Dominação", TURN],
    ["Hipnotizar", 1, "Manipulação + Dominação", UNTIL], ["Demência", 1, "Manipulação + Dominação", SCENE], ["Mente Esquecida", 1, "Manipulação + Dominação", "Indefinida"],
    ["Diretiva Submersa", 0, null, PASSIVE], ["Racionalizar", 0, null, PASSIVE], ["Manipulação em Massa", 1, "Manipulação + Dominação", "Como o poder"],
    ["Decreto Terminal", 0, null, PASSIVE]],
  Fortitude: [["Resiliência", 0, null, PASSIVE], ["Mente Inabalável", 0, null, PASSIVE], ["Robustez", 1, null, SCENE], ["Feras Resistentes", 1, "Vigor + Animalismo", SCENE],
    ["Desafiar a Ruína", 1, "Raciocínio + Sobrevivência", SCENE], ["Fortificar a Fachada Interior", 0, null, PASSIVE], ["Elixir da Resistência", 1, null, NIGHT],
    ["Carne de Mármore", 2, null, SCENE], ["Proeza pela Dor", 1, null, SCENE]],
  Ofuscação: [["Manto de Sombras", 0, null, SCENE], ["Silêncio da Morte", 0, null, SCENE], ["Passagem Invisível", 1, "Raciocínio + Ofuscação", SCENE],
    ["Fantasma na Máquina", 0, null, PASSIVE], ["Máscara das Mil Faces", 1, "Manipulação + Ofuscação", SCENE], ["Ocultar", 1, "Inteligência + Ofuscação", NIGHT],
    ["Desaparecer", 0, "Raciocínio + Ofuscação", SCENE], ["Ocultar a Reunião", 1, "Como o poder", SCENE], ["Disfarce do Impostor", 1, "Raciocínio + Ofuscação", SCENE]],
  Potência: [["Corpo Letal", 0, null, PASSIVE], ["Salto Prodigioso", 0, null, PASSIVE], ["Proeza", 1, null, SCENE], ["Alimentação Brutal", 0, null, PASSIVE],
    ["Centelha de Fúria", 1, "Manipulação + Presença", SCENE], ["Pegada Sobrenatural", 1, null, SCENE], ["Elixir do Poder", 1, null, NIGHT],
    ["Tremor de Terra", 2, "Força + Potência", USE], ["Punho de Caim", 1, null, TURN]],
  Presença: [["Fascínio", 0, "Manipulação + Presença", SCENE], ["Intimidar", 0, null, SCENE], ["Beijo Persistente", 0, null, PASSIVE],
    ["Olhar Aterrorizante", 1, "Carisma + Presença", TURN], ["Encantamento", 1, "Carisma + Presença", "Uma hora"], ["Voz Irresistível", 0, null, PASSIVE],
    ["Convocar", 1, "Manipulação + Presença", NIGHT], ["Majestade", 2, "Carisma + Presença", SCENE], ["Magnetismo Estelar", 1, null, "Como o poder"]],
  Metamorfose: [["Olhos da Besta", 0, null, UNTIL], ["Peso da Pena", 0, null, SCENE], ["Armas Ferais", 1, null, SCENE], ["Fusão com a Terra", 1, null, "Um dia"],
    ["Mudar de Forma", 1, null, SCENE], ["Metamorfose", 1, null, SCENE], ["Forma de Névoa", null, null, SCENE], ["O Coração Liberto", 0, null, PASSIVE]],
  Rapidez: [["Graça Felina", 0, null, PASSIVE], ["Reflexos Rápidos", 0, null, PASSIVE], ["Ligeireza", 1, null, SCENE], ["Piscar", 1, "Destreza + Atletismo", TURN],
    ["Travessia", 1, "Destreza + Atletismo", TURN], ["Elixir da Elegância", 1, null, NIGHT], ["Mira Infalível", 2, null, USE],
    ["Golpe Relâmpago", 1, null, USE], ["Fração de Segundo", 1, null, USE]],
  "Feitiçaria do Sangue": [["Vitae Corrosiva", null, null, USE], ["Gosto por Sangue", 0, "Determinação + Feitiçaria do Sangue", USE],
    ["Extinguir Vitae", 1, "Inteligência + Feitiçaria do Sangue", USE], ["Sangue da Potência", 1, "Determinação + Feitiçaria do Sangue", NIGHT],
    ["Toque do Escorpião", null, "Força + Feitiçaria do Sangue", SCENE], ["Roubo de Vitae", 1, "Raciocínio + Feitiçaria do Sangue", USE],
    ["Carícia de Baal", 1, "Força + Feitiçaria do Sangue", SCENE], ["Caldeirão de Sangue", 1, "Determinação + Feitiçaria do Sangue", TURN]],
  Oblívio: [["Manto de Sombra", 0, null, SCENE], ["Visão do Oblívio", 0, null, UNTIL], ["Lançar Sombras", 1, null, SCENE], ["Braços de Ahriman", 1, "Raciocínio + Oblívio", SCENE],
    ["Aura de Decadência", 1, "Vigor + Oblívio", SCENE], ["Banquete de Paixões", 0, null, PASSIVE], ["Perspectiva das Sombras", 1, null, SCENE],
    ["Toque do Oblívio", 1, "Força + Oblívio", USE], ["Praga Necrótica", 1, "Inteligência + Oblívio", USE], ["Mortalha Estígia", 1, null, SCENE],
    ["Passo das Sombras", 1, null, USE], ["Skuld Cumprido", 2, "Vigor + Oblívio", USE], ["Avatar Tenebroso", 2, null, SCENE]],
  "Alquimia do Sangue-Ralo": [["Longo Alcance", null, null, USE], ["Névoa", null, null, SCENE], ["Envolver", null, null, SCENE], ["Desfracionar", null, null, USE],
    ["Impulso Aéreo", null, null, SCENE], ["Hieros Gamos Profano", null, null, USE]],
};

export const V5_POWER_METADATA: V5PowerMetadata[] = Object.entries(POWER_META).flatMap(([discipline, list]) => list.map(([name, rouse, pool, duration]) => ({
  discipline, name, level: POWERS[discipline].find((power) => power.name === name)?.level ?? 0, rouse, pool, duration, review: true as const,
})));

export const V5_POWER_METADATA_REVIEW = "Custos de Rouse (Despertar o Sangue), paradas e durações dos poderes de Disciplina: conferir no livro. Fórmulas de Alquimia do Sangue-Ralo ficam sem custo definido.";

/** Metadata for a power by its name, or for a sheet item "Disciplina: Poder". */
export function v5PowerMetadata(nameOrItem: string): V5PowerMetadata | null {
  const index = nameOrItem.indexOf(":");
  const discipline = index > 0 ? nameOrItem.slice(0, index).trim() : null;
  const name = index > 0 ? nameOrItem.slice(index + 1).trim() : nameOrItem.trim();
  return V5_POWER_METADATA.find((item) => item.name === name && (!discipline || item.discipline === discipline)) ?? null;
}

export function describeV5Power(meta: V5PowerMetadata): string {
  const cost = meta.rouse === null ? "Rouse variável" : meta.rouse === 0 ? "grátis" : `${meta.rouse} Rouse`;
  return [`Nível ${meta.level}`, cost, meta.pool ?? "sem rolagem", meta.duration].join(" · ");
}
