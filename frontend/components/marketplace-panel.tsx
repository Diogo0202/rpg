"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { MarketplaceCard } from "../lib/marketplace-public";
import { MarketplaceModerationPanel } from "./marketplace-moderation-panel";
import { MarketplaceCopyrightReport } from "./marketplace-copyright-report";
import styles from "./marketplace-panel.module.css";

type Campaign = { id: string; name: string };
type PublishableTemplate = { id: string; campaign_id: string; campaign_name: string; name: string; version: number };
type TemplateDraft = Record<string, unknown> & { name: string; version: number; fields: unknown[] };
type PublishPayload = { template: TemplateDraft; description: string; tags: string[]; author_name: string; dependencies: string[]; rights_confirmed: true };
type TemplatePreview = { template: TemplateDraft; digest: string };

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const emptyDraft = JSON.stringify({
  name: "Novo modelo",
  version: 1,
  fields: [{ id: "nome", label: "Nome", kind: "text", required: true }],
}, null, 2);

function asCards(value: unknown): MarketplaceCard[] {
  if (Array.isArray(value)) return value as MarketplaceCard[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) return (value as { items: MarketplaceCard[] }).items;
  return [];
}

async function decode(response: Response): Promise<unknown> {
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error("A API enviou uma resposta que não pôde ser lida."); }
  if (!response.ok) {
    const detail = data && typeof data === "object" && typeof (data as { detail?: unknown }).detail === "string"
      ? String((data as { detail: string }).detail).slice(0, 300) : "Tente novamente em instantes.";
    throw new Error(`${response.status === 403 ? "Ação não permitida." : "Não foi possível concluir."} ${detail}`);
  }
  return data;
}

