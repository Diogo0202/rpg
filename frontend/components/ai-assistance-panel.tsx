"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "../lib/supabase/client";
import { aiStatusLabel, buildPublicationFields, contextBinding, publicationFieldLabel, publicationFields } from "../lib/ai-assistance";
import { fieldOptions, isFieldActive, reconcileDependentValues } from "../lib/sheet-creation";
import { characterNameField, type FieldValue, type SheetTemplate } from "../lib/sheet-template";
import styles from "./ai-assistance-panel.module.css";

type ContextItem = { kind: "session" | "event" | "entity" | "sheet"; id: string; title: string; entity_kind?: string; content?: Record<string, unknown> };
type RequestMeta = { id: string; kind: "sheet" | "session" | "npc"; status: string; version: number; brief: string; target_id?: string | null; template_id?: string | null };
type Detail = { request: RequestMeta; result: Record<string, unknown> | null; template: SheetTemplate | null; original?: Record<string, unknown> | null };
type Preparation = { id: string; kind: "session" | "npc"; title: string; body: Record<string, unknown>; version: number; target_id?: string | null };
type Config = { enabled: boolean; model: string; budget_monthly_usd: number };
type Preview = { context: { items: ContextItem[] }; context_hash: string };
type Operation = { signature: string; id: string } | null;

