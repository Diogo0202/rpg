import { ONE_RING_CATALOG as C } from "./catalog.ts";

export type RingValue = string | number | boolean | string[];
export type RingValues = Record<string, RingValue>;
export type RingError = { field: string; message: string };
export type RingItem = { name: string; category: string; quantity: number; acquired: boolean; equipped: boolean; damage_bonus: number; protection: number; custom_values: Record<string, string | number> };
export type RingReport = { values: RingValues; derived: Record<string, number>; errors: RingError[]; spent: number; remaining: number; inventory: RingItem[] };
export { C as RING_CATALOG };
const array = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const str = (v: unknown) => typeof v === "string" ? v : "";
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0;
export const ringCulture = (v: RingValues) => C.cultures.find((c) => c.name === v.linhagem);
export const ringCalling = (v: RingValues) => C.callings.find((c) => c.name === v.vocacao);
const skillIds = C.skills.map((s) => s.id);
const combatIds = C.proficiencies.map((s) => s.id);
const uniq = (items: string[]) => [...new Set(items)];

export function ringBase(v: RingValues): Record<string, number> {
  const culture = ringCulture(v);
  const base: Record<string, number> = Object.fromEntries([...skillIds, ...combatIds].map((id) => [id, culture?.skills[id] ?? 0]));
  if (culture?.combat.includes(str(v.anel_combate_principal))) base[str(v.anel_combate_principal)] = 2;
  if (combatIds.includes(str(v.anel_combate_secundario)) && v.anel_combate_secundario !== v.anel_combate_principal) base[str(v.anel_combate_secundario)] = 1;
  return base;
}

/** Rebase only purchased ranks. Never erase the player's choices silently. */
export function reconcileOneRing(before: RingValues, after: RingValues): RingValues {
  const next = { ...after };
  const oldBase = ringBase(before), nextBase = ringBase(next);
  for (const id of [...skillIds, ...combatIds]) {
    if (!(id in before)) next[id] = nextBase[id];
    else if (oldBase[id] !== nextBase[id]) next[id] = nextBase[id] + Math.max(0, num(before[id]) - oldBase[id]);
  }
  return next;
}

