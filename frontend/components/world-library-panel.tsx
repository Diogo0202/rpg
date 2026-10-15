"use client";

import {useEffect,useState,type FormEvent} from "react";
import {createClient} from "../lib/supabase/client";
import {downloadText} from "../lib/download";

type Entity={id:string;kind:string;name:string;body:Record<string,unknown>;version:number};
type Relation={id:string;from_entity_id:string;to_entity_id:string;relation_type:string;notes:string};
const labels:Record<string,string>={character:"Personagem",npc:"NPC ou antagonista",item:"Item",rule:"Regra",location:"Local",quest:"Missão",event:"Evento",scene:"Cena"};

export function WorldLibraryPanel({campaignId,viewerId,canManage}:{campaignId:string;viewerId:string;canManage:boolean}){
  const [entities,setEntities]=useState<Entity[]>([]),[relations,setRelations]=useState<Relation[]>([]);
  const [editing,setEditing]=useState<Entity|null>(null),[name,setName]=useState(""),[kind,setKind]=useState("npc"),[description,setDescription]=useState("");
  const [creature,setCreature]=useState("mortal"),[threat,setThreat]=useState("moderate"),[system,setSystem]=useState(""),[hook,setHook]=useState(""),[source,setSource]=useState("");
  const [query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[threatFilter,setThreatFilter]=useState("all"),[creatureFilter,setCreatureFilter]=useState("all");
  const [from,setFrom]=useState(""),[to,setTo]=useState(""),[relation,setRelation]=useState("aliado");
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[revision,setRevision]=useState(0);

  useEffect(()=>{let active=true;async function load(){try{
    const client=createClient();const [a,b]=await Promise.all([client.from("world_entities").select("id,kind,name,body,version").eq("campaign_id",campaignId).order("name"),client.from("world_relations").select("id,from_entity_id,to_entity_id,relation_type,notes").eq("campaign_id",campaignId)]);
    if(!active)return;if(a.error||b.error)throw new Error();setEntities((a.data??[])as Entity[]);setRelations((b.data??[])as Relation[]);
  }catch{if(active)setMessage("Não foi possível carregar o mundo. Confira conexão, permissões e migrations.");}}void load();return()=>{active=false;};},[campaignId,revision]);

  async function write(operation:()=>PromiseLike<{error:unknown;data?:unknown}>,success:string){if(!canManage)return;setBusy(true);setMessage("");try{
    const {error,data}=await operation();if(error||(Array.isArray(data)&&data.length===0))throw new Error("Falha ou conflito ao gravar. Atualize os dados antes de repetir.");setRevision(value=>value+1);setMessage(success);
  }catch(error){setMessage(error instanceof Error?error.message:"Falha ao gravar.");}finally{setBusy(false);}}

  function save(event:FormEvent<HTMLFormElement>){event.preventDefault();const patch={name:name.trim(),kind,body:{...(editing?.body??{}),description,creature,threat,system,hook,source}};void write(()=>editing
    ?createClient().from("world_entities").update(patch).eq("id",editing.id).eq("campaign_id",campaignId).eq("version",editing.version).select("id")
    :createClient().from("world_entities").insert({...patch,campaign_id:campaignId,created_by:viewerId}).select("id"),"Registro salvo no mundo.");}

  const visible=entities.filter(item=>(filter==="all"||item.kind===filter)&&(threatFilter==="all"||item.body.threat===threatFilter)&&(creatureFilter==="all"||item.body.creature===creatureFilter)&&`${item.name} ${JSON.stringify(item.body)}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const entityName=(id:string)=>entities.find(item=>item.id===id)?.name??"Registro removido";

  return <section className="content world-library-layout">
    <article className="generation-card"><p className="eyebrow">ARQUIVO DA CAMPANHA</p><h2>Mundo e antagonistas</h2>
      <p>Os membros desta campanha podem ler estes registros. Segredos privados do narrador não devem ser publicados aqui.</p>
      <div className="inventory-filters"><label>Buscar<input value={query} maxLength={160} onChange={event=>setQuery(event.target.value)}/></label><label>Tipo<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">Todos</option>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label>Criatura<select value={creatureFilter} onChange={event=>setCreatureFilter(event.target.value)}>{["all","vampire","werewolf","mage","mortal","faction","entity","other"].map(value=><option key={value} value={value}>{value==="all"?"Todas":value}</option>)}</select></label>
        <label>Ameaça<select value={threatFilter} onChange={event=>setThreatFilter(event.target.value)}>{["all","minor","moderate","major","critical","cataclysmic"].map(value=><option key={value} value={value}>{value==="all"?"Todas":value}</option>)}</select></label></div>
      <div className="actions"><button className="quiet" type="button" onClick={()=>setRevision(value=>value+1)}>Atualizar</button><button className="quiet" type="button" onClick={()=>downloadText("mundo-da-campanha.json",JSON.stringify({format:"rpg-nexus-world",version:1,entities:visible.map(({kind,name,body})=>({kind,name,body})),relations:relations.map(item=>({from:entityName(item.from_entity_id),to:entityName(item.to_entity_id),relation:item.relation_type,notes:item.notes}))},null,2))}>Exportar JSON</button></div>
      {visible.map(item=><article className="inventory-item" key={item.id}><h3>{item.name}</h3><small>{labels[item.kind]} · {String(item.body.system??"")} · {String(item.body.threat??"")}</small><p className="inventory-notes">{String(item.body.description??"")}</p>{Boolean(item.body.hook)&&<p>Gancho: {String(item.body.hook)}</p>}{Boolean(item.body.source)&&<p>Fonte: {String(item.body.source)}</p>}
        {canManage&&<div className="actions"><button className="quiet" type="button" disabled={busy} onClick={()=>{setEditing(item);setName(item.name);setKind(item.kind);setDescription(String(item.body.description??""));setCreature(String(item.body.creature??"other"));setThreat(String(item.body.threat??"moderate"));setSystem(String(item.body.system??""));setHook(String(item.body.hook??""));setSource(String(item.body.source??""));}}>Editar {item.name}</button><button className="quiet" type="button" disabled={busy} onClick={()=>void write(()=>createClient().from("world_entities").delete().eq("id",item.id).eq("campaign_id",campaignId).eq("version",item.version).select("id"),"Registro removido.")}>Excluir {item.name}</button></div>}
      </article>)}{visible.length===0&&<p>Nenhum registro encontrado.</p>}
      <h3>Relações</h3>{relations.map(item=><p key={item.id}>{entityName(item.from_entity_id)} · {item.relation_type} · {entityName(item.to_entity_id)} {canManage&&<button className="quiet" type="button" disabled={busy} onClick={()=>void write(()=>createClient().from("world_relations").delete().eq("id",item.id).eq("campaign_id",campaignId).select("id"),"Relação removida.")}>Remover relação</button>}</p>)}
      <p role="status">{message}</p>
    </article>
    {canManage&&<article className="generation-card"><h2>{editing?"Editar registro":"Novo registro"}</h2><form className="inventory-form" onSubmit={save}>
      <label>Nome<input value={name} maxLength={160} required onChange={event=>setName(event.target.value)}/></label><label>Tipo<select value={kind} onChange={event=>setKind(event.target.value)}>{Object.entries(labels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Descrição<textarea value={description} maxLength={8000} rows={5} onChange={event=>setDescription(event.target.value)}/></label>
      <label>Criatura<select value={creature} onChange={event=>setCreature(event.target.value)}>{["vampire","werewolf","mage","mortal","faction","entity","other"].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Ameaça<select value={threat} onChange={event=>setThreat(event.target.value)}>{["minor","moderate","major","critical","cataclysmic"].map(value=><option key={value}>{value}</option>)}</select></label>
      {[["Sistema",system,setSystem],["Gancho",hook,setHook],["Fonte e página",source,setSource]].map(([label,value,setter])=><label key={label as string}>{label as string}<input value={value as string} maxLength={1000} onChange={event=>(setter as (value:string)=>void)(event.target.value)}/></label>)}
      <div className="actions"><button className="primary" disabled={busy} type="submit">Salvar registro</button><button className="quiet" type="button" onClick={()=>{setEditing(null);setName("");setDescription("");setHook("");setSource("");}}>Novo</button></div>
    </form><h3>Ligar registros</h3><form className="inventory-form" onSubmit={event=>{event.preventDefault();if(from===to){setMessage("Escolha registros diferentes.");return;}void write(()=>createClient().from("world_relations").insert({campaign_id:campaignId,from_entity_id:from,to_entity_id:to,relation_type:relation,created_by:viewerId}).select("id"),"Relação salva.");}}>
      <label>Origem<select required value={from} onChange={event=>setFrom(event.target.value)}><option value="">Selecione</option>{entities.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Destino<select required value={to} onChange={event=>setTo(event.target.value)}><option value="">Selecione</option>{entities.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Relação<input value={relation} required maxLength={80} onChange={event=>setRelation(event.target.value)}/></label><button className="primary" disabled={busy} type="submit">Salvar relação</button>
    </form></article>}
  </section>;
}