async function request<T>(campaign: string, suffix: string, body?: unknown): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new Error("A API da campanha não está configurada.");
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error("Entre na campanha para acessar a assistência.");
  const response = await fetch(`${base.replace(/\/$/, "")}/api/v1/campaigns/${encodeURIComponent(campaign)}/ai/${suffix}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message = typeof detail?.detail === "string" ? detail.detail : "Não foi possível concluir o pedido. Seus dados foram preservados.";
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function operation(ref: { current: Operation }, body: unknown) {
  const signature = JSON.stringify(body);
  if (ref.current?.signature !== signature) ref.current = { signature, id: crypto.randomUUID() };
  return ref.current.id;
}

export function AiSheetRequest({ campaignId, templateId, targetId }: { campaignId: string; templateId: string; targetId?: string }) {
  const [brief, setBrief] = useState("");
  const [desired, setDesired] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [items, setItems] = useState<RequestMeta[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const op = useRef<Operation>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const [c, rows] = await Promise.all([request<Config>(campaignId, "config"), request<RequestMeta[]>(campaignId, "proposals")]);
      if (alive.current) { setConfig(c); setItems(rows.filter((item) => item.kind === "sheet")); }
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : "Não foi possível carregar os pedidos."); }
  }, [campaignId]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !config?.enabled || !brief.trim() || !templateId) return;
    const body = { kind: "sheet", brief: `${brief.trim()}${desired.trim() ? `\nCampos desejados: ${desired.trim()}` : ""}`, template_id: templateId, ...(targetId ? { target_id: targetId } : {}), context_refs: [] };
    setBusy(true); setMessage("");
    try {
      const saved = await request<{ request: RequestMeta }>(campaignId, "proposals", { ...body, idempotency_key: operation(op, body) });
      if (saved.request.status === "failed") throw new Error("O pedido anterior está salvo com falha. O narrador pode solicitar um refinamento sem perder seu conceito.");
      if (!alive.current) return;
      setMessage("Pedido enviado. O narrador revisará a proposta antes de aplicar à sua ficha.");
      setBrief(""); setDesired(""); op.current = null; await load();
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : "Não foi possível enviar o pedido."); }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className={styles.card} aria-label="Assistência de ficha">
    <h3>Pedir ajuda à IA</h3><p>Você acompanha o pedido. O resultado completo fica com o narrador até a aprovação.</p>
    {config && !config.enabled && <p className={styles.disabled}>A assistência está desativada. O preenchimento manual continua disponível.</p>}
    <form onSubmit={(event) => void submit(event)}>
      <label>Conceito do personagem<textarea aria-label="Conceito do personagem" rows={3} maxLength={4000} value={brief} onChange={(event) => setBrief(event.target.value)} /></label>
      <label>Campos que deseja desenvolver<input aria-label="Campos que deseja desenvolver" maxLength={1000} value={desired} onChange={(event) => setDesired(event.target.value)} placeholder="Ex.: personalidade, contatos, habilidades" /></label>
      <button disabled={busy || !config?.enabled || !templateId || !brief.trim()}>{busy ? "Enviando…" : "Solicitar proposta"}</button>
    </form>
    {message && <p role="status">{message}</p>}
    <button type="button" className={styles.secondary} disabled={busy} onClick={() => void load()}>Atualizar pedidos</button>
    <ul className={styles.requests}>{items.map((item) => <li key={item.id}><span>{item.brief}</span><strong>{aiStatusLabel(item.status)}</strong></li>)}</ul>
  </section>;
}

function ResultEditor({ detail, value, onChange, contexts }: { detail: Detail; value: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void; contexts: ContextItem[] }) {
  const change = (key: string, next: unknown) => onChange({ ...value, [key]: next });
  const text = (key: string) => String(value[key] ?? "");
  const kind = detail.request.kind;
  return <div className={styles.card}>
    <label>{kind === "session" ? "Título privado" : "Nome"}<input aria-label={kind === "session" ? "Título privado" : "Nome"} maxLength={kind === "sheet" ? 120 : 160} value={text(kind === "session" ? "title" : "name")} onChange={(event) => {
      const nameField = kind === "sheet" && detail.template ? characterNameField(detail.template) : undefined;
      onChange({ ...value, [kind === "session" ? "title" : "name"]: event.target.value, ...(nameField ? { values: { ...(value.values as Record<string, unknown> ?? {}), [nameField.id]: event.target.value } } : {}) });
    }} /></label>
    {kind === "sheet" && detail.template && (() => {
      const template = detail.template;
      const values = (value.values ?? {}) as Record<string, FieldValue>;
      const original = (detail.original?.values ?? {}) as Record<string, unknown>;
      const setField = (id: string, next: FieldValue | undefined) => {
        const updated = { ...values };
        if (next === undefined) delete updated[id]; else updated[id] = next;
        change("values", reconcileDependentValues(template, updated).values);
      };
      return <>{template.fields.filter((field) => field.id !== characterNameField(template)?.id && !["formula", "roll"].includes(field.kind) && isFieldActive(template, field, values)).map((field) => <label key={field.id}>{field.label}{field.required ? " (obrigatório)" : ""}
        {field.kind === "checkbox" ? <input aria-label={field.label} type="checkbox" checked={values[field.id] === true} onChange={(event) => setField(field.id, event.target.checked)} />
          : field.kind === "select" ? <select aria-label={field.label} value={String(values[field.id] ?? "")} onChange={(event) => setField(field.id, event.target.value || undefined)}><option value="">Escolha</option>{fieldOptions(template, field, values).map((option) => <option key={option}>{option}</option>)}</select>
          : field.kind === "number" ? <input aria-label={field.label} type="number" min={-1000000} max={1000000} value={typeof values[field.id] === "number" ? Number(values[field.id]) : ""} onChange={(event) => setField(field.id, event.target.value === "" ? undefined : Number(event.target.value))} />
          : <textarea aria-label={field.label} rows={2} value={Array.isArray(values[field.id]) ? (values[field.id] as string[]).join("\n") : String(values[field.id] ?? "")} onChange={(event) => setField(field.id, field.kind === "collection" ? event.target.value.split("\n").filter(Boolean) : event.target.value)} />}
        {field.kind === "collection" && <small>Um item por linha.</small>}
        {detail.original && <small>Antes: {String(original[field.id] ?? "vazio")}</small>}
      </label>)}<label>Conceito sugerido<textarea rows={3} maxLength={3000} value={text("narrative")} onChange={(event) => change("narrative", event.target.value)} /></label></>;
    })()}
    {kind === "npc" && ["description", "motivation", "voice", "secret", "hook"].map((key) => <label key={key}>{key === "secret" ? "Segredo privado" : publicationFieldLabel(key)}<textarea aria-label={key === "secret" ? "Segredo privado" : publicationFieldLabel(key)} rows={3} value={text(key)} onChange={(event) => change(key, event.target.value)} /></label>)}
    {kind === "session" && <><label>Resumo privado<textarea rows={4} value={text("summary")} onChange={(event) => change("summary", event.target.value)} /></label>
      {(Array.isArray(value.scenes) ? value.scenes as Record<string, unknown>[] : []).map((scene, index, scenes) => <fieldset className={styles.context} key={index}><legend>Cena {index + 1}</legend>{["title", "description", "clues", "conflicts", "consequences"].map((key) => <label key={key}>{({ title: "Título", description: "Descrição", clues: "Pistas", conflicts: "Conflitos", consequences: "Consequências" } as Record<string, string>)[key]}<textarea rows={2} value={Array.isArray(scene[key]) ? (scene[key] as string[]).join("\n") : String(scene[key] ?? "")} onChange={(event) => change("scenes", scenes.map((item, position) => position === index ? { ...item, [key]: ["clues", "conflicts", "consequences"].includes(key) ? event.target.value.split("\n").filter(Boolean) : event.target.value } : item))} /></label>)}</fieldset>)}
    </>}
    {kind === "npc" && <fieldset className={styles.context}><legend>Relações sugeridas</legend>
      {(Array.isArray(value.relationships) ? value.relationships as Record<string, string>[] : []).map((relation, index, rows) => {
        const edit = (key: string, next: string) => change("relationships", rows.map((row, position) => position === index ? { ...row, [key]: next } : row));
        return <div className={styles.card} key={index}><label>Destino<select aria-label={`Destino da relação ${index + 1}`} value={relation.target_id} onChange={(event) => edit("target_id", event.target.value)}><option value="">Escolha um registro</option>{contexts.filter((item) => item.kind === "entity" && item.id !== detail.request.target_id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label>Vínculo<input aria-label={`Vínculo ${index + 1}`} maxLength={80} value={relation.relation_type} onChange={(event) => edit("relation_type", event.target.value)} /></label>
          <label>Notas da relação<textarea aria-label={`Notas da relação ${index + 1}`} maxLength={1000} value={relation.notes} onChange={(event) => edit("notes", event.target.value)} /></label>
          <button type="button" className={styles.secondary} onClick={() => change("relationships", rows.filter((_, position) => position !== index))}>Remover relação</button>
        </div>;
      })}
      <button type="button" className={styles.secondary} disabled={Array.isArray(value.relationships) && value.relationships.length >= 20} onClick={() => change("relationships", [...(Array.isArray(value.relationships) ? value.relationships : []), { target_id: "", relation_type: "", notes: "" }])}>Adicionar relação</button>
    </fieldset>}
    {Array.isArray(value.questions) && value.questions.length > 0 && <div><strong>Perguntas para revisão</strong><ul>{(value.questions as string[]).map((question, index) => <li key={index}>{question}</li>)}</ul></div>}
  </div>;
}

export function AiAssistancePanel({ campaignId, canManage }: { campaignId: string; viewerId: string; canManage: boolean }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [contexts, setContexts] = useState<ContextItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [proposals, setProposals] = useState<RequestMeta[]>([]);
  const [preparations, setPreparations] = useState<Preparation[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [result, setResult] = useState<Record<string, unknown>>({});
  const [kind, setKind] = useState<"session" | "npc">("session");
  const [brief, setBrief] = useState("");
  const [instruction, setInstruction] = useState("");
  const [target, setTarget] = useState("");
  const [publishSelected, setPublishSelected] = useState<Record<string, string[]>>({});
  const [publishDrafts, setPublishDrafts] = useState<Record<string, Record<string, string>>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const op = useRef<Operation>(null);
  const refineOp = useRef<Operation>(null);
  const refresh = useCallback(async () => {
    const [c, rows, prep, sources] = await Promise.all([
      request<Config>(campaignId, "config"), request<RequestMeta[]>(campaignId, "proposals"),
      canManage ? request<Preparation[]>(campaignId, "preparations") : Promise.resolve([]),
      canManage ? request<{ items: ContextItem[] }>(campaignId, "context") : Promise.resolve({ items: [] }),
    ]);
    setConfig(c); setProposals(rows); setPreparations(prep); setContexts(sources.items);
  }, [campaignId, canManage]);
  useEffect(() => { let active = true; void refresh().catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Não foi possível carregar a assistência."); }); return () => { active = false; }; }, [refresh]);
  const refs = selected.map((entry) => { const [refKind, id] = entry.split(":"); return { kind: refKind, id }; });
  const targets = contexts.filter((item) => kind === "npc" ? item.kind === "entity" && item.entity_kind === "npc" : item.kind === "session");
  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await run(); } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível concluir. Seus dados foram preservados."); }
    finally { setBusy(false); }
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!config?.enabled || !brief.trim()) return;
    await action(async () => {
      const body = { kind, brief: brief.trim(), ...(target ? { target_id: target } : {}), ...contextBinding(refs, preview?.context_hash) };
      const saved = await request<{ request: RequestMeta }>(campaignId, "proposals", { ...body, idempotency_key: operation(op, body) });
      if (saved.request.status === "failed") throw new Error("A geração anterior falhou. Abra o pedido salvo para solicitar um novo refinamento.");
      setBrief(""); setPreview(null); setSelected([]); setTarget(""); op.current = null;
      await refresh(); setMessage("Proposta criada para revisão privada.");
    });
  }
  async function open(id: string) {
    await action(async () => {
      const data = await request<Detail>(campaignId, `proposals/${encodeURIComponent(id)}`);
      setDetail(data); setResult(data.result ?? {}); setInstruction(""); refineOp.current = null;
    });
  }
  async function review(approve: boolean) {
    if (!detail) return;
    await action(async () => {
      await request(campaignId, `proposals/${detail.request.id}/${approve ? "approve" : "reject"}`, { expected_version: detail.request.version, ...(approve ? { result } : {}) });
      setDetail(null); await refresh(); setMessage(approve ? "Proposta aprovada. Preparações narrativas continuam privadas até a publicação." : "Pedido recusado.");
    });
  }
  async function refine() {
    if (!detail || !instruction.trim() || !config?.enabled) return;
    await action(async () => {
      const body = { expected_version: detail.request.version, instruction: instruction.trim(), ...(Object.keys(result).length ? { result } : {}), ...contextBinding(refs, preview?.context_hash) };
      const saved = await request<{ request: RequestMeta }>(campaignId, `proposals/${detail.request.id}/refine`, { ...body, idempotency_key: operation(refineOp, body) });
      if (saved.request.status === "failed") throw new Error("Este refinamento falhou. Seus dados foram preservados; atualize a proposta antes de uma nova tentativa.");
      setDetail(null); setInstruction(""); refineOp.current = null; await refresh(); setMessage("Refinamento pronto para revisão.");
    });
  }
  async function publish(item: Preparation) {
    await action(async () => {
      const fields = buildPublicationFields(item.kind, publishSelected[item.id] ?? [], publishDrafts[item.id] ?? {}, !item.target_id);
      await request(campaignId, `preparations/${item.id}/publish`, { expected_version: item.version, fields });
      setPublishSelected((current) => ({ ...current, [item.id]: [] })); await refresh(); setMessage("Somente os campos selecionados foram publicados.");
    });
  }
  return <section className={styles.panel} aria-labelledby="ai-panel-title">
    <header><p className={styles.eyebrow}>ASSISTENTE DE CAMPANHA</p><h2 id="ai-panel-title">Assistente IA</h2><p>Propostas revisadas pelo narrador. Segredos permanecem na preparação privada.</p></header>
    {config && <p className={config.enabled ? styles.enabled : styles.disabled}>{config.enabled ? `Ativo · ${config.model} · teto do projeto: US$ ${config.budget_monthly_usd}/mês` : "A assistência está desativada. As ferramentas manuais continuam disponíveis."}</p>}
    <button type="button" className="quiet" disabled={busy} onClick={() => void action(refresh)}>Atualizar assistência</button>
    {message && <p role="status" className={styles.message}>{message}</p>}
    {canManage && <section className={styles.card}><h3>Preparar conteúdo</h3><form onSubmit={(event) => void generate(event)}>
      <label>Tipo<select aria-label="Tipo" value={kind} onChange={(event) => { setKind(event.target.value as "session" | "npc"); setTarget(""); setSelected([]); setPreview(null); }}><option value="session">Próxima sessão</option><option value="npc">Personalidade e vínculos de NPC</option></select></label>
      <label>Destino<select aria-label="Destino" value={target} onChange={(event) => {
        const id = event.target.value; const refKind = kind === "npc" ? "entity" : "session";
        setTarget(id); setSelected(id ? [`${refKind}:${id}`] : []); setPreview(null);
      }}><option value="">Nova preparação</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>O que deseja desenvolver?<textarea rows={4} maxLength={6000} value={brief} onChange={(event) => setBrief(event.target.value)} /></label>
      <fieldset className={styles.context}><legend>Contexto selecionado ({selected.length}/12)</legend><p>Escolha os registros e confira a prévia antes do envio.</p>{contexts.map((item) => {
        const key = `${item.kind}:${item.id}`; const checked = selected.includes(key);
        return <label key={key}><input type="checkbox" checked={checked} disabled={(selected.length >= 12 && !checked) || (item.id === target && checked)} onChange={(event) => { setSelected((current) => event.target.checked ? [...current, key] : current.filter((value) => value !== key)); setPreview(null); }} />{item.title} ({item.kind})</label>;
      })}</fieldset>
      <button type="button" className={styles.secondary} disabled={busy || !refs.length} onClick={() => void action(async () => { setPreview(await request<Preview>(campaignId, "context/preview", { context_refs: refs })); })}>Conferir contexto que será enviado</button>
      {preview && <details className={styles.preview} open><summary>Conteúdo exato dos registros selecionados</summary>{preview.context.items.map((item) => <details key={`${item.kind}:${item.id}`}><summary>{item.title}</summary><pre>{JSON.stringify(item.content, null, 2)}</pre></details>)}</details>}
      <button disabled={busy || !config?.enabled || !brief.trim() || (refs.length > 0 && !preview)}>Gerar proposta privada</button>
    </form></section>}
    <section className={styles.card}><h3>{canManage ? "Pedidos para revisão" : "Meus pedidos"}</h3><ul className={styles.requests}>{proposals.map((item) => <li key={item.id}>{canManage ? <button type="button" className={styles.link} disabled={busy} onClick={() => void open(item.id)}>{item.brief}</button> : <span>{item.brief}</span>}<strong>{aiStatusLabel(item.status)}</strong></li>)}</ul>{!proposals.length && <p>Nenhum pedido nesta campanha.</p>}</section>
    {canManage && detail && <section className={styles.card}><h3>Revisão da proposta</h3><p>{detail.request.brief}</p>
      {detail.result && <ResultEditor detail={detail} value={result} onChange={setResult} contexts={contexts} />}
      <div className={styles.row}><button disabled={busy || detail.request.status !== "pending"} onClick={() => void review(true)}>Aprovar e aplicar</button><button className={styles.danger} disabled={busy || detail.request.status !== "pending"} onClick={() => void review(false)}>Recusar</button></div>
      <label>Como a proposta deve melhorar?<textarea rows={3} maxLength={6000} value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
      <button className={styles.secondary} disabled={busy || !config?.enabled || !["pending", "failed"].includes(detail.request.status) || !instruction.trim() || (refs.length > 0 && !preview)} onClick={() => void refine()}>Gerar refinamento para revisão</button>
    </section>}
    {canManage && <section className={styles.card}><h3>Preparações privadas</h3>{preparations.map((item) => <article className={styles.preparation} key={item.id}>
      <h4>{item.title}</h4><details><summary>Ver preparação completa, incluindo segredos</summary><pre>{JSON.stringify(item.body, null, 2)}</pre></details>
      <p>Marque somente os campos que os jogadores poderão ler.</p>
      {publicationFields[item.kind].map((field) => {
        const selectedFields = publishSelected[item.id] ?? [];
        const initial = field === "relationships" ? JSON.stringify(item.body[field] ?? []) : String(item.body[field] ?? (["title", "name"].includes(field) ? item.title : ""));
        const value = publishDrafts[item.id]?.[field] ?? initial;
        return <fieldset className={styles.context} key={field}><label><input type="checkbox" checked={selectedFields.includes(field)} onChange={(event) => {
          setPublishSelected((current) => ({ ...current, [item.id]: event.target.checked ? [...(current[item.id] ?? []), field] : (current[item.id] ?? []).filter((key) => key !== field) }));
          setPublishDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], [field]: value } }));
        }} />Publicar {publicationFieldLabel(field)}</label>
          {field === "relationships" ? <ul>{(Array.isArray(item.body.relationships) ? item.body.relationships as Record<string, unknown>[] : []).map((relation, index) => <li key={index}>{String(relation.relation_type)}: {contexts.find((source) => source.id === relation.target_id)?.title ?? String(relation.target_id)}. {String(relation.notes ?? "")}</li>)}</ul>
            : <textarea rows={2} value={value} onChange={(event) => setPublishDrafts((current) => ({ ...current, [item.id]: { ...current[item.id], [field]: event.target.value } }))} />}
        </fieldset>;
      })}
      <button disabled={busy || !(publishSelected[item.id]?.length)} onClick={() => void publish(item)}>Publicar campos selecionados</button>
    </article>)}{!preparations.length && <p>Nenhuma preparação aprovada.</p>}</section>}
  </section>;
}
