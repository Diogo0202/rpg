import { RING_CATALOG as C, evaluateOneRing, reconcileOneRing } from "../../shared/one-ring/creation.ts";
export function ringInput(culture=C.cultures[0],calling=C.callings[0],preset="1",bonus="corpo") {
 const primary=culture.combat[0],secondary=C.proficiencies.find(x=>x.id!==primary).id;
 const weapon=C.weapons.find(x=>x.proficiency===primary && !culture.forbidden_equipment?.includes(x.id) && (!culture.allowed_weapons || culture.allowed_weapons.includes(x.id)));
 return {nome:`Herói ${culture.id} ${calling.id}`,idade:100,linhagem:culture.name,vocacao:calling.name,anel_atributos:preset,...(culture.attribute_bonus?{anel_bonus_atributo:bonus}:{}),anel_favorecida_cultura:culture.favoured[0],anel_favorecidas_chamado:calling.favoured.slice(0,2),anel_combate_principal:primary,anel_combate_secundario:secondary,tracos_distintivos:culture.traits.slice(0,2),anel_virtude:"resilience",anel_recompensa:"keen",anel_recompensa_alvo:weapon.id,anel_armas:[weapon.id],anel_armadura:"leather_shirt",anel_escudo:"none",anel_elmo:false,anel_itens_uteis:[],...(calling.enemy_choice?{anel_inimigo:C.enemies[0]}:{})};
}
export {C,evaluateOneRing,reconcileOneRing};
