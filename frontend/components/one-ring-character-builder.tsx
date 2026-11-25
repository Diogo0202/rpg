"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { evaluateOneRing, reconcileOneRing, ringBase, ringCulture, ringCalling, RING_CATALOG as C, type RingValue, type RingValues } from "../../shared/one-ring/creation.ts";
import { oneRingReminders } from "../../shared/one-ring/reminders.ts";
import { loadRingDraft, saveRingDraft, removeRingDraft, type RingDraft } from "../../shared/one-ring/drafts.ts";
import styles from "./one-ring-character-builder.module.css";

export type OneRingCharacterBuilderProps = {
  accountId: string; campaignId: string; templateId: string; initialValues?: RingValues;
  renderPortrait?: (name: string) => ReactNode;
  onSave: (values: RingValues) => void | Promise<void>; busy?: boolean; canSave?: boolean; title?: string; saveMode?: "server"|"queued"|"local";
};
const list = (value: unknown): string[] => Array.isArray(value) ? value : [];
const label = (id: string) => C.skills.find((s) => s.id === id)?.label ?? C.proficiencies.find((s) => s.id === id)?.label ?? ({corpo:"Força",coracao:"Coração",astucia:"Astúcia"} as Record<string,string>)[id] ?? id;
const fresh = (initial?: RingValues): RingValues => ({ anel_armadura: "none", anel_escudo: "none", anel_armas: [], anel_elmo: false, anel_itens_uteis: [], ...initial });

