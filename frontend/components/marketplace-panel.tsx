"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { MarketplaceCard } from "../lib/marketplace-public";
import styles from "./marketplace-panel.module.css";

type Campaign = { id: string; name: string };
type ModerationReport = { id: string; system_id: string; reporter_id: string; reason: string; status: string; created_at: string; system_name: string; author_name: string };
type TemplateDraft = Record<string, unknown> & { name: string; version: number; fields: unknown[] };
type PublishPayload = { template: TemplateDraft; description: string; tags: string[]; author_name: string; dependencies: string[]; rights_confirmed: true };

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
  const [hiddenReports, setHiddenReports] = useState<string[]>([]);
  const [showPublish, setShowPublish] = useState(false);
  const [draftJson, setDraftJson] = useState(emptyDraft);
  const [description, setDescription] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [author, setAuthor] = useState("");
  const [dependencies, setDependencies] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [reportReason, setReportReason] = useState<Record<string, string>>({});
  const [moderationReports, setModerationReports] = useState<ModerationReport[]>([]);
  const [moderationNotes, setModerationNotes] = useState<Record<string, string>>({});
  const [moderationBusy, setModerationBusy] = useState(false);
  const [moderationMessage, setModerationMessage] = useState("");

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
    try { void createClient().auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null)); } catch { setToken(null); }
  }, []);
  useEffect(() => {
    if (!token || !API) { setCampaigns([]); return; }
    const controller = new AbortController();
    void fetch(`${API}/api/v1/sync/campaigns`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(decode).then((value) => {
        const rows = value && typeof value === "object" && Array.isArray((value as { campaigns?: unknown }).campaigns)
          ? (value as { campaigns: Array<{ id: string; name: string }> }).campaigns : [];
        setCampaigns(rows.map(({ id, name }) => ({ id, name })));
      }).catch(() => setCampaigns([]));
    return () => controller.abort();
  }, [token]);

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

  async function clone(item: MarketplaceCard) {
    const value = campaignId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) { setMessage("Informe um ID de campanha válido."); return; }
    if (!token) { setMessage("Entre na sua conta para copiar o modelo."); return; }
    const storageKey = `marketplace-clone:${item.id}:${value}`;
    let key = "";
    try {
      key = localStorage.getItem(storageKey) ?? crypto.randomUUID();
      localStorage.setItem(storageKey, key);
      await authorizedPost(`/api/v1/marketplace/systems/${encodeURIComponent(item.id)}/clone`, { campaign_id: value, idempotency_key: key });
      localStorage.removeItem(storageKey);
      setMessage("Modelo copiado para a campanha.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao copiar. Tente novamente com a mesma campanha."); }
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (!token) throw new Error("Entre na sua conta para publicar um modelo.");
      let template: TemplateDraft;
      try { template = JSON.parse(draftJson) as TemplateDraft; } catch { throw new Error("Corrija o JSON do modelo antes de publicar."); }
      if (!template || typeof template.name !== "string" || !Number.isInteger(template.version) || !(Array.isArray(template.fields) || Array.isArray(template.primitives) || Array.isArray(template.computed_stats))) throw new Error("O modelo precisa ter name, version e fields ou as partições primitives/computed_stats.");
      if (!rightsConfirmed) throw new Error("Confirme que você tem direito de publicar este conteúdo.");
      const body: PublishPayload = { template, description: description.trim(), tags: tagList(tagDraft), author_name: author.trim(), dependencies: tagList(dependencies), rights_confirmed: true };
      if (!body.tags.length) throw new Error("Informe ao menos uma tag para o modelo.");
      await authorizedPost("/api/v1/marketplace/systems", body);
      setShowPublish(false); setDraftJson(emptyDraft); setDescription(""); setTagDraft(""); setDependencies(""); setRightsConfirmed(false);
      await loadItems(query, tags);
      setMessage("Modelo enviado para publicação.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível publicar o modelo."); }
    finally { setBusy(false); }
  }

  async function loadModerationReports() {
    setModerationBusy(true); setModerationMessage("");
    try {
      if (!API) throw new Error("A API pública não está configurada.");
      if (!token) throw new Error("Entre na sua conta para abrir a fila de moderação.");
      const value = await decode(await fetch(`${API}/api/v1/marketplace/moderation/reports?page=1&limit=20`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }));
      if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) throw new Error("A API enviou uma fila de denúncias inválida.");
      setModerationReports((value as { items: ModerationReport[] }).items);
      setModerationMessage("Fila de denúncias carregada.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível carregar as denúncias.";
      setModerationMessage(message.startsWith("Ação não permitida.") ? "Sua conta não tem permissão para acessar a fila de moderação." : message);
    } finally { setModerationBusy(false); }
  }

  async function resolveReport(report: ModerationReport, action: "restore" | "remove") {
    setModerationBusy(true); setModerationMessage("");
    try {
      const note = moderationNotes[report.id]?.trim() || null;
      await authorizedPost(`/api/v1/marketplace/moderation/reports/${encodeURIComponent(report.id)}/resolve`, { action, note });
      setModerationReports((current) => current.filter((item) => item.id !== report.id));
      setModerationMessage(action === "remove" ? "Denúncia resolvida e modelo removido." : "Denúncia resolvida. O modelo foi restaurado quando não havia outra denúncia aberta.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível resolver a denúncia.";
      setModerationMessage(message.startsWith("Ação não permitida.") ? "Sua conta não tem permissão para moderar denúncias." : message);
    } finally { setModerationBusy(false); }
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
      <label>Nome público do autor<input required maxLength={80} value={author} onChange={(event) => setAuthor(event.target.value)} /></label>
      <label>Descrição<input required maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>Tags, separadas por vírgulas<input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} /></label>
      <label>Dependências, separadas por vírgulas<input value={dependencies} onChange={(event) => setDependencies(event.target.value)} /></label>
      <label>JSON do modelo<textarea required rows={12} spellCheck={false} value={draftJson} onChange={(event) => setDraftJson(event.target.value)} /></label>
      <label className={styles.check}><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />Confirmo que tenho os direitos necessários para publicar este conteúdo.</label>
      <button className={styles.publishToggle} disabled={busy || !token}>{busy ? "Enviando…" : "Enviar modelo"}</button>
      {!token && <p className={styles.hint}>Entre na conta para publicar.</p>}
    </form>}

    <form className={styles.search} onSubmit={(event) => { event.preventDefault(); void loadItems(query, tags); }}>
      <label>Buscar modelos<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou descrição" /></label>
      <label>Filtrar por tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="fantasia, horror" /></label>
      <button type="submit">Buscar</button>
    </form>

    {token && <details className={styles.moderation}>
      <summary>Moderação de denúncias</summary>
      <p>A fila só é consultada quando você solicita. A API verifica a permissão da sua conta.</p>
      <button type="button" disabled={moderationBusy} onClick={() => void loadModerationReports()}>{moderationBusy ? "Carregando…" : "Carregar denúncias"}</button>
      {moderationMessage && <p role="status">{moderationMessage}</p>}
      {moderationReports.map((report) => <article className={styles.moderationItem} key={report.id}>
        <h3>{report.system_name}</h3><p>Autor: {report.author_name} · Estado: {report.status}</p>
        <p>{report.reason}</p><time dateTime={report.created_at}>{new Date(report.created_at).toLocaleString("pt-BR")}</time>
        <label>Nota de resolução<textarea maxLength={2000} value={moderationNotes[report.id] ?? ""} onChange={(event) => setModerationNotes((current) => ({ ...current, [report.id]: event.target.value }))} /></label>
        <div className={styles.cardActions}><button type="button" disabled={moderationBusy} onClick={() => void resolveReport(report, "restore")}>Restaurar se não houver outra denúncia</button><button type="button" disabled={moderationBusy} onClick={() => void resolveReport(report, "remove")}>Remover modelo</button></div>
      </article>)}
      {moderationReports.length === 0 && moderationMessage === "Fila de denúncias carregada." && <p>A fila está vazia.</p>}
    </details>}

    {message && <p className={styles.message} role="status">{message}</p>}
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
        <div className={styles.clone}>
          {campaigns.length > 0 && <label>Campanha permitida<select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">Selecione ou informe um ID</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label>}
          <label>ID da campanha<input aria-label={`ID da campanha para copiar ${item.name}`} value={campaignId} onChange={(event) => setCampaignId(event.target.value)} placeholder="UUID da campanha" /></label>
          <button type="button" disabled={!token} onClick={() => void clone(item)}>Copiar para campanha</button>
        </div>
      </article>)}
    </section> : <p className={styles.empty}>Nenhum modelo encontrado com esses filtros.</p>}

    {selected && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="marketplace-detail-title">
        <button className={styles.close} type="button" aria-label="Fechar detalhes" onClick={() => setSelected(null)}>×</button>
        <p className={styles.eyebrow}>MODELO DA COMUNIDADE</p><h2 id="marketplace-detail-title">{selected.name}</h2><p>{selected.description}</p>
        <h3>Campos e configuração</h3>
        {detailTemplate ? <pre>{JSON.stringify(detailTemplate, null, 2)}</pre> : <p>{detailLoading ? "Carregando detalhes do modelo…" : "Os detalhes do modelo não estão disponíveis."}</p>}
      </section>
    </div>}
  </div>;
}
