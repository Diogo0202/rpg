import {fileURLToPath} from 'node:url';
import {C,ringInput,evaluateOneRing} from './one-ring-fixture.mjs';
export function ringCases(){
 const cases=[];
 const add=(input)=>{const expected=evaluateOneRing(input);if(expected.errors.length)throw new Error(JSON.stringify(expected.errors));cases.push({input,expected});};
 for(const culture of C.cultures)for(const calling of C.callings)for(const preset of ['1','2','3','4','5','6'])for(const bonus of culture.attribute_bonus?C.attributes:['corpo'])add(ringInput(culture,calling,preset,bonus));
 for(const culture of C.cultures)for(const virtue of C.virtues)for(const dom of virtue.id==='aptitude'?C.attributes:['corpo'])for(const reward of C.rewards)for(const target of reward.targets){
  const input={...ringInput(culture),anel_virtude:virtue.id,anel_recompensa:reward.id,anel_elmo:true,anel_escudo:'buckler',anel_itens_uteis:['lore: Diário de viagem']};
  input.anel_recompensa_alvo=({weapon:input.anel_armas[0],armor:'leather_shirt',helmet:'helmet',shield:'buckler'})[target];
  if(virtue.id==='aptitude')input.anel_dom_atributo=dom;
  if(virtue.id==='mastery'){const fav=evaluateOneRing(input).values.pericias_favorecidas;input.anel_maestria=C.skills.filter(s=>!fav.includes(s.legacy_label)).slice(0,2).map(s=>s.id);}
  add(input);
 }
 const purchased=ringInput();purchased.enhearten=2;purchased[purchased.anel_combate_principal]=3;add(purchased);
 return cases;
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(ringCases()));
