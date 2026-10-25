import { HUNTER_SKILLS, HUNTER_SKILL_DISTRIBUTIONS, HUNTER_DRIVES } from "./hunter-creation-data.ts";
import type { GrantCase, MetaCurrency, SheetField, SheetTemplate } from "./sheet-template.ts";
import { CAITIFF_CHOICE_FIELDS, V5_CLAN_CASES, V5_DISCIPLINES, V5_POWER_SOURCES, V5_PREDATOR_CASES, V5_PREDATOR_NAMES, V5_RITUAL_SOURCES } from "./v5-creation-data.ts";
import { V3_ABILITY_GROUPS, V3_ATTRIBUTE_GROUPS, V3_BACKGROUNDS, V3_CLANS, V3_DISCIPLINES, V3_PRIORITY_RULE, V3_SECTS, V3_VIRTUES } from "./v3-creation-data.ts";

/**
 * Proveniência: contratos estruturados no RPG Atlas, checkout local
 * D:\rpg-atlas-reference, HEAD fb34a5bb6d4d1177c45f2cf64d63533fc8b21b5c.
 * Referências: shared/rpg-systems.ts, shared/vampire-v5.ts,
 * shared/hunter.ts e shared/reference-archive.ts.
 * Foram transportados IDs, rótulos, opções curtas e expressões solicitadas.
 * Nenhuma descrição de poder, efeito de regra ou prosa de livro foi copiada.
 * O ID Atlas `determinacao` mapeia para o ID Nexus `resolucao` nos dois modelos V5.
 * No Um Anel, o recurso Atlas `endurance` é o campo editável Nexus `vigor_marcha`.
 * Caçador usa as 27 habilidades e as distribuições das pp. 54, 57 e 61 do livro indicado pelo usuário.
 * O Um Anel usa as seis habilidades listadas no contrato Atlas. Vigor,
 * Esperança, Sombra e Carga ficam editáveis, sem fórmula de máximo presumida.
 */

export type StarterValue = string | number | boolean | string[];
export type StarterField = SheetField;
export type SystemStarter = {
  id: "vampire-v5" | "vampire-v3" | "hunter" | "one-ring";
  label: string;
  template: SheetTemplate;
  values: Record<string, StarterValue>;
};

type FieldSeed = StarterField & { initial?: StarterValue };

function field(
  id: string,
  label: string,
  kind: StarterField["kind"],
  initial?: StarterValue,
  options: string[] = [],
  expression: string | null = null,
  required = false,
): FieldSeed {
  return { id, label, kind, initial, options, expression, required };
}

function text(id: string, label: string, initial = "", required = false) {
  return field(id, label, "text", initial, [], null, required);
}

function number(id: string, label: string, initial = 0, required = false) {
  return field(id, label, "number", initial, [], null, required);
}

function select(id: string, label: string, options: string[]) {
  return field(id, label, "select", "", options);
}

function collection(id: string, label: string) {
  return field(id, label, "collection", []);
}

function formula(id: string, label: string, expression: string) {
  return field(id, label, "formula", undefined, [], expression);
}

function makeStarter(
  id: SystemStarter["id"],
  label: string,
  templateName: string,
  seeds: FieldSeed[],
  metaCurrencies: MetaCurrency[] = [],
): SystemStarter {
  seeds=[field("sistema","Sistema","text",label),field("ativo_na_sessao","Ativo na sessão","checkbox",true),...seeds,number("experiencia","Experiência disponível")];
  const values: Record<string, StarterValue> = {};
  for (const seed of seeds) if (seed.initial !== undefined) values[seed.id] = seed.initial;
  return {
    id,
    label,
    template: {
      name: templateName,
      version: 1,
      fields: seeds.map(({ initial: _initial, ...definition }) => definition),
      experience_field: "experiencia",
      meta_currencies: metaCurrencies,
    },
    values,
  };
}

const willpower: MetaCurrency = { id: "vontade", label: "Força de Vontade", field: "vontade_superficial", mode: "track", max_field: "vontade_max" };

const v5Attributes: Array<[string, string]> = [
  ["forca", "Força"], ["destreza", "Destreza"], ["vigor", "Vigor"],
  ["carisma", "Carisma"], ["manipulacao", "Manipulação"], ["autocontrole", "Autocontrole"],
  ["inteligencia", "Inteligência"], ["raciocinio", "Raciocínio"], ["resolucao", "Determinação"],
];

