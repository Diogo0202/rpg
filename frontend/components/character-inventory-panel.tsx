"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCharacterSession } from "../lib/character-session";
import { createClient } from "../lib/supabase/client";
import { ATLAS_EQUIPMENT,filterAtlasEquipment,type AtlasEquipmentCategory,type AtlasEra,type AtlasDamageKind } from "../lib/atlas-equipment";

const categories = { weapon: "Arma", armor: "Armadura", equipment: "Equipamento", clothing: "Roupa", dwelling: "Moradia", vehicle: "Veículo", mount: "Montaria", animal: "Animal" };
type Category = keyof typeof categories;
type Item = { id:string;name:string;category:Category;quantity:number;resource_cost:number;damage_bonus:number;protection:number;notes:string;acquired:boolean;equipped:boolean;sort_order:number;version:number };
type Draft = Omit<Item,"id"|"equipped"|"version">;
const empty: Draft = { name:"",category:"equipment",quantity:1,resource_cost:0,damage_bonus:0,protection:0,notes:"",acquired:false,sort_order:0 };

export function CharacterInventoryPanel({ campaignId,canEdit }: { campaignId:string;canEdit:boolean }) {
  const { character } = useCharacterSession();
  const selected = useRef(character?.id); selected.current=character?.id;
  const [items,setItems]=useState<Item[]>([]);
  const [draft,setDraft]=useState<Draft>(empty);
  const [editing,setEditing]=useState<Item|null>(null);
  const [query,setQuery]=useState("");
  const [category,setCategory]=useState("all");
  const [onlyPending,setOnlyPending]=useState(false);
  const [comparison,setComparison]=useState<string[]>([]);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [catalogQuery,setCatalogQuery]=useState("");
  const [catalogCategory,setCatalogCategory]=useState<AtlasEquipmentCategory|"all">("all");
  const [catalogEra,setCatalogEra]=useState<AtlasEra|"all">("all");
  const [catalogDamage,setCatalogDamage]=useState<AtlasDamageKind>("all");
  const [catalogMax,setCatalogMax]=useState(10);
  const [catalogComparison,setCatalogComparison]=useState<string[]>([]);

  useEffect(()=>{
    setItems([]);setEditing(null);setDraft(empty);setComparison([]);setMessage("");
  },[campaignId,character?.id]);

  useEffect(()=>{
    let active=true;
    if(!character) return;
    const id=character.id;
    async function load(){
      try {
        const {data,error}=await createClient().from("character_inventory").select("*").eq("sheet_id",id).eq("campaign_id",campaignId).order("sort_order").order("name");
        if(!active)return;
        if(error)throw error;
        setItems((data??[]) as Item[]);
      }catch{if(active)setMessage("Não foi possível carregar o inventário. Confira a conexão e a migration de inventário.");}
    }
    void load();return()=>{active=false;};
  },[campaignId,character?.id,revision]);

  async function mutate(operation:()=>PromiseLike<{error:unknown;data?:unknown}>,text:string){
    if(!canEdit||!character)return;
    const id=character.id;setBusy(true);setMessage("");
    try{
      const {error,data}=await operation();
      if(error || (Array.isArray(data)&&data.length===0))throw new Error("Conflito ou acesso recusado. Atualize o inventário antes de tentar novamente.");
      if(selected.current!==id)return;
      setRevision(value=>value+1);setMessage(text);
    }catch(error){if(selected.current===id)setMessage(error instanceof Error?error.message:"Não foi possível salvar o inventário.");}
    finally{setBusy(false);}
  }

  function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!character)return;
    const client=createClient();
    const patch={...draft,name:draft.name.trim()};
    void mutate(()=>editing
      ?client.from("character_inventory").update(patch).eq("id",editing.id).eq("sheet_id",character.id).eq("campaign_id",campaignId).eq("version",editing.version).select("id")
      :client.from("character_inventory").insert({...patch,sheet_id:character.id,campaign_id:campaignId}).select("id"),"Item salvo.");
  }

  if(!character)return <section className="content generation-card"><h2>Inventário e lista de compras</h2><p>Selecione uma ficha salva na barra da sessão.</p></section>;
  const filtered=items.filter(item=>(category==="all"||item.category===category)&&(!onlyPending||!item.acquired)&&`${item.name} ${item.notes}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")));
  const resources=typeof character.values.recursos==="number"?character.values.recursos:null;
  const catalog=filterAtlasEquipment(ATLAS_EQUIPMENT,{query:catalogQuery,category:catalogCategory,era:catalogEra,maxResources:catalogMax,damageKind:catalogDamage});

  return <section className="content inventory-layout" aria-busy={busy}>
    <article className="generation-card">
      <p className="eyebrow">PERTENCES DE {character.name.toUpperCase()}</p><h2>Inventário e aquisições</h2>
      <div className="inventory-filters">
        <label>Buscar item<input value={query} maxLength={160} onChange={event=>setQuery(event.target.value)}/></label>
        <label>Categoria<select value={category} onChange={event=>setCategory(event.target.value)}><option value="all">Todas</option>{Object.entries(categories).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label className="inline-check"><input type="checkbox" checked={onlyPending} onChange={event=>setOnlyPending(event.target.checked)}/>Somente aquisições pendentes</label>
      </div>
      <p>{items.filter(item=>item.acquired).length} adquiridos · {items.filter(item=>!item.acquired).length} pendentes.</p>
      <p className="notice">Custo é uma classificação em Recursos, não um saldo em dinheiro. Os valores e perfis são cadastrados pela mesa.</p>
      <button type="button" className="quiet" onClick={()=>setRevision(value=>value+1)} disabled={busy}>Atualizar</button>
      <div className="inventory-items">{filtered.map(item=><article className="inventory-item" key={item.id}>
        <h3>{item.name} {item.equipped&&<small>Equipado</small>}</h3>
        <p>{categories[item.category]} · Quantidade {item.quantity} · Recursos {item.resource_cost} · {item.acquired?"Adquirido":"Pendente"}</p>
        {resources!==null&&item.resource_cost>resources&&<p className="notice">Custo acima de Recursos {resources} da ficha.</p>}
        {item.category==="weapon"&&<p>Bônus de dano: +{item.damage_bonus}.</p>}
        {item.category==="armor"&&<p>Proteção: {item.protection}.</p>}
        <p className="inventory-notes">{item.notes}</p>
        <div className="actions">
          <button className="quiet" type="button" disabled={busy||!canEdit} onClick={()=>{setEditing(item);setDraft({name:item.name,category:item.category,quantity:item.quantity,resource_cost:item.resource_cost,damage_bonus:item.damage_bonus,protection:item.protection,notes:item.notes,acquired:item.acquired,sort_order:item.sort_order});}}>Editar {item.name}</button>
          <button className="quiet" type="button" disabled={busy||!canEdit} onClick={()=>void mutate(()=>createClient().from("character_inventory").delete().eq("id",item.id).eq("sheet_id",character.id).eq("version",item.version).select("id"),"Item removido.")}>Excluir {item.name}</button>
          {item.acquired&&["weapon","armor"].includes(item.category)&&<button className="quiet" type="button" disabled={busy||!canEdit} onClick={()=>void mutate(()=>item.equipped
            ?createClient().from("character_inventory").update({equipped:false}).eq("id",item.id).eq("version",item.version).select("id")
            :createClient().rpc("equip_character_item",{p_item_id:item.id,p_expected_version:item.version}),"Equipamento atualizado.")}>{item.equipped?"Desequipar":"Equipar"}</button>}
          <label className="inline-check"><input type="checkbox" checked={comparison.includes(item.id)} disabled={!comparison.includes(item.id)&&comparison.length===2} onChange={event=>setComparison(value=>event.target.checked?[...value,item.id]:value.filter(id=>id!==item.id))}/>Comparar</label>
        </div>
      </article>)}</div>
      {filtered.length===0&&<p>Nenhum item encontrado.</p>}
      {comparison.length>0&&<div className="inventory-comparison"><h3>Comparação de itens</h3>{items.filter(item=>comparison.includes(item.id)).map(item=><div key={item.id}><b>{item.name}</b><p>Recursos {item.resource_cost} · Dano +{item.damage_bonus} · Proteção {item.protection}</p><p>{item.notes}</p></div>)}</div>}
      <p role="status" aria-live="polite">{message}</p>
    </article>
    <article className="generation-card"><details><summary>Arsenal de referência ({ATLAS_EQUIPMENT.length} itens)</summary>
      <p className="notice">Dados editoriais do RPG Atlas, commit fb34a5b. Revise custo e características com o narrador antes de adquirir.</p>
      <div className="inventory-form">
        <label>Buscar no arsenal<input value={catalogQuery} maxLength={160} onChange={event=>setCatalogQuery(event.target.value)}/></label>
        <label>Categoria<select value={catalogCategory} onChange={event=>setCatalogCategory(event.target.value as AtlasEquipmentCategory|"all")}><option value="all">Todas</option>{Object.entries(categories).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label>Era<select value={catalogEra} onChange={event=>setCatalogEra(event.target.value as AtlasEra|"all")}>{Object.entries({all:"Todas",antiga:"Antiga",medieval:"Medieval","revolucao-industrial":"Revolução Industrial",moderna:"Moderna"}).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label>Tipo de dano<select value={catalogDamage} onChange={event=>setCatalogDamage(event.target.value as AtlasDamageKind)}>{Object.entries({all:"Todos",ballistic:"Balístico",cutting:"Cortante",blunt:"Contundente",incapacitating:"Incapacitante",narrative:"Narrativo"}).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label>Custo máximo em Recursos<input type="number" min={0} max={10} value={catalogMax} onChange={event=>setCatalogMax(Number(event.target.value))}/></label>
      </div>
      {catalog.map(item=><article className="inventory-item" key={item.id}><h3>{item.name}</h3><p>{categories[item.category]} · Recursos {item.resource_cost} · Dano {item.damage_bonus??"sem valor"} · Proteção {item.protection}</p><p>{item.notes}</p>
        {item.animal_profile&&<details><summary>Perfil do animal</summary><p>{item.animal_profile.species} · Força {item.animal_profile.strength} · Destreza {item.animal_profile.dexterity} · Vigor {item.animal_profile.stamina} · Vitalidade {item.animal_profile.health}</p><p>{item.animal_profile.speed} · {item.animal_profile.attack}</p><p>{item.animal_profile.traits.join(", ")}</p></details>}
        <label className="inline-check"><input type="checkbox" checked={catalogComparison.includes(item.id)} disabled={!catalogComparison.includes(item.id)&&catalogComparison.length>=2} onChange={event=>setCatalogComparison(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id))}/>Comparar item de referência</label>
        <button className="quiet" type="button" disabled={!canEdit||busy} onClick={()=>{setEditing(null);setDraft({...empty,name:item.name,category:item.category,resource_cost:item.resource_cost,damage_bonus:item.damage_bonus??0,protection:item.protection,notes:[item.notes,item.animal_profile?JSON.stringify(item.animal_profile,null,2):"",`Fonte: ${item.source}`].filter(Boolean).join("\n")});setMessage("Aquisição preparada. Revise o formulário e salve para incluir na lista.");}}>Preparar aquisição</button>
      </article>)}
      {catalog.length===0&&<p>Nenhum item corresponde aos filtros.</p>}
      {catalogComparison.length>0&&<div className="inventory-comparison"><h3>Comparação do arsenal</h3>{ATLAS_EQUIPMENT.filter(item=>catalogComparison.includes(item.id)).map(item=><div key={item.id}><b>{item.name}</b><p>Recursos {item.resource_cost} · Dano {item.damage_bonus??"sem valor"} · Proteção {item.protection}</p><p>{item.eras.join(", ")||"Moderna"}</p><p>{item.notes}</p></div>)}</div>}
    </details><h2>{editing?"Editar item":"Adicionar item"}</h2>
      <form onSubmit={save} className="inventory-form">
        <label>Nome<input required maxLength={160} value={draft.name} onChange={event=>setDraft({...draft,name:event.target.value})}/></label>
        <label>Categoria<select value={draft.category} onChange={event=>setDraft({...draft,category:event.target.value as Category})}>{Object.entries(categories).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        {([ ["quantity","Quantidade",1,999],["resource_cost","Custo em Recursos",0,10],["damage_bonus","Bônus de dano",0,10],["protection","Proteção",0,10],["sort_order","Ordem na lista",0,9999] ] as const).map(([key,label,min,max])=><label key={key}>{label}<input type="number" required min={min} max={max} value={draft[key]} onChange={event=>setDraft({...draft,[key]:Number(event.target.value)})}/></label>)}
        <label>Descrição, traços ou perfil do animal<textarea rows={5} maxLength={4000} value={draft.notes} onChange={event=>setDraft({...draft,notes:event.target.value})}/></label>
        <label className="inline-check"><input type="checkbox" checked={draft.acquired} onChange={event=>setDraft({...draft,acquired:event.target.checked})}/>Adquirido</label>
        <div className="actions"><button type="submit" className="primary" disabled={busy||!canEdit}>Salvar item</button><button className="quiet" type="button" onClick={()=>{setEditing(null);setDraft(empty);}}>Novo item</button></div>
        {editing?.equipped&&<p className="notice">Desequipe o item antes de alterar sua categoria ou marcá-lo como pendente.</p>}
      </form>
    </article>
  </section>;
}