function tagList(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

export function MarketplacePanel({ initialItems, initialError }: { initialItems: MarketplaceCard[]; initialError: string | null }) {
  const [items, setItems] = useState<MarketplaceCard[]>(initialItems);
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(initialError ?? "");
  const [selected, setSelected] = useState<MarketplaceCard | null>(null);
  const [detailTemplate, setDetailTemplate] = useState<TemplateDraft | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [publishableTemplates, setPublishableTemplates] = useState<PublishableTemplate[]>([]);
  const [sourceTemplateId, setSourceTemplateId] = useState("");
  const [sourcePreview, setSourcePreview] = useState<TemplatePreview | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [cloneDestination, setCloneDestination] = useState("");
  const [hiddenReports, setHiddenReports] = useState<string[]>([]);
  const [showPublish, setShowPublish] = useState(false);
  const [draftJson, setDraftJson] = useState(emptyDraft);
  const [description, setDescription] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [author, setAuthor] = useState("");
  const [dependencies, setDependencies] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [reportReason, setReportReason] = useState<Record<string, string>>({});

  const headers = useMemo(() => token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : null, [token]);

  const loadItems = useCallback(async (search: string, tagFilter: string) => {
    setLoading(true); setMessage("");
    try {
      if (!API) throw new Error("A API pública não está configurada nesta instalação.");
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      const parsedTags = tagList(tagFilter);
      parsedTags.forEach((tag) => params.append("tags", tag));
      const response = await fetch(`${API}/api/v1/marketplace/systems${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      setItems(asCards(await decode(response)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar os modelos.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    try {
      const auth = createClient().auth;
      void auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
      const { data } = auth.onAuthStateChange((_event, session) => setToken(session?.access_token ?? null));
      return () => data.subscription.unsubscribe();
    } catch { setToken(null); }
  }, []);
  useEffect(() => {
    if (!token || !API) { setCampaigns([]); setPublishableTemplates([]); return; }
    const controller = new AbortController();
    const options = { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal };
    void Promise.all([
      fetch(`${API}/api/v1/marketplace/managed-campaigns`, options).then(decode),
      fetch(`${API}/api/v1/marketplace/publishable-templates`, options).then(decode),
    ]).then(([campaignValue, templateValue]) => {
      const nextCampaigns = campaignValue && typeof campaignValue === "object" && Array.isArray((campaignValue as { items?: unknown }).items)
        ? (campaignValue as { items: Campaign[] }).items : [];
      const nextTemplates = templateValue && typeof templateValue === "object" && Array.isArray((templateValue as { items?: unknown }).items)
        ? (templateValue as { items: PublishableTemplate[] }).items : [];
      setCampaigns(nextCampaigns);
      setPublishableTemplates(nextTemplates);
    }).catch(() => { if (!controller.signal.aborted) setSourceError("Não foi possível carregar suas campanhas e modelos aprovados."); });
    return () => controller.abort();
  }, [token]);
  useEffect(() => {
    if (!sourceTemplateId || !token || !API) { setSourcePreview(null); return; }
    const controller = new AbortController();
    setSourcePreview(null); setSourceError("");
    void fetch(`${API}/api/v1/marketplace/publishable-templates/${encodeURIComponent(sourceTemplateId)}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(decode).then((value) => {
        if (!controller.signal.aborted && value && typeof value === "object" && "template" in value
            && "digest" in value && typeof value.digest === "string" && value.template
            && typeof value.template === "object" && Array.isArray((value.template as { fields?: unknown }).fields)) {
          setSourcePreview(value as TemplatePreview);
        } else if (!controller.signal.aborted) setSourceError("A API enviou uma prévia inválida.");
      }).catch(() => { if (!controller.signal.aborted) setSourceError("Não foi possível abrir a prévia do modelo aprovado."); });
    return () => controller.abort();
  }, [sourceTemplateId, token]);

  async function openDetail(item: MarketplaceCard) {
    setSelected(item); setDetailTemplate(null); setDetailLoading(true); setMessage("");
    try {
      if (!API) throw new Error("A API pública não está configurada.");
      const result = await decode(await fetch(`${API}/api/v1/marketplace/systems/${encodeURIComponent(item.id)}`, { cache: "no-store" }));
      if (result && typeof result === "object" && "template" in result) setDetailTemplate((result as { template: TemplateDraft }).template);
      else throw new Error("A API não enviou os detalhes do modelo.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível abrir os detalhes."); }
    finally { setDetailLoading(false); }
  }

  async function authorizedPost(path: string, body: unknown, headersOverride?: Record<string, string>) {
    if (!API) throw new Error("A API pública não está configurada.");
    if (!headers && !headersOverride) throw new Error("Entre na sua conta para realizar esta ação.");
    return decode(await fetch(`${API}${path}`, { method: "POST", headers: headersOverride ?? headers!, body: JSON.stringify(body) }));
  }

  async function vote(item: MarketplaceCard, value: 1 | -1) {
    try {
      await authorizedPost(`/api/v1/marketplace/systems/${encodeURIComponent(item.id)}/vote`, { value });
      setMessage("Voto registrado.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível registrar o voto."); }
  }

  async function report(item: MarketplaceCard) {
    const reason = reportReason[item.id]?.trim();
    if (!reason) { setMessage("Informe o motivo da denúncia."); return; }
    try {
      await authorizedPost(`/api/v1/marketplace/systems/${encodeURIComponent(item.id)}/report`, { reason });
      setHiddenReports((current) => [...new Set([...current, item.id])]);
      setMessage("Denúncia registrada. O modelo foi ocultado nesta tela.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível registrar a denúncia."); }
  }

  function copyrightReported(systemId: string) {
    setHiddenReports((current) => [...new Set([...current, systemId])]);
    setSelected((current) => current?.id === systemId ? null : current);
    setMessage("Denúncia de copyright registrada. O modelo foi ocultado e entrou na fila de moderação.");
  }

  async function clone(item: MarketplaceCard) {
    const value = campaignId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) { setMessage("Informe um ID de campanha válido."); return; }
    if (!token) { setMessage("Entre na sua conta para copiar o modelo."); return; }
    if (!campaigns.some((campaign) => campaign.id === value)) { setMessage("Escolha uma campanha que você gerencia."); return; }
    const storageKey = `marketplace-clone:${item.id}:${value}`;
    let key = "";
    try {
      key = localStorage.getItem(storageKey) ?? crypto.randomUUID();
      localStorage.setItem(storageKey, key);
      await authorizedPost(`/api/v1/marketplace/systems/${encodeURIComponent(item.id)}/clone`, { campaign_id: value, idempotency_key: key });
      localStorage.removeItem(storageKey);
      setCloneDestination(value);
      setMessage("Modelo copiado. Revise e aprove o modelo na campanha antes de criar fichas.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao copiar. Tente novamente com a mesma campanha."); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (!token) throw new Error("Entre na sua conta para publicar um modelo.");
      if (!rightsConfirmed) throw new Error("Confirme que você tem direito de publicar este conteúdo.");
      const metadata = { description: description.trim(), tags: tagList(tagDraft), author_name: author.trim(), dependencies: tagList(dependencies), rights_confirmed: true as const };
      if (!metadata.tags.length) throw new Error("Informe ao menos uma tag para o modelo.");
      if (sourceTemplateId) {
        if (!sourcePreview) throw new Error("Aguarde a prévia do modelo aprovado.");
        await authorizedPost("/api/v1/marketplace/systems/from-template",
          { ...metadata, template_id: sourceTemplateId, expected_digest: sourcePreview.digest });
      } else {
        let template: TemplateDraft;
        try { template = JSON.parse(draftJson) as TemplateDraft; } catch { throw new Error("Corrija o JSON do modelo antes de publicar."); }
        if (!template || typeof template.name !== "string" || !Number.isInteger(template.version) || !(Array.isArray(template.fields) || Array.isArray(template.primitives) || Array.isArray(template.computed_stats))) throw new Error("O modelo precisa ter name, version e fields ou as partições primitives/computed_stats.");
        const body: PublishPayload = { template, ...metadata };
        await authorizedPost("/api/v1/marketplace/systems", body);
      }
      setShowPublish(false); setSourceTemplateId(""); setSourcePreview(null); setDraftJson(emptyDraft); setDescription(""); setTagDraft(""); setDependencies(""); setRightsConfirmed(false);
      await loadItems(query, tags);
      setMessage("Modelo enviado para publicação.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível publicar o modelo."); }
    finally { setBusy(false); }
  }

  const visibleItems = items.filter((item) => !hiddenReports.includes(item.id));
  return <div className={styles.wrap}>
    <div className={styles.intro}>
      <div><p className={styles.eyebrow}>COMUNIDADE</p><h1>Modelos de ficha</h1><p>Encontre estruturas compartilhadas por outros mestres e leve uma cópia para uma campanha que você administra.</p></div>
      <button className={styles.publishToggle} type="button" onClick={() => { setShowPublish((value) => !value); setMessage(""); }}>Publicar modelo</button>
    </div>

    {showPublish && <form className={styles.publish} onSubmit={(event) => void publish(event)}>
      <h2>Novo modelo da comunidade</h2>
      <p>O servidor valida o conteúdo antes de publicar.</p>
      {publishableTemplates.length > 0 && <label>Modelo aprovado da campanha
        <select value={sourceTemplateId} onChange={(event) => setSourceTemplateId(event.target.value)}>
          <option value="">Escrever JSON manualmente</option>
          {publishableTemplates.map((item) => <option key={item.id} value={item.id}>{item.campaign_name} · {item.name} · v{item.version}</option>)}
        </select>
      </label>}
      {sourceTemplateId && <div className={styles.sourcePreview}>
        {sourcePreview ? <><p>Prévia: {sourcePreview.template.name} · {sourcePreview.template.fields?.length ?? 0} campos</p>
          <details><summary>Conferir JSON que será publicado</summary><pre>{JSON.stringify(sourcePreview.template, null, 2)}</pre></details></>
          : <p>Carregando prévia do modelo aprovado…</p>}
      </div>}
      {sourceError && <p className={styles.hint} role="alert">{sourceError}</p>}
      <label>Nome público do autor<input required maxLength={80} value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
      <label>Descrição<input required maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>Tags, separadas por vírgulas<input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} /></label>
      <label>Dependências, separadas por vírgulas<input value={dependencies} onChange={(event) => setDependencies(event.target.value)} /></label>
      {!sourceTemplateId && <label>JSON do modelo<textarea required rows={12} spellCheck={false} value={draftJson} onChange={(event) => setDraftJson(event.target.value)} /></label>}
      <label className={styles.check}><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />Confirmo que tenho os direitos necessários para publicar este conteúdo.</label>
      <button className={styles.publishToggle} disabled={busy || !token}>{busy ? "Enviando…" : "Enviar modelo"}</button>
      {!token && <p className={styles.hint}>Entre na conta para publicar.</p>}
    </form>}

    <form className={styles.search} onSubmit={(event) => { event.preventDefault(); void loadItems(query, tags); }}>
      <label>Buscar modelos<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou descrição" /></label>
      <label>Filtrar por tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="fantasia, horror" /></label>
      <button type="submit">Buscar</button>
    </form>

    <MarketplaceModerationPanel token={token} />

    {message && <p className={styles.message} role="status">{message} {cloneDestination && message.startsWith("Modelo copiado.") && <a href={`/app/campaign/${cloneDestination}`}>Abrir campanha para revisar</a>}</p>}
    {loading ? <p className={styles.empty} aria-live="polite">Carregando modelos…</p> : visibleItems.length ? <section className={styles.cards} aria-label="Modelos publicados">
      {visibleItems.map((item) => <article className={styles.card} key={item.id}>
        <div className={styles.cardHead}><p className={styles.eyebrow}>{item.automation_level || "Modelo"}</p><time dateTime={item.updated_at}>{new Date(item.updated_at).toLocaleDateString("pt-BR")}</time></div>
        <h2><button className={styles.titleButton} type="button" onClick={() => void openDetail(item)}>{item.name}</button></h2>
        <p className={styles.description}>{item.description}</p>
        <p className={styles.author}>Por {item.author_name}</p>
        {!!item.tags.length && <ul className={styles.tags}>{item.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>}
        <p className={styles.metrics}>{item.usage_count} cópias · {item.likes} votos positivos · {item.dislikes} votos negativos</p>
        <div className={styles.cardActions}>
          <button type="button" onClick={() => void vote(item, 1)} disabled={!token}>Gostei</button>
          <button type="button" onClick={() => void vote(item, -1)} disabled={!token}>Não gostei</button>
          <button type="button" onClick={() => void openDetail(item)}>Ver modelo</button>
        </div>
        <details className={styles.report}><summary>Denunciar</summary><label>Motivo<input minLength={10} maxLength={500} value={reportReason[item.id] ?? ""} onChange={(event) => setReportReason((current) => ({ ...current, [item.id]: event.target.value }))} /></label><button type="button" disabled={!token} onClick={() => void report(item)}>Enviar denúncia</button></details>
        <MarketplaceCopyrightReport systemId={item.id} systemName={item.name} token={token} submit={authorizedPost} onReported={copyrightReported} />
        <div className={styles.clone}>
          <label>Campanha que você gerencia<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">Selecione a campanha</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>
          <button type="button" disabled={!token || !campaignId} onClick={() => void clone(item)}>Copiar para campanha</button>
        </div>
      </article>)}
    </section> : <p className={styles.empty}>Nenhum modelo encontrado com esses filtros.</p>}

    {selected && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="marketplace-detail-title">
        <button className={styles.close} type="button" aria-label="Fechar detalhes" onClick={() => setSelected(null)}>×</button>
        <p className={styles.eyebrow}>MODELO DA COMUNIDADE</p><h2 id="marketplace-detail-title">{selected.name}</h2><p>{selected.description}</p>
        <h3>Campos e configuração</h3>
        {detailTemplate ? <pre>{JSON.stringify(detailTemplate, null, 2)}</pre> : <p>{detailLoading ? "Carregando detalhes do modelo…" : "Os detalhes do modelo não estão disponíveis."}</p>}
        <MarketplaceCopyrightReport systemId={selected.id} systemName={selected.name} token={token} submit={authorizedPost} onReported={copyrightReported} />
      </section>
    </div>}
  </div>;
}