const v5Skills: Array<[string, string]> = [
  ["atletismo", "Atletismo"], ["briga", "Briga"], ["conducao", "Condução"],
  ["furtividade", "Furtividade"], ["ladroagem", "Ladroagem"], ["oficios", "Ofícios"],
  ["sobrevivencia", "Sobrevivência"], ["armas_brancas", "Armas Brancas"], ["armas_de_fogo", "Armas de Fogo"],
  ["etiqueta", "Etiqueta"], ["empatia", "Empatia"], ["intimidacao", "Intimidação"],
  ["lideranca", "Liderança"], ["manha", "Manha"], ["performance", "Performance"],
  ["persuasao", "Persuasão"], ["subterfugio", "Subterfúgio"], ["trato_com_animais", "Trato com Animais"],
  ["academicos", "Acadêmicos"], ["ciencia", "Ciência"], ["consciencia", "Consciência"],
  ["financas", "Finanças"], ["investigacao", "Investigação"], ["medicina", "Medicina"],
  ["ocultismo", "Ocultismo"], ["percepcao", "Percepção"], ["tecnologia", "Tecnologia"],
];

const v5Clans = [
  "Banu Haqim", "Brujah", "Gangrel", "Hecata", "Lasombra", "Malkaviano", "Ministério",
  "Nosferatu", "Ravnos", "Salubri", "Toreador", "Tremere", "Tzimisce", "Ventrue", "Caitiff", "Sangue-Ralo",
];

const v5Predators = V5_PREDATOR_NAMES;

/** Select holding a pick a clan or predator grants; its options follow the controlling select. */
function grantChoiceField(fieldId: string, label: string, controller: string, cases: GrantCase[]): FieldSeed {
  const options = cases.flatMap((item) => (item.choices ?? []).filter((choice) => choice.field === fieldId)
    .map((choice) => ({ equals: item.equals, options: choice.options.map((option) => option.label) })));
  return { ...field(fieldId, label, "select"), depends_on: { field_id: controller, cases: options } };
}

const vampire = makeStarter("vampire-v5", "Vampiro V5", "Vampiro V5 essencial", [
  text("nome", "Nome", "", true), text("conceito", "Conceito"), text("cronica", "Crônica"),
  select("cla", "Clã", v5Clans), select("predador", "Tipo de predador", v5Predators),
  ...CAITIFF_CHOICE_FIELDS.map((id, index) => grantChoiceField(id, `Disciplina Caitiff ${index + 1}`, "cla", V5_CLAN_CASES)),
  grantChoiceField("predador_disciplina", "Disciplina bônus do predador", "predador", V5_PREDATOR_CASES),
  grantChoiceField("predador_especialidade", "Especialização do predador", "predador", V5_PREDATOR_CASES),
  ...v5Attributes.map(([id, label]) => number(id, label, 1, true)),
  ...v5Skills.map(([id, label]) => number(id, label)),
  ...V5_DISCIPLINES.map(([id, label]) => number(id, label)),
  number("fome", "Fome", 1), number("humanidade", "Humanidade", 7), number("manchas","Manchas"), number("geracao", "Geração", 13),
  number("potencia_sangue", "Potência de Sangue"), number("recursos", "Recursos"),
  formula("saude_max", "Vitalidade máxima", "vigor + 3"),
  formula("vontade_max", "Força de Vontade máxima", "autocontrole + resolucao"),
  number("saude_superficial", "Dano superficial na Vitalidade"), number("saude_agravada", "Dano agravado na Vitalidade"),
  number("vontade_superficial", "Dano superficial na Força de Vontade"), number("vontade_agravada", "Dano agravado na Força de Vontade"),
  collection("disciplinas", "Poderes de Disciplina"), collection("rituais", "Rituais"), collection("especialidades", "Especialidades"),
  collection("vantagens", "Vantagens"), collection("defeitos", "Defeitos"),
  text("ambicao", "Ambição"), text("desejo", "Desejo"), text("apoiadores", "Apoiadores"),
  { ...select("compulsao_atual", "Compulsão atual", ["Nenhuma", "Fome", "Dominação", "Destruição", "Paranoia", "Compulsão do clã"]), initial: "Nenhuma", private: true },
  { ...text("segredos", "Segredos"), private: true },
], [willpower]);

const hunterCreeds = ["Empreendedor", "Devoto", "Inquisitivo", "Marcial", "Clandestino"];
const hunterArchetypes = [
  "Trabalhador de Jornada Dupla", "Negociador de Contratos", "Influenciador", "Promoter de Boates",
  "Absolvedor", "Convertido de Última Hora", "Espécime Físico", "Apóstata",
  "Libertador de Dados", "Especialista em Sinistros", "Professor Substituto", "Motorista de Rota",
  "Desistente", "Engenheiro", "Ativo Comprometido", "Atirador de Elite",
  "Pistoleiro", "Dono de Galeria", "Contrabandista", "Infiltrado",
];

