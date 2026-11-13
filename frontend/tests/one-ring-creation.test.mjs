import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {C,ringInput,evaluateOneRing,reconcileOneRing} from "./one-ring-fixture.mjs";
import {SYSTEM_STARTERS as web} from "../lib/system-starters.ts";
import {SYSTEM_STARTERS as mobile} from "../../mobile/src/lib/system-starters.ts";
for(const culture of C.cultures) for(const calling of C.callings) test(`${culture.id}/${calling.id}: six sets and Ranger bonuses`,()=>{
 for(const preset of ["1","2","3","4","5","6"]) for(const bonus of culture.attribute_bonus?C.attributes:["corpo"]){
  const r=evaluateOneRing(ringInput(culture,calling,preset,bonus));assert.deepEqual(r.errors,[]);assert.equal(C.attributes.reduce((s,k)=>s+Number(r.values[k]),0),culture.attribute_bonus?15:14);assert.equal(r.remaining,10);assert.equal(r.values.vigor_marcha,r.derived.vigor_max);
 }
});
test("web/mobile v3 starter and frozen SQL catalog stay identical",()=>{
 const w=web.find(x=>x.id==="one-ring"),m=mobile.find(x=>x.id==="one-ring");assert.deepEqual(w,m);assert.equal(w.template.rules_profile_version,3);assert.equal(w.template.version,3);
 const sql=readFileSync(new URL('../../supabase/migrations/20261030100000_one_ring_creation_v3.sql',import.meta.url),'utf8');assert.deepEqual(JSON.parse(sql.split('$json$')[1]),C);
});
test("cost includes every intermediate increase and skill/combat share ten points",()=>{
 const raw=ringInput(),skill=C.skills.find(s=>(C.cultures[0].skills[s.id]??0)===0).id;
 const r=evaluateOneRing({...raw,[skill]:4});assert.equal(r.spent,11);assert.ok(r.errors.some(e=>e.field==='experiencia_anterior'));
 const r2=evaluateOneRing({...raw,[skill]:3,[raw.anel_combate_principal]:3});assert.equal(r2.spent,12);assert.ok(r2.remaining<0);
});
test("Maestria adds two distinct ungranted skills; overlaps deduplicate",()=>{
 const raw=ringInput();const baseline=evaluateOneRing(raw).values.pericias_favorecidas;
 const extra=C.skills.filter(s=>!baseline.includes(s.legacy_label)).slice(0,2).map(s=>s.id);
 const r=evaluateOneRing({...raw,anel_virtude:'mastery',anel_maestria:extra});assert.deepEqual(r.errors,[]);assert.equal(r.values.pericias_favorecidas.length,baseline.length+2);
 assert.ok(evaluateOneRing({...raw,anel_virtude:'mastery',anel_maestria:[raw.anel_favorecida_cultura,extra[0]]}).errors.some(e=>e.field==='anel_maestria'));
});
test("culture change rebases purchased ranks without deleting incompatible decisions",()=>{
 const before=evaluateOneRing(ringInput()).values;before.awe=3;
 const after=reconcileOneRing(before,{...before,linhagem:C.cultures[1].name});assert.equal(after.awe,2);assert.equal(after.anel_favorecida_cultura,before.anel_favorecida_cultura);assert.ok(evaluateOneRing(after).errors.length);
});
test("forbidden equipment and incompatible rewards fail",()=>{
 const raw=ringInput(C.cultures.find(c=>c.id==='hobbits'));
 assert.ok(evaluateOneRing({...raw,anel_armas:['great_bow'],anel_recompensa_alvo:'great_bow'}).errors.some(e=>e.field==='anel_armas'));
 assert.ok(evaluateOneRing({...raw,anel_recompensa:'well_fitted'}).errors.some(e=>e.field==='anel_recompensa_alvo'));
});
test("dwarf reduction follows reward load reduction; permanent bonuses are separate",()=>{
 const raw=ringInput();const r=evaluateOneRing({...raw,anel_recompensa:'cunning_make',anel_recompensa_alvo:'leather_shirt'});assert.deepEqual(r.errors,[]);assert.equal(r.inventory.find(x=>x.custom_values.catalog_id==='leather_shirt').custom_values.carga,1);
 const adjusted=evaluateOneRing({...raw,anel_recompensa:'well_fitted',anel_recompensa_alvo:'leather_shirt'});assert.equal(adjusted.values.bonus_protecao,2);assert.equal(adjusted.values.armadura,1);
});

test('conditional combat and Shadow reminders do not change permanent resources',async()=>{
 const {oneRingReminders}=await import('../../shared/one-ring/reminders.ts');
 const values=evaluateOneRing({...ringInput(C.cultures.find(c=>c.id==='hobbits')),anel_virtude:'powerful_hands'}).values;
 const before=structuredClone(values);
 assert.ok(oneRingReminders(values,'combat').some(x=>x.id==='hands'&&x.page===80));
 assert.ok(oneRingReminders(values,'combat').some(x=>x.id==='keen'&&x.page===79));
 assert.ok(!oneRingReminders(values,'combat').some(x=>x.id==='wisdom'));
 assert.ok(oneRingReminders(values,'shadow').some(x=>x.id==='wisdom'));
 assert.deepEqual(values,before);
});
