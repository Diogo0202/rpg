import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBackup,parseBackupText,createVaultBackup } from "../lib/sheet-backup.ts";
import { calculateExperienceCost } from "../lib/experience-math.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";

function backup(){return {format:"rpg-nexus-sheet",format_version:1,name:"Lia",template:{name:"Modelo de teste",version:1,fields:[{id:"nome",label:"Nome",kind:"text",required:true,options:[],expression:null},{id:"vigor",label:"Vigor",kind:"number",required:true,options:[],expression:null}]},values:{nome:"Lia",vigor:0},effects:[],inventory:[]};}
function item(patch={}){return {name:"Item de teste",category:"weapon",quantity:1,resource_cost:1,damage_bonus:2,protection:0,notes:"Manual",acquired:true,equipped:true,sort_order:0,...patch};}

test("preserva zero numérico obrigatório e isola a cópia",()=>{
  const original=backup(),result=validateBackup(original);
  assert.equal(result.values.vigor,0);result.values.nome="Outro";assert.equal(original.values.nome,"Lia");
});
test("rejeita campo obrigatório ausente ou vazio",()=>{
  const value=backup();delete value.values.nome;assert.throws(()=>validateBackup(value),/obrigat/);
  value.values.nome="  ";assert.throws(()=>validateBackup(value),/obrigat/);
});
test("rejeita template vazio e IDs incompatíveis com a API",()=>{
  const value=backup();value.template.fields=[];assert.throws(()=>validateBackup(value));
  const other=backup();other.template.fields[0].id="Nome";assert.throws(()=>validateBackup(other));
});
test("não aceita texto como número ou alteração de campo calculado",()=>{
  const value=backup();value.values.vigor="3";assert.throws(()=>validateBackup(value));
  const calculated=backup();calculated.template.fields[1].kind="formula";calculated.template.fields[1].expression="1+2";assert.throws(()=>validateBackup(calculated));
});
test("rejeita pollution e escopo remoto trazido pelo arquivo",()=>{
  const value=backup();value.owner_id="outro-usuario";assert.throws(()=>validateBackup(value));
  const poisoned=JSON.parse(JSON.stringify(backup()).replace('"values":{','"values":{"__proto__":{"admin":true},'));
  assert.throws(()=>validateBackup(poisoned));assert.equal({}.admin,undefined);
});
test("não executa expressões durante importação",()=>{
  const value=backup();value.template.fields.push({id:"teste",label:"Teste",kind:"formula",required:false,options:[],expression:"globalThis.codeExecuted=true"});
  validateBackup(value);assert.equal(globalThis.codeExecuted,undefined);
});
test("valida as restrições de equipamento do banco",()=>{
  const value=backup();value.inventory=[item({acquired:false})];assert.throws(()=>validateBackup(value));
  value.inventory=[item({category:"animal"})];assert.throws(()=>validateBackup(value));
  value.inventory=[item(),item({name:"Outra arma"})];assert.throws(()=>validateBackup(value));
  value.inventory=[item(),item({category:"armor",name:"Armadura"})];assert.equal(validateBackup(value).inventory.length,2);
});
test("rejeita efeitos repetidos e permite duração encerrada",()=>{
  const effect={id:"condicao",label:"Condição",delta:-2,enabled:true,applies_to_tags:[],exempt_tags:[],remaining_scenes:0,source_note:null};
  const value=backup();value.effects=[effect];assert.equal(validateBackup(value).effects[0].remaining_scenes,0);
  value.effects.push(effect);assert.throws(()=>validateBackup(value));
});
test("backup do cofre preserva documentos e rejeita versão desconhecida",()=>{
  const packed=createVaultBackup([validateBackup(backup())]);assert.equal(parseBackupText(JSON.stringify(packed)).length,1);
  packed.format_version=99;assert.throws(()=>parseBackupText(JSON.stringify(packed)));
});
test("modelos do Atlas exportam o contrato de backup v1 sem metadados de apresentação",()=>{
  assert.ok(SYSTEM_STARTERS.length>=3);
  for(const starter of SYSTEM_STARTERS){
    const template={name:starter.template.name,version:starter.template.version,fields:starter.template.fields.map(({id,label,kind,required,options,expression,depends_on})=>({id,label,kind,required,options,expression,...(depends_on?{depends_on}:{})}))};
    const value={format:"rpg-nexus-sheet",format_version:1,name:"Lia",template,values:{...starter.values,nome:"Lia"},effects:[]};
    // Campos opcionais vazios não são gravados pela oficina.
    for(const field of starter.template.fields)if(field.kind==="select"&&value.values[field.id]===""){
      if(field.required)value.values[field.id]=field.options[0];else delete value.values[field.id];
    }
    for(const field of starter.template.fields)if(field.kind==="number"&&field.required&&value.values[field.id]===undefined){
      value.values[field.id]=field.min??0;
    }
    assert.equal(validateBackup(value).name,"Lia");
    assert.equal(JSON.stringify(value.template).includes("creation_step"),false);
    assert.equal(value.values.ativo_na_sessao,true);
    assert.equal(new Set(starter.template.fields.map(field=>field.id)).size,starter.template.fields.length);
  }
});
test("XP soma cada graduação e rejeita pedidos inválidos",()=>{
  assert.equal(calculateExperienceCost("attribute",1,3),25);
  assert.equal(calculateExperienceCost("skill",0,2),9);
  assert.equal(calculateExperienceCost("outOfClanDiscipline",1,2),14);
  assert.equal(calculateExperienceCost("bloodPotency",1,2),20);
  assert.throws(()=>calculateExperienceCost("invalid",1,2));
  assert.throws(()=>calculateExperienceCost("attribute",2,2));
  assert.throws(()=>calculateExperienceCost("attribute",1.5,3));
});