const hunter = makeStarter("hunter", "Caçador: A Revanche", "Caçador modular", [
  text("nome", "Nome", "", true), text("conceito", "Conceito"), { ...select("credo", "Credo", hunterCreeds), required: true },
  { ...select("impulso", "Ímpeto", HUNTER_DRIVES), required: true }, text("celula", "Célula"), text("ambicao", "Ambição"), text("desejo", "Desejo"),
  collection("pilares", "Pilares"), text("redencao", "Redenção"),
  ...v5Attributes.map(([id, label]) => number(id, label, 1, true)),
  ...HUNTER_SKILLS.map(([id, label]) => number(id, label)),
  formula("saude_max", "Vitalidade máxima", "vigor + 3"),
  formula("vontade_max", "Força de Vontade máxima", "autocontrole + resolucao"),
  number("desespero", "Desespero"), number("recursos", "Recursos"),
  number("saude_superficial","Dano superficial na Vitalidade"),number("saude_agravada","Dano agravado na Vitalidade"),
  number("vontade_superficial","Dano superficial na Vontade"),number("vontade_agravada","Dano agravado na Vontade"),
  collection("arquetipos", "Arquétipos"), collection("vantagens", "Vantagens"),
  collection("especialidades", "Especialidades"), collection("defeitos", "Defeitos"),
  collection("triunfos", "Triunfos"), collection("distincoes", "Distinções"), text("notas", "Notas"),
], [willpower]);

// New starter only: existing approved campaign templates are never rewritten automatically.
hunter.template.version = 2;
const hunterAttributeIds = new Set(v5Attributes.map(([id]) => id));
const hunterSkillIds = new Set(HUNTER_SKILLS.map(([id]) => id));
hunter.template.fields = hunter.template.fields.map((item) => hunterAttributeIds.has(item.id)
  ? { ...item, min: 1, max: 5 }
  : hunterSkillIds.has(item.id) ? { ...item, min: 0, max: 5 } : item);
hunter.template.creation_rules = [
  { type: "group_distribution", id: "atributos", label: "Atributos", fields: v5Attributes.map(([id]) => id),
    options: [{ label: "Distribuição de atributos", counts: { 4: 1, 3: 3, 2: 4, 1: 1 } }] },
  { type: "group_distribution", id: "habilidades", label: "Habilidades", fields: HUNTER_SKILLS.map(([id]) => id),
    options: HUNTER_SKILL_DISTRIBUTIONS },
];

const oneRingLineages = [
  "Anões do Povo de Durin", "Bardeses", "Elfos de Lindon", "Hobbits do Condado", "Homens de Bri", "Patrulheiros do Norte",
];

const oneRing = makeStarter("one-ring", "O Um Anel", "O Um Anel modular", [
  text("nome", "Nome", "", true), text("conceito", "Conceito"), select("linhagem", "Linhagem", oneRingLineages),
  number("forca", "Força", 1, true), number("coracao", "Coração", 1, true), number("espirito", "Espírito", 1, true),
  number("awe", "Presença"), number("athletics", "Atletismo"), number("awareness", "Percepção"),
  number("hunting", "Caçada"), number("song", "Canção"), number("travel", "Viagem"),
  number("vigor_marcha", "Vigor (Endurance)"), number("esperanca", "Esperança"),
  number("sombra", "Sombra"), number("carga", "Carga"), collection("rituais", "Rituais"),
  text("ambicao", "Ambição"), text("desejo", "Desejo"), text("notas", "Notas"),
], [{ id: "esperanca", label: "Esperança", field: "esperanca", mode: "pool" }]);