export function evaluateOneRing(input: RingValues): RingReport {
  const v: RingValues = { ...input };
  if(typeof v.nome === "string")v.nome=v.nome.trim();
  const errors: RingError[] = [];
  const add = (field: string, message: string) => errors.push({ field, message });
  const culture = ringCulture(v), calling = ringCalling(v);
  if (!str(v.nome).trim() || str(v.nome).trim().length > 120) add("nome", "Informe um nome de até 120 caracteres.");
  if (!culture) add("linhagem", "Escolha uma cultura.");
  if (!calling) add("vocacao", "Escolha um Chamado.");
  const preset = Number(v.anel_atributos) - 1;
  if (!Number.isInteger(preset) || preset < 0 || preset > 5 || !str(v.anel_atributos)) add("anel_atributos", "Escolha um dos seis conjuntos de atributos.");
  if (culture && preset >= 0 && preset < 6) {
    C.attributes.forEach((id, i) => { v[id] = culture.attributes[preset][i]; });
    if ("attribute_bonus" in culture) {
      if (!C.attributes.includes(str(v.anel_bonus_atributo))) add("anel_bonus_atributo", "Escolha o atributo que recebe +1 de Reis dos Homens.");
      else v[str(v.anel_bonus_atributo)] = num(v[str(v.anel_bonus_atributo)]) + 1;
    }
    ["base_vigor", "base_esperanca", "base_aparar"].forEach((id, i) => { v[id] = culture.bases[i]; });
    v.bencao_cultural = culture.blessing;
    v.padrao_vida = culture.living;
    v.idiomas = [...culture.languages];
    v.tesouro = C.living.find((l) => l.name === culture.living)?.treasure ?? 0;
  }
  const culturalPick = str(v.anel_favorecida_cultura), callingPicks = array(v.anel_favorecidas_chamado);
  if (culture && !culture.favoured.includes(culturalPick)) add("anel_favorecida_cultura", "Escolha uma perícia favorecida da cultura.");
  if (calling && (callingPicks.length !== 2 || uniq(callingPicks).length !== 2 || callingPicks.some((id) => !calling.favoured.includes(id)))) add("anel_favorecidas_chamado", "Escolha duas perícias distintas do Chamado.");
  if (calling) {
    v.caminho_sombra = calling.shadow;
    v.traco_chamado = calling.trait;
    if ("enemy_choice" in calling) {
      if (!C.enemies.includes(str(v.anel_inimigo))) add("anel_inimigo", "Escolha o tipo de inimigo do Campeão.");
      else v.traco_chamado = `${calling.trait}: ${v.anel_inimigo}`;
    }
  }
  const traits = array(v.tracos_distintivos);
  if (culture && (traits.length !== 2 || uniq(traits).length !== 2 || traits.some((t) => !culture.traits.includes(t)))) add("tracos_distintivos", "Escolha duas características notáveis da cultura.");
  if (culture && !culture.combat.includes(str(v.anel_combate_principal))) add("anel_combate_principal", "Escolha a proficiência principal da cultura.");
  if (!combatIds.includes(str(v.anel_combate_secundario)) || v.anel_combate_principal === v.anel_combate_secundario) add("anel_combate_secundario", "Escolha outra proficiência para receber 1 ponto.");
  const base = ringBase(v);
  let spent = 0;
  for (const id of [...skillIds, ...combatIds]) {
    const isCombat = combatIds.includes(id), max = isCombat ? 3 : 4, costs = isCombat ? C.combat_costs : C.skill_costs;
    if (!(id in v)) v[id] = base[id];
    const rank = num(v[id]);
    if (!Number.isInteger(v[id]) || rank < base[id] || rank > max) add(id, `Escolha um nível entre ${base[id]} e ${max}.`);
    else for (let level = base[id] + 1; level <= rank; level++) spent += costs[level];
  }
  if (spent > C.previous_experience) add("experiencia_anterior", `Você gastou ${spent} de ${C.previous_experience} pontos disponíveis.`);
  const virtue = C.virtues.find((x) => x.id === v.anel_virtude);
  if (!virtue) add("anel_virtude", "Escolha uma Virtude inicial.");
  const favoured = uniq([culturalPick, ...callingPicks].filter((id) => skillIds.includes(id)));
  if (v.anel_virtude === "mastery") {
    const picks = array(v.anel_maestria);
    if (picks.length !== 2 || uniq(picks).length !== 2 || picks.some((id) => !skillIds.includes(id) || favoured.includes(id))) add("anel_maestria", "Maestria pede duas perícias ainda não favorecidas.");
    favoured.push(...picks.filter((id) => skillIds.includes(id)));
  }
  if (v.anel_virtude === "aptitude" && !C.attributes.includes(str(v.anel_dom_atributo))) add("anel_dom_atributo", "Escolha o atributo do Dom.");
  v.pericias_favorecidas = uniq(favoured).map((id) => C.skills.find((s) => s.id === id)!.legacy_label);
  v.virtudes = virtue ? [virtue.name] : [];
  v.valor = 1; v.sabedoria = 1;
  v.bonus_vigor = v.anel_virtude === "resilience" ? 2 : 0;
  v.bonus_esperanca = v.anel_virtude === "confidence" ? 2 : 0;
  v.bonus_aparar = v.anel_virtude === "dexterity" ? 1 : 0;
  for (const id of C.attributes) v[`desconto_tn_${id}`] = v.anel_virtude === "aptitude" && v.anel_dom_atributo === id ? 1 : 0;
  const chosenWeapons = array(v.anel_armas);
  if (uniq(chosenWeapons).length !== chosenWeapons.length) add("anel_armas", "Não repita a mesma arma na criação.");
  const weapons = chosenWeapons.map((id) => C.weapons.find((w) => w.id === id));
  const counts: Record<string, number> = {};
  for (const weapon of weapons) {
    if (!weapon) { add("anel_armas", "Arma desconhecida."); continue; }
    counts[weapon.proficiency] = (counts[weapon.proficiency] ?? 0) + 1;
    if (weapon.proficiency !== "briga" && num(v[weapon.proficiency]) < 1) add("anel_armas", `O herói não tem proficiência para ${weapon.name}.`);
    if (counts[weapon.proficiency] > 1) add("anel_armas", "Escolha no máximo uma arma por proficiência na criação.");
    if (culture && (("forbidden_equipment" in culture && culture.forbidden_equipment?.includes(weapon.id)) || ("allowed_weapons" in culture && !culture.allowed_weapons?.includes(weapon.id)))) add("anel_armas", `${weapon.name} não é permitida para esta cultura.`);
  }
  const armor = C.armor.find((x) => x.id === v.anel_armadura);
  const shield = C.shields.find((x) => x.id === v.anel_escudo);
  if (!armor) add("anel_armadura", "Escolha a armadura ou marque sem armadura.");
  if (!shield) add("anel_escudo", "Escolha o escudo ou marque sem escudo.");
  const living = C.living.findIndex((l) => l.name === culture?.living);
  for (const item of [armor, shield]) if (item && C.living.findIndex((l) => l.name === item.minimum_living) > living) add(item === armor ? "anel_armadura" : "anel_escudo", "O padrão de vida não permite este equipamento inicial.");
  if (culture && shield && "forbidden_equipment" in culture && culture.forbidden_equipment?.includes(shield.id)) add("anel_escudo", "Esta cultura não pode usar escudo grande.");
  const reward = C.rewards.find((r) => r.id === v.anel_recompensa);
  if (!reward) add("anel_recompensa", "Escolha uma Recompensa inicial.");
  const equipped: Array<{ id: string; name: string; type: string; load: number; damage?: number; wound?: number; wound_two_hands?: number; proficiency?: string; protection?: number; parry?: number }> = [
    ...weapons.filter((w) => w !== undefined).map((w) => ({ ...w, type: "weapon" })),
    ...(armor && armor.id !== "none" ? [{ ...armor, type: "armor" }] : []),
    ...(v.anel_elmo === true ? [{ ...C.helmet, type: "helmet" }] : []),
    ...(shield && shield.id !== "none" ? [{ ...shield, type: "shield" }] : []),
  ];
  const target = equipped.find((x) => x.id === v.anel_recompensa_alvo);
  if (reward && (!target || !reward.targets.includes(target.type))) add("anel_recompensa_alvo", "Escolha um item equipado compatível com a Recompensa.");
  let load = 0, protectionBonus = 0;
  const inventory: RingItem[] = equipped.map((item) => {
    const applied = item.id === target?.id ? reward : undefined;
    let itemLoad = Math.max(0, item.load - (applied?.id === "cunning_make" ? 2 : 0));
    if (culture && "armor_load_divisor" in culture && (item.type === "armor" || item.type === "helmet")) itemLoad = Math.ceil(itemLoad / (culture.armor_load_divisor ?? 1));
    load += itemLoad;
    if (applied?.id === "well_fitted") protectionBonus += 2;
    const damage = (item.damage ?? 0) + (applied?.id === "fell" ? 1 : 0);
    return { name: item.name, category: item.type === "weapon" ? "weapon" : item.type === "armor" || item.type === "helmet" ? "armor" : "equipment", quantity: 1, acquired: true, equipped: true,
      damage_bonus: damage, protection: item.protection ?? 0,
      custom_values: { catalog_id: item.id, carga: itemLoad, ferimento: (item.wound ?? 0) + (applied?.id === "grievous" ? 2 : 0), ferimento_duas_maos: (item.wound_two_hands ?? item.wound ?? 0) + (applied?.id === "grievous" ? 2 : 0), protecao_dados: item.protection ?? 0, bonus_bloqueio: (item.parry ?? 0) + (applied?.id === "reinforced" ? 1 : 0), recompensa: applied?.id ?? "", proficiencia: item.proficiency ?? "" } };
  });
  const useful = array(v.anel_itens_uteis);
  const usefulLimit = C.living.find((l) => l.name === culture?.living)?.useful_items ?? 0;
  if (useful.length > usefulLimit || useful.some((item) => { const at = item.indexOf(":"); return at < 1 || !skillIds.includes(item.slice(0, at)) || !item.slice(at + 1).trim() || item.length > 300; })) add("anel_itens_uteis", `Escolha até ${usefulLimit} itens úteis, vinculados a uma perícia.`);
  for (const item of useful) inventory.push({ name: item.slice(item.indexOf(":") + 1).trim(), category: "equipment", quantity: 1, acquired: true, equipped: true, damage_bonus: 0, protection: 0, custom_values: { catalog_id: "useful", carga: 0, proficiencia: item.slice(0, item.indexOf(":")) } });
  v.recompensas = reward ? [reward.name] : [];
  v.bonus_escudo = (shield?.parry ?? 0) + (reward?.id === "reinforced" && target?.id === shield?.id ? 1 : 0);
  v.bonus_protecao = protectionBonus;
  v.armadura = (armor?.protection ?? 0) + (v.anel_elmo === true ? C.helmet.protection : 0);
  v.carga = load;
  v.equipamento = inventory.map((item) => item.name);
  const derived = {
    tn_corpo: 20 - num(v.corpo) - num(v.desconto_tn_corpo), tn_coracao: 20 - num(v.coracao) - num(v.desconto_tn_coracao), tn_astucia: 20 - num(v.astucia) - num(v.desconto_tn_astucia),
    vigor_max: num(v.corpo) + num(v.base_vigor) + num(v.bonus_vigor), esperanca_max: num(v.coracao) + num(v.base_esperanca) + num(v.bonus_esperanca),
    aparar: num(v.astucia) + num(v.base_aparar) + num(v.bonus_escudo) + num(v.bonus_aparar), carga_total: load, sombra_total: 0,
  };
  v.vigor_marcha = derived.vigor_max; v.esperanca = derived.esperanca_max;
  for (const key of ["sombra", "cicatrizes", "cansaco", "ferimento_dias", "pontos_aventura", "pontos_habilidade", "experiencia"]) v[key] = 0;
  v.ferido = false;
  if (num(v.idade) < 1 || num(v.idade) > 10000 || !Number.isInteger(v.idade)) add("idade", "Informe uma idade inteira positiva.");
  for (const field of oneRingV3Fields()) if (field.kind === "select" && v[field.id] === "") delete v[field.id];
  return { values: v, derived, errors, spent, remaining: C.previous_experience - spent, inventory };
}

