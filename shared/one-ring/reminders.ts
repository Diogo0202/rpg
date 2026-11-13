import { ONE_RING_CATALOG as C } from "./catalog.ts";
import type { RingValues } from "./creation.ts";
/** Conditional rules stay visible at their point of use, outside permanent totals. */
export function oneRingReminders(values:RingValues,context:"all"|"combat"|"shadow"="all"):Array<{id:string;text:string;page:number}>{
 if(!values.anel_atributos)return[];
 const culture=C.cultures.find(c=>c.name===values.linhagem),result:Array<{id:string;text:string;page:number}>=[];
 if(context!=="combat"){
  if(culture?.valour_favoured)result.push({id:"valour",text:"Coração Forte: os testes de Valor são favorecidos.",page:culture.page});
  if(culture?.wisdom_favoured)result.push({id:"wisdom",text:"Bom-senso Hobbit: testes de Sabedoria favorecidos; contra Ganância, acrescente 1 dado de Sucesso ao Teste de Sombra.",page:culture.page});
 }
 if(context!=="shadow"){
  if(values.anel_virtude==="powerful_hands")result.push({id:"hands",text:"Mãos Inclementes: no Dano Especial, Golpe Pesado recebe +1 no valor de Força; Perfurante recebe +1 no resultado do Dado de Façanha.",page:80});
  if(values.anel_recompensa==="keen")result.push({id:"keen",text:`Afiada: ataques com ${C.weapons.find(w=>w.id===values.anel_recompensa_alvo)?.name??"a arma recompensada"} também produzem Golpe Perfurante quando o Dado de Façanha mostra 9.`,page:79});
  if(values.anel_recompensa==="well_fitted")result.push({id:"protection",text:"Ajustado: some 2 ao resultado da jogada de Proteção com o item recompensado. Este bônus não aumenta a quantidade de dados.",page:79});
 }
 return result;
}