// V5 creation arithmetic: numbers only, no rules text. Attributes 4/3/3/3/2/2/2/2/1;
// skills follow one of three distributions (the rest stay at 0).
const v5Limits: Record<string, [number, number]> = {
  ...Object.fromEntries(v5Attributes.map(([id]) => [id, [1, 5] as [number, number]])),
  ...Object.fromEntries(v5Skills.map(([id]) => [id, [0, 5] as [number, number]])),
  ...Object.fromEntries(V5_DISCIPLINES.map(([id]) => [id, [0, 5] as [number, number]])),
  fome: [0, 5], humanidade: [0, 10], manchas: [0, 10], geracao: [4, 16], potencia_sangue: [0, 10], recursos: [0, 5],
  saude_superficial: [0, 15], saude_agravada: [0, 15], vontade_superficial: [0, 15], vontade_agravada: [0, 15], experiencia: [0, 9999],
};
vampire.template.fields = vampire.template.fields.map((item) => v5Limits[item.id] ? { ...item, min: v5Limits[item.id][0], max: v5Limits[item.id][1] } : item);
vampire.template.creation_rules = [
  { type: "group_distribution", id: "atributos", label: "Atributos", fields: v5Attributes.map(([id]) => id),
    options: [{ label: "Distribuição de atributos", counts: { 4: 1, 3: 3, 2: 4, 1: 1 } }] },
  { type: "group_distribution", id: "habilidades", label: "Habilidades", fields: v5Skills.map(([id]) => id), options: [
    { label: "Especialista", counts: { 4: 1, 3: 3, 2: 3, 1: 3 } },
    { label: "Pau para toda obra", counts: { 3: 1, 2: 8, 1: 10 } },
    { label: "Equilibrado", counts: { 3: 3, 2: 5, 1: 7 } },
  ] },
  // Disciplines are fully decided by the clan and the predator pick, so they are enforced exactly;
  // Humanity starts at 7 and moves only with the predator. Blood Potency changes are applied, not enforced.
  { type: "select_grants", id: "cla_disciplinas", label: "Disciplinas do clã", field: "cla",
    fields: V5_DISCIPLINES.map(([id]) => id), cases: V5_CLAN_CASES },
  { type: "select_grants", id: "predador_bonus", label: "Bônus do predador", field: "predador",
    fields: ["humanidade", ...V5_DISCIPLINES.map(([id]) => id)], base: { humanidade: 7 }, cases: V5_PREDATOR_CASES },
  { type: "power_picks", id: "poderes", label: "Poderes de Disciplina", collection: "disciplinas",
    fields: V5_DISCIPLINES.map(([id]) => id), sources: V5_POWER_SOURCES },
  { type: "power_picks", id: "rituais_iniciais", label: "Rituais", collection: "rituais",
    fields: ["disc_feiticaria"], sources: V5_RITUAL_SOURCES },
];

// Vampire V3: priorities (7/5/3 attributes, 13/9/5 abilities) plus 15 freebie points, enforced by one
// priority_points rule. Disciplines are limited to the clan's by that rule; the V5 predator list is a house option.
const v3Attributes = V3_ATTRIBUTE_GROUPS.flatMap((group) => group.fields);
const v3Abilities = V3_ABILITY_GROUPS.flatMap((group) => group.fields);
const vampireV3 = makeStarter("vampire-v3", "Vampiro V3", "Vampiro V3 essencial", [
  text("nome", "Nome", "", true), text("conceito", "Conceito"), text("natureza", "Natureza"), text("comportamento", "Comportamento"),
  select("seita", "Seita", V3_SECTS), text("cronica", "Crônica"),
  select("cla", "Clã", V3_CLANS), select("predador", "Tipo de predador (opcional, da casa)", V5_PREDATOR_NAMES),
  ...v3Attributes.map(([id, label]) => number(id, label, 1, true)),
  ...v3Abilities.map(([id, label]) => number(id, label)),
  ...V3_DISCIPLINES.map(([id, label]) => number(id, label)),
  ...V3_BACKGROUNDS.map(([id, label]) => number(id, label)),
  ...V3_VIRTUES.map(([id, label]) => number(id, label, 1, true)),
  number("humanidade", "Humanidade", 2), number("forca_vontade", "Força de Vontade", 1), number("vontade_gasta", "Força de Vontade gasta"),
  number("pontos_sangue", "Pontos de sangue"),
  formula("geracao", "Geração", "13 - ant_geracao"),
  text("notas", "Notas"), { ...text("segredos", "Segredos"), private: true },
], [{ id: "vontade", label: "Força de Vontade", field: "vontade_gasta", mode: "track", max_field: "forca_vontade" }]);

const v3Limits: Record<string, [number, number]> = {
  ...Object.fromEntries(v3Attributes.map(([id]) => [id, [1, 5] as [number, number]])),
  ...Object.fromEntries([...v3Abilities, ...V3_DISCIPLINES, ...V3_BACKGROUNDS].map(([id]) => [id, [0, 5] as [number, number]])),
  ...Object.fromEntries(V3_VIRTUES.map(([id]) => [id, [1, 5] as [number, number]])),
  humanidade: [0, 10], forca_vontade: [0, 10], vontade_gasta: [0, 10], pontos_sangue: [0, 50], experiencia: [0, 9999],
};
vampireV3.template.fields = vampireV3.template.fields.map((item) => v3Limits[item.id] ? { ...item, min: v3Limits[item.id][0], max: v3Limits[item.id][1] } : item);
vampireV3.template.creation_rules = [V3_PRIORITY_RULE];