/** Both clients render this page with the same evaluator and catalog. */
export function OneRingCharacterBuilder(props:OneRingCharacterBuilderProps){return <CharacterBuilderSession key={JSON.stringify([props.accountId,props.campaignId,props.templateId])} {...props}/>;}
function CharacterBuilderSession({ accountId, campaignId, templateId, initialValues, onSave, renderPortrait, busy = false, canSave = true, title = "Crie seu herói", saveMode = "server" }: OneRingCharacterBuilderProps) {
  const prefix = useId();
  const [values, setValues] = useState<RingValues>(() => fresh(initialValues));
  const [draft, setDraft] = useState<RingDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [storage, setStorage] = useState("Carregando rascunho local…");
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [usefulSkill, setUsefulSkill] = useState(C.skills[0].id);
  const [usefulName, setUsefulName] = useState("");
  const touched = useRef(new Set<string>()), revision = useRef(0), storageQueue = useRef(Promise.resolve());
  const report = useMemo(() => evaluateOneRing(values), [values]);
  const culture = ringCulture(values), calling = ringCalling(values), base = ringBase(values);
  const lock = busy || saving;
  useEffect(() => {
    let cancelled = false;
    loadRingDraft(accountId,campaignId,templateId).then((saved) => {
      if (!cancelled) { setDraft(saved); setStorage(saved ? "Há um rascunho deste modelo neste aparelho." : "Rascunho apenas neste aparelho, ainda não confirmado pelo servidor."); setReady(true); }
    }).catch(() => { if (!cancelled) { setStorage("Armazenamento local indisponível. Mantenha esta página aberta."); setReady(true); } });
    return () => { cancelled = true; };
  }, [accountId,campaignId,templateId]);
  useEffect(() => {
    if (!ready || draft) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      storageQueue.current = storageQueue.current.catch(() => {}).then(async () => {
        await saveRingDraft({accountId,campaignId,templateId,values,updatedAt:new Date().toISOString()});
        if (!cancelled) setStorage("Rascunho salvo neste aparelho. Ainda não é uma ficha ativa.");
      }).catch(() => { if (!cancelled) setStorage("Não foi possível guardar o rascunho neste aparelho."); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accountId,campaignId,templateId,values,ready,draft]);
  function change(id: string, value: RingValue) {
    touched.current.add(id); revision.current++;setStorage("Alterações locais aguardam gravação neste aparelho…");
    setValues((old) => reconcileOneRing(old,{...old,[id]:value})); setFeedback("");
  }
  function errors(id: string) { return report.errors.filter((e) => e.field === id && (submitted || touched.current.has(id))).map((e) => e.message); }
  function fieldError(id: string) { const messages = errors(id); return messages.length ? <span id={`${prefix}-${id}-error`} className={styles.error} role="alert">{messages.join(" ")}</span> : null; }
  function select(id: string, name: string, options: Array<{id:string;name:string}>) {
    const chosen = String(values[id] ?? "");
    return <label className={styles.field} htmlFor={`${prefix}-${id}`}><span>{name}</span><select aria-label={name} id={`${prefix}-${id}`} value={chosen} aria-invalid={errors(id).length > 0} aria-describedby={errors(id).length ? `${prefix}-${id}-error` : undefined} onChange={(e) => change(id,e.target.value)}>
      <option value="">Escolha…</option>{chosen && !options.some((x)=>x.id===chosen) ? <option value={chosen}>{chosen} (rever escolha)</option> : null}{options.map((x)=><option key={x.id} value={x.id}>{x.name}</option>)}
    </select>{fieldError(id)}</label>;
  }
  function picks(id: string, name: string, options: Array<{id:string;name:string}>, count?: number) {
    const chosen = list(values[id]), stale = chosen.filter((x)=>!options.some((o)=>o.id===x));
    return <fieldset className={styles.picks}><legend>{name}{count ? ` (${chosen.length}/${count})` : ""}</legend><div className={styles.choices}>{[...options,...stale.map((id)=>({id,name:`${label(id)} (rever escolha)`}))].map((item)=><label key={item.id}><input type="checkbox" checked={chosen.includes(item.id)} onChange={(e)=>change(id,e.target.checked ? [...chosen,item.id] : chosen.filter((x)=>x!==item.id))} />{item.name}</label>)}</div>{fieldError(id)}</fieldset>;
  }
  async function submit() {
    setSubmitted(true); setFeedback("");
    if (report.errors.length) { document.getElementById(`${prefix}-${report.errors[0].field}`)?.focus(); document.getElementById(`${prefix}-review`)?.scrollIntoView({block:"center"}); return; }
    if (!canSave || !ready || draft || lock) return;
    const current = revision.current; setSaving(true);
    try {
      await onSave(report.values);
      if (current === revision.current) { await storageQueue.current; try {await removeRingDraft(accountId,campaignId,templateId);setStorage(saveMode==="server" ? "Ficha confirmada. Rascunho local removido." : "Ficha guardada neste aparelho; confira a confirmação na sincronização.");}catch{setStorage("Ficha guardada. Não foi possível remover o rascunho local anterior.");} setFeedback(saveMode==="server" ? "Ficha criada com inventário inicial." : "Ficha local guardada com as escolhas iniciais."); }
    } catch(error) { setFeedback(error instanceof Error ? error.message : "Não foi possível confirmar a criação. Seu rascunho continua neste aparelho."); }
    finally { setSaving(false); }
  }
  const equipped = report.inventory.filter((i)=>i.custom_values.catalog_id !== "useful");
  const virtue = C.virtues.find((x)=>x.id===values.anel_virtude), reward = C.rewards.find((x)=>x.id===values.anel_recompensa);
  const eligibleTargets = equipped.filter((i)=>!reward || reward.targets.includes(i.category === "weapon" ? "weapon" : i.custom_values.catalog_id === "helmet" ? "helmet" : C.shields.some((s)=>s.id===i.custom_values.catalog_id) ? "shield" : "armor"));
  return <section className={styles.builder} aria-label="Construtor de O Um Anel v3">
    <header><p className={styles.eyebrow}>O UM ANEL · 2ª EDIÇÃO · PERFIL V3</p><h2>{title}</h2><p>Preencha a ficha inteira nesta página. O servidor confere as escolhas antes de ativar o herói.</p><p role="status" className={styles.local}>{storage}</p></header>
    {draft ? <aside className={styles.draft}><h3>Rascunho encontrado</h3><p>{new Date(draft.updatedAt).toLocaleString("pt-BR")}. As escolhas incompletas também ficam guardadas.</p><button type="button" onClick={()=>{setValues(fresh(draft.values));setDraft(null);}}>Restaurar rascunho</button><button type="button" onClick={async()=>{try{await removeRingDraft(accountId,campaignId,templateId);setDraft(null);}catch{setStorage("Falha ao descartar o rascunho.");}}}>Descartar rascunho anterior</button></aside> : null}
    <nav className={styles.sections} aria-label="Seções do herói">{[["identity","Identidade"],["culture","Cultura"],["attributes","Atributos"],["calling","Chamado"],["skills","Perícias"],["equipment","Equipamento"],["virtue","Virtude"],["review","Revisão"]].map(([id,name])=><a key={id} href={`#${prefix}-${id}`}>{name}</a>)}</nav>
    <fieldset disabled={lock || !ready || !!draft} className={styles.body}>
      <section id={`${prefix}-identity`}><h3>Identidade</h3><div className={styles.grid}><label className={styles.field}>Nome<input id={`${prefix}-nome`} value={String(values.nome ?? "")} maxLength={120} aria-invalid={errors("nome").length>0} onChange={(e)=>change("nome",e.target.value)} />{fieldError("nome")}</label><label className={styles.field}>Idade<input id={`${prefix}-idade`} type="number" min={1} max={10000} value={typeof values.idade === "number" ? values.idade : ""} aria-invalid={errors("idade").length>0} onChange={(e)=>change("idade",e.target.value === "" ? "" : Number(e.target.value))} />{fieldError("idade")}</label><label className={styles.field}>Conceito<input maxLength={160} value={String(values.conceito ?? "")} onChange={(e)=>change("conceito",e.target.value)} /></label></div>{renderPortrait?.(String(values.nome ?? ""))}</section>
      <section id={`${prefix}-culture`}><h3>Cultura</h3>{select("linhagem","Cultura heroica",C.cultures.map((x)=>({id:x.name,name:x.name})))}{culture ? <><p>Página {culture.page}. Bênção: <strong>{culture.blessing}</strong>. Padrão de vida: {culture.living}. Idiomas: {culture.languages.join(", ")}.</p>{select("anel_favorecida_cultura","Perícia favorecida da cultura",culture.favoured.map((id)=>({id,name:label(id)})))}{picks("tracos_distintivos","Características notáveis",culture.traits.map((id)=>({id,name:id})),2)}</> : <p>Escolha a cultura para abrir suas opções.</p>}</section>
      <section id={`${prefix}-attributes`}><h3>Atributos</h3>{select("anel_atributos","Conjunto cultural",(culture?.attributes ?? []).map((a,i)=>({id:String(i+1),name:`${i+1}: Força ${a[0]}, Coração ${a[1]}, Astúcia ${a[2]}`})))}{culture?.attribute_bonus ? select("anel_bonus_atributo","Reis dos Homens: atributo com +1",C.attributes.map((id)=>({id,name:label(id)}))) : null}<dl className={styles.stats}>{C.attributes.map((id)=><div key={id}><dt>{label(id)}</dt><dd>{String(report.values[id] ?? "?")} <small>NA {report.derived[`tn_${id}`]}</small></dd></div>)}</dl><p className={styles.hint}>O identificador legado corpo representa Força. Resistência usa vigor_marcha; Bloqueio usa aparar.</p></section>
      <section id={`${prefix}-calling`}><h3>Chamado</h3>{select("vocacao","Chamado",C.callings.map((x)=>({id:x.name,name:x.name})))}{calling ? <><p>Página {calling.page}. Traço: {calling.trait}. Caminho da Sombra: {calling.shadow}.</p>{picks("anel_favorecidas_chamado","Perícias favorecidas do Chamado",calling.favoured.map((id)=>({id,name:label(id)})),2)}{calling.enemy_choice ? select("anel_inimigo","Conhecimento sobre Inimigos",C.enemies.map((id)=>({id,name:id}))) : null}</> : null}</section>
      <section id={`${prefix}-skills`}><h3>Perícias e Experiência Anterior</h3><p className={styles.budget} role="status">{report.spent} / {C.previous_experience} pontos gastos · {report.remaining} disponíveis</p><p>O custo soma cada nível adquirido. Perícias: 1, 2, 3, 5 pontos. Combate: 2, 4, 6. Estes pontos ficam separados da experiência de jogo.</p>{fieldError("experiencia_anterior")}<div className={styles.grid}>{C.attributes.map((attr)=><fieldset className={styles.picks} key={attr}><legend>{label(attr)}</legend>{C.skills.filter((x)=>x.attribute===attr).map((skill)=><label className={styles.rank} key={skill.id} htmlFor={`${prefix}-${skill.id}`}><span>{skill.label}{list(report.values.pericias_favorecidas).includes(skill.legacy_label) ? " ★" : ""}<small>Base {base[skill.id]}</small></span><input id={`${prefix}-${skill.id}`} type="number" min={base[skill.id]} max={4} value={typeof values[skill.id] === "number" ? Number(values[skill.id]) : base[skill.id]} onChange={(e)=>change(skill.id,Number(e.target.value))} />{fieldError(skill.id)}</label>)}</fieldset>)}</div><div className={styles.grid}>{select("anel_combate_principal","Proficiência cultural (2)",(culture?.combat ?? []).map((id)=>({id,name:label(id)})))}{select("anel_combate_secundario","Outra proficiência (1)",C.proficiencies.filter((x)=>x.id!==values.anel_combate_principal).map((x)=>({id:x.id,name:x.label})))}</div><div className={styles.grid}>{C.proficiencies.map((x)=><label className={styles.rank} key={x.id}>{x.label}<input id={`${prefix}-${x.id}`} type="number" min={base[x.id]} max={3} value={typeof values[x.id] === "number" ? Number(values[x.id]) : base[x.id]} onChange={(e)=>change(x.id,Number(e.target.value))} />{fieldError(x.id)}</label>)}</div></section>
      <section id={`${prefix}-equipment`}><h3>Equipamento</h3><p>Páginas 47 a 50 e 100. As escolhas precisam respeitar a cultura, a proficiência e o padrão de vida.</p>{picks("anel_armas","Armas iniciais",C.weapons.map((x)=>({id:x.id,name:`${x.name} · carga ${x.load}`})))}<div className={styles.grid}>{select("anel_armadura","Armadura",C.armor.map((x)=>({id:x.id,name:`${x.name} · ${x.protection}d · carga ${x.load}`})))}{select("anel_escudo","Escudo",C.shields.map((x)=>({id:x.id,name:`${x.name} · Bloqueio +${x.parry} · carga ${x.load}`})))}</div><label className={styles.check}><input type="checkbox" checked={values.anel_elmo===true} onChange={(e)=>change("anel_elmo",e.target.checked)} />Elmo (+1d de proteção, carga {C.helmet.load})</label><fieldset className={styles.picks}><legend>Itens úteis ({list(values.anel_itens_uteis).length}/{C.living.find((x)=>x.name===culture?.living)?.useful_items ?? 0})</legend><div className={styles.grid}><label className={styles.field}>Perícia associada<select value={usefulSkill} onChange={(e)=>setUsefulSkill(e.target.value)}>{C.skills.map((x)=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label><label className={styles.field}>Descrição<input value={usefulName} maxLength={250} onChange={(e)=>setUsefulName(e.target.value)} /></label></div><button type="button" disabled={!usefulName.trim()} onClick={()=>{change("anel_itens_uteis",[...list(values.anel_itens_uteis),`${usefulSkill}: ${usefulName.trim()}`]);setUsefulName("");}}>Adicionar item útil</button><ul>{list(values.anel_itens_uteis).map((item,i)=><li key={`${i}-${item}`}>{item}<button type="button" aria-label={`Remover ${item}`} onClick={()=>change("anel_itens_uteis",list(values.anel_itens_uteis).filter((_,at)=>at!==i))}>Remover</button></li>)}</ul>{fieldError("anel_itens_uteis")}</fieldset></section>
      <section id={`${prefix}-virtue`}><h3>Virtude e Recompensa</h3><p>Valor 1 · Sabedoria 1. Referências: páginas 79 e 80, descrições detalhadas.</p>{select("anel_virtude","Virtude inicial",C.virtues.map((x)=>({id:x.id,name:x.name})))}{values.anel_virtude==="aptitude" ? select("anel_dom_atributo","Dom: atributo com NA reduzido",C.attributes.map((id)=>({id,name:label(id)}))) : null}{values.anel_virtude==="mastery" ? picks("anel_maestria","Maestria: mais duas favorecidas",C.skills.map((x)=>({id:x.id,name:x.label})),2) : null}{virtue ? <p>{virtue.name}: {({endurance:"+2 de Resistência máxima",hope:"+2 de Esperança máxima",parry:"+1 de Bloqueio",attribute_tn:"redução de NA do atributo escolhido",favoured:"duas novas perícias favorecidas",special_damage:"lembrete condicional nos golpes pesados e perfurantes"} as Record<string,string>)[virtue.effect] ?? "Consulte o efeito no contexto da rolagem."}</p> : null}{select("anel_recompensa","Recompensa inicial",C.rewards.map((x)=>({id:x.id,name:x.name})))}{select("anel_recompensa_alvo","Item que recebe a Recompensa",eligibleTargets.map((x)=>({id:String(x.custom_values.catalog_id),name:x.name})))}{reward?.id==="keen" ? <p className={styles.hint}>Afiada: lembrete para o resultado perfurante da arma, sem aumentar o dano comum.</p> : null}{values.anel_virtude==="powerful_hands" ? <p className={styles.hint}>Mãos Inclementes: aplique o efeito apenas nas opções especiais de combate previstas na página 80.</p> : null}</section>
      <section id={`${prefix}-review`} tabIndex={-1}><h3>Revisão da ficha</h3><dl className={styles.stats}>{[["Resistência",report.derived.vigor_max],["Esperança",report.derived.esperanca_max],["Bloqueio",report.derived.aparar],["Carga",report.derived.carga_total],["Proteção",`${report.values.armadura ?? 0}d + ${report.values.bonus_protecao ?? 0}`]].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><ul>{report.inventory.map((item,i)=><li key={`${i}-${item.name}`}>{item.name}: carga {item.custom_values.carga}, proteção {item.protection}d{item.damage_bonus ? `, dano ${item.damage_bonus}` : ""}{item.custom_values.recompensa ? `, ${C.rewards.find((r)=>r.id===item.custom_values.recompensa)?.name}` : ""}</li>)}</ul><label className={styles.field}>Notas<textarea rows={4} maxLength={10000} value={String(values.notas ?? "")} onChange={(e)=>change("notas",e.target.value)} /></label>{report.errors.length ? <div className={styles.error} aria-live="polite"><h4>{report.errors.length} decisões pendentes</h4>{submitted ? <ul>{report.errors.map((e,i)=><li key={`${e.field}-${i}`}><a href={`#${prefix}-${e.field}`} onClick={()=>document.getElementById(`${prefix}-${e.field}`)?.focus()}>{e.message}</a></li>)}</ul> : <p>As pendências aparecem junto aos campos após a edição e na revisão ao criar.</p>}</div> : <p>Escolhas válidas. {report.remaining} pontos de Experiência Anterior ainda disponíveis.</p>}<ul aria-label="Lembretes condicionais">{oneRingReminders(report.values).map((note)=><li key={note.id}>{note.text} (p. {note.page})</li>)}</ul><p>O Foco de Sociedade poderá ser escolhido na Companhia após a criação.</p><button type="button" className={styles.primary} disabled={!canSave || !ready || !!draft || lock} onClick={()=>void submit()}>{lock ? "Conferindo ficha…" : "Criar ficha e inventário"}</button>{!canSave ? <p>O rascunho continua disponível offline. A ativação exige conexão e um modelo aprovado pelo narrador.</p> : null}{feedback ? <p role="status">{feedback}</p> : null}</section>
    </fieldset>
  </section>;
}