export type RingSeed = { id: string; label: string; kind: "text"|"number"|"select"|"checkbox"|"collection"|"formula"|"roll"; required: boolean; options: string[]; expression: string|null; initial?: RingValue; min?: number; max?: number; max_items?: number; max_length?: number; character_name?: boolean; creation_step?: "identity"|"attributes"|"skills"|"traits"|"resources"|"story" };
export function oneRingV3Fields(): RingSeed[] {
  const labels: Record<string,string> = {base_vigor:"Base cultural de Resistência",base_esperanca:"Base cultural de Esperança",base_aparar:"Base cultural de Bloqueio",bonus_vigor:"Bônus permanente de Resistência",bonus_esperanca:"Bônus permanente de Esperança",bonus_aparar:"Bônus permanente de Bloqueio",bonus_escudo:"Bloqueio do escudo",bonus_protecao:"Bônus fixo de proteção",desconto_tn_corpo:"Redução do NA de Força",desconto_tn_coracao:"Redução do NA de Coração",desconto_tn_astucia:"Redução do NA de Astúcia",vigor_marcha:"Resistência atual",esperanca:"Esperança atual",armadura:"Proteção em dados",carga:"Carga",cansaco:"Fadiga",sombra:"Sombra",cicatrizes:"Cicatrizes de Sombra",ferimento_dias:"Dias de ferimento",pontos_aventura:"Pontos de Aventura",pontos_habilidade:"Pontos de Perícia",tesouro:"Tesouro",tn_corpo:"NA de Força",tn_coracao:"NA de Coração",tn_astucia:"NA de Astúcia",vigor_max:"Resistência máxima",esperanca_max:"Esperança máxima",aparar:"Bloqueio",carga_total:"Carga e Fadiga",sombra_total:"Sombra total",bencao_cultural:"Bênção cultural",caminho_sombra:"Caminho da Sombra",traco_chamado:"Característica do Chamado"};
  const f = (id: string, label: string, kind: RingSeed["kind"], extra: Partial<RingSeed> = {}): RingSeed => ({ id, label, kind, required: false, options: [], expression: null, ...extra });
  const n = (id: string, label: string, max = 1000, initial = 0) => f(id, label, "number", { min: 0, max, initial });
  const l = (id: string, label: string, max_items = 30) => f(id, label, "collection", { max_items, max_length: 500, initial: [] });
  const s = (id: string, label: string, options: string[]) => f(id, label, "select", { options, initial: "" });
  return [f("nome", "Nome", "text", { required: true, initial: "", max_length: 120, character_name: true }), n("idade", "Idade", 10000), f("conceito", "Conceito", "text", { initial: "", max_length: 160 }),
    s("linhagem", "Cultura", C.cultures.map((c) => c.name)), s("vocacao", "Chamado", C.callings.map((c) => c.name)),
    s("anel_atributos", "Conjunto de atributos", ["1","2","3","4","5","6"]), s("anel_bonus_atributo", "Reis dos Homens", C.attributes),
    s("anel_favorecida_cultura", "Favorecida da cultura", skillIds), l("anel_favorecidas_chamado", "Favorecidas do Chamado", 2),
    s("anel_combate_principal", "Proficiência principal", combatIds), s("anel_combate_secundario", "Proficiência secundária", combatIds),
    s("anel_inimigo", "Conhecimento sobre Inimigos", C.enemies), s("anel_virtude", "Virtude inicial", C.virtues.map((x) => x.id)),
    s("anel_dom_atributo", "Atributo do Dom", C.attributes), l("anel_maestria", "Perícias de Maestria", 2),
    s("anel_recompensa", "Recompensa inicial", C.rewards.map((r) => r.id)),
    s("anel_recompensa_alvo", "Item da Recompensa", [...C.weapons.map((w) => w.id), ...C.armor.filter((a) => a.id !== "none").map((a) => a.id), "helmet", ...C.shields.filter((a) => a.id !== "none").map((a) => a.id)]),
    l("anel_armas", "Armas iniciais", 5), s("anel_armadura", "Armadura", C.armor.map((a) => a.id)), f("anel_elmo", "Elmo", "checkbox", { initial: false }), s("anel_escudo", "Escudo", C.shields.map((a) => a.id)), l("anel_itens_uteis", "Itens úteis", 4),
    ...C.attributes.map((id,i) => n(id, ["Força","Coração","Astúcia"][i], 8, 2)),
    ...C.skills.map((x) => n(x.id, x.label, 6)), ...C.proficiencies.map((x) => n(x.id, x.label, 6)),
    l("tracos_distintivos", "Características notáveis", 2), l("pericias_favorecidas", "Perícias favorecidas", 18), l("idiomas", "Idiomas", 8),
    ...["bencao_cultural","caminho_sombra","traco_chamado"].map((id) => f(id, labels[id] ?? id, "text", { initial: "" })),
    s("padrao_vida", "Padrão de vida", C.living.map((x) => x.name)), l("virtudes", "Virtudes"), l("recompensas", "Recompensas"), l("equipamento", "Equipamento"),
    ...["base_vigor","base_esperanca","base_aparar","bonus_vigor","bonus_esperanca","bonus_aparar","bonus_escudo","bonus_protecao","desconto_tn_corpo","desconto_tn_coracao","desconto_tn_astucia","vigor_marcha","esperanca","armadura","carga","cansaco","sombra","cicatrizes","ferimento_dias","pontos_aventura","pontos_habilidade","tesouro"].map((id) => n(id, labels[id] ?? id)),
    n("valor", "Valor", 6, 1), n("sabedoria", "Sabedoria", 6, 1), f("ferido", "Ferido", "checkbox", { initial: false }), f("notas", "Notas", "text", { initial: "", max_length: 10000 }),
    ...Object.entries({tn_corpo:"20 - corpo - desconto_tn_corpo",tn_coracao:"20 - coracao - desconto_tn_coracao",tn_astucia:"20 - astucia - desconto_tn_astucia",vigor_max:"corpo + base_vigor + bonus_vigor",esperanca_max:"coracao + base_esperanca + bonus_esperanca",aparar:"astucia + base_aparar + bonus_escudo + bonus_aparar",carga_total:"carga + cansaco",sombra_total:"sombra + cicatrizes"}).map(([id,expression])=>f(id,labels[id] ?? id,"formula",{expression})),
  ];
}

export const ONE_RING_INVENTORY_SCHEMA = [
  ...["carga","ferimento","ferimento_duas_maos","protecao_dados","bonus_bloqueio"].map((id) => ({ id, label: id.replaceAll("_"," "), kind: "number" as const, required: false, options: [] as string[], expression: null, min: 0, max: 1000 })),
  ...["catalog_id","recompensa","proficiencia"].map((id) => ({ id, label: id, kind: "text" as const, required: false, options: [] as string[], expression: null, max_length: 120 })),
];