export const SYSTEM_STARTERS: SystemStarter[] = [vampire, vampireV3, hunter, oneRing];

type StarterMetadata = {
  identity: string[];
  attributes: string[];
  skills: string[];
  traits: string[];
  resources: string[];
  story: string[];
  identities: Record<string, "clan" | "predator" | "creed" | "lineage">;
};

const starterMetadata: Record<SystemStarter["id"], StarterMetadata> = {
  "vampire-v5": {
    identity: ["nome", "conceito", "cronica", "cla", "predador", ...CAITIFF_CHOICE_FIELDS, "predador_disciplina", "predador_especialidade"],
    attributes: ["forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole", "inteligencia", "raciocinio", "resolucao"],
    skills: ["atletismo", "briga", "conducao", "furtividade", "ladroagem", "oficios", "sobrevivencia", "armas_brancas", "armas_de_fogo", "etiqueta", "empatia", "intimidacao", "lideranca", "manha", "performance", "persuasao", "subterfugio", "trato_com_animais", "academicos", "ciencia", "consciencia", "financas", "investigacao", "medicina", "ocultismo", "percepcao", "tecnologia"],
    traits: [...V5_DISCIPLINES.map(([id]) => id), "disciplinas", "rituais", "especialidades", "vantagens", "defeitos"],
    resources: ["fome", "humanidade", "manchas", "geracao", "potencia_sangue", "recursos", "saude_max", "vontade_max", "saude_superficial", "saude_agravada", "vontade_superficial", "vontade_agravada", "experiencia", "compulsao_atual"],
    story: ["ambicao", "desejo", "apoiadores", "segredos"],
    identities: { cla: "clan", predador: "predator" },
  },
  "vampire-v3": {
    identity: ["nome", "conceito", "natureza", "comportamento", "seita", "cronica", "cla", "predador"],
    attributes: V3_ATTRIBUTE_GROUPS.flatMap((group) => group.fields.map(([id]) => id)),
    skills: V3_ABILITY_GROUPS.flatMap((group) => group.fields.map(([id]) => id)),
    traits: [...V3_DISCIPLINES.map(([id]) => id), ...V3_BACKGROUNDS.map(([id]) => id), ...V3_VIRTUES.map(([id]) => id)],
    resources: ["humanidade", "forca_vontade", "vontade_gasta", "pontos_sangue", "geracao", "experiencia"],
    story: ["notas", "segredos"],
    identities: { cla: "clan", predador: "predator" },
  },
  hunter: {
    identity: ["nome", "conceito", "credo", "impulso", "celula", "arquetipos"],
    attributes: ["forca", "destreza", "vigor", "carisma", "manipulacao", "autocontrole", "inteligencia", "raciocinio", "resolucao"],
    skills: HUNTER_SKILLS.map(([id]) => id),
    traits: ["vantagens", "especialidades", "defeitos", "triunfos", "distincoes"],
    resources: ["saude_max", "vontade_max", "desespero", "recursos", "saude_superficial", "saude_agravada", "vontade_superficial", "vontade_agravada", "experiencia"],
    story: ["ambicao", "desejo", "pilares", "redencao", "notas"],
    identities: { credo: "creed" },
  },
  "one-ring": {
    identity: ["nome", "conceito", "linhagem"],
    attributes: ["forca", "coracao", "espirito"],
    skills: ["awe", "athletics", "awareness", "hunting", "song", "travel"],
    traits: ["rituais"],
    resources: ["vigor_marcha", "esperanca", "sombra", "carga", "experiencia"],
    story: ["ambicao", "desejo", "notas"],
    identities: { linhagem: "lineage" },
  },
};

for (const starter of SYSTEM_STARTERS) {
  const metadata = starterMetadata[starter.id];
  starter.template.system_key = starter.id;
  starter.template.fields = starter.template.fields.map((item) => {
    const creation_step = metadata.identity.includes(item.id) ? "identity"
      : metadata.attributes.includes(item.id) ? "attributes"
        : metadata.skills.includes(item.id) ? "skills"
          : metadata.traits.includes(item.id) ? "traits"
            : metadata.resources.includes(item.id) ? "resources"
              : metadata.story.includes(item.id) ? "story"
                : "other";
    return {
      ...item,
      creation_step,
      ...(item.id === "nome" ? { character_name: true } : {}),
      ...(metadata.identities[item.id] ? { identity_kind: metadata.identities[item.id] } : {}),
    };
  });
}
