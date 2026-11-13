import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {createTestDatabase} from './test-db.mjs';
import {ringCases} from '../frontend/tests/one-ring-parity.mjs';
import {C} from '../frontend/tests/one-ring-fixture.mjs';
const {db,migrations}=await createTestDatabase();let cases=0;
try {
 for(const c of ringCases()) {
  const result=await db.query('select private.one_ring_creation($1::jsonb,$2) as result',[JSON.stringify(c.input),c.input.nome]);
  const actual=result.rows[0].result;assert.deepEqual(actual.values,c.expected.values,JSON.stringify(c.input));assert.deepEqual(actual.inventory,c.expected.inventory);assert.deepEqual(actual.derived,c.expected.derived);cases++;
 }
 for(const patron of C.patrons){const result=await db.query('select private.one_ring_patron_bonus($1) as bonus',[patron.id]);assert.equal(result.rows[0].bonus,patron.bonus);cases++;}
 const fixture=JSON.parse(await readFile(new URL('../backend/tests/fixtures/one_ring_v3_starter.json',import.meta.url),'utf8'));
 const actor='81000000-0000-4000-8000-000000000001',player='81000000-0000-4000-8000-000000000002',camp='82000000-0000-4000-8000-000000000001',template='83000000-0000-4000-8000-000000000001';
 await db.query("insert into auth.users(id) values($1),($2)",[actor,player]);await db.query("insert into public.campaigns(id,owner_id,name) values($1,$2,'Ring parity')",[camp,actor]);await db.query("insert into public.campaign_members(campaign_id,user_id,role) values($1,$2,'player')",[camp,player]);
 await db.query("insert into public.system_templates(id,campaign_id,owner_id,name,version,status,schema) values($1,$2,$3,$4,3,'approved',$5::jsonb)",[template,camp,actor,fixture.template.name,JSON.stringify(fixture.template)]);
 await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[player]);
 const c=ringCases()[0];const created=await db.query("select * from public.create_one_ring_sheet($1,$2,$3,$4::jsonb)",[camp,template,c.input.nome,JSON.stringify(c.expected.values)]);const id=created.rows[0].id;
 assert.deepEqual(created.rows[0].values,c.expected.values);const inv=await db.query('select name,custom_values from public.character_inventory where sheet_id=$1 order by sort_order',[id]);assert.equal(inv.rows.length,c.expected.inventory.length);cases++;
 await assert.rejects(db.query("insert into public.character_sheets(campaign_id,template_id,owner_id,name,values) values($1,$2,$3,$4,$5::jsonb)",[camp,template,player,c.input.nome,JSON.stringify({...c.expected.values,corpo:99})]));cases++;
 await assert.rejects(db.query("insert into public.character_sheets(campaign_id,template_id,owner_id,name,values) values($1,$2,$3,'Incomplete','{}'::jsonb)",[camp,template,player]));cases++;
 const device='84000000-0000-4000-8000-000000000001';
 const mutation={operation_id:'85000000-0000-4000-8000-000000000001',entity_type:'character_sheets',entity_id:'86000000-0000-4000-8000-000000000001',action:'create',base_version:0,changes:Object.entries({template_id:template,name:c.input.nome,values:c.expected.values}).map(([key,value])=>({path:[key],before:{exists:false},after:{exists:true,value}})),depends_on:[]};
 const pushed=await db.query('select public.mobile_sync_push($1,$2,$3::jsonb) as result',[camp,device,JSON.stringify([mutation])]);assert.equal(pushed.rows[0].result.results[0].status,'applied',JSON.stringify(pushed.rows[0].result));cases++;
 const replay=await db.query('select public.mobile_sync_push($1,$2,$3::jsonb) as result',[camp,device,JSON.stringify([mutation])]);assert.equal(replay.rows[0].result.results[0].status,'duplicate');cases++;
 const bad=structuredClone(mutation);bad.operation_id='85000000-0000-4000-8000-000000000002';bad.entity_id='86000000-0000-4000-8000-000000000002';bad.changes.find(x=>x.path[0]==='values').after.value.esperanca=99;
 const denied=await db.query('select public.mobile_sync_push($1,$2,$3::jsonb) as result',[camp,device,JSON.stringify([bad])]);assert.equal(denied.rows[0].result.results[0].status,'invalid',JSON.stringify(denied.rows[0].result));cases++;
 const count=await db.query('select count(*)::integer as count from public.character_inventory where campaign_id=$1',[camp]);assert.equal(count.rows[0].count,c.expected.inventory.length*2);cases++;
 console.log(JSON.stringify({environment:'PGlite descartável',migrations:migrations.length,cases,atomicInventory:true,rawInvalidRejected:true}));
} finally {await db.close();}
