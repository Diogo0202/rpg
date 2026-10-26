"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./marketplace-moderation-panel.module.css";

type SystemStatus = "published" | "hidden" | "removed";
type QueueItem = { id: string; system_id: string; system_name: string; author_name: string; system_status: SystemStatus; reason: string; created_at: string; open_reports: number };
type ModeratedSystem = { id: string; name: string; author_name: string; status: SystemStatus; updated_at: string; open_reports: number };
type HistoryItem = { id: number; system_id: string; system_name: string; action: "hide" | "restore" | "remove"; previous_status: SystemStatus; current_status: SystemStatus; note: string | null; from_report: boolean; by_me: boolean; created_at: string };
type Tab = "reports" | "systems" | "history";
type PendingRemoval = { kind: "report" | "system"; id: string } | null;

const API = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
const STATUS_LABEL: Record<SystemStatus, string> = { published: "Publicado", hidden: "Oculto", removed: "Removido" };
const ACTION_LABEL: Record<HistoryItem["action"], string> = { hide: "Ocultou", restore: "Restaurou", remove: "Removeu" };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

async function readJson(response: Response): Promise<unknown> {
  let data: unknown = null;
  try { data = await response.json(); } catch { /* corpo vazio ou inválido */ }
  if (!response.ok) {
    if (response.status === 403) throw new Error("Ação não permitida para esta conta ou para o estado atual do modelo (por exemplo, restaurar com denúncia aberta).");
    if (response.status === 422) throw new Error("Dados inválidos. Informe um motivo com pelo menos 3 caracteres.");
    const detail = data && typeof data === "object" && typeof (data as { detail?: unknown }).detail === "string" ? (data as { detail: string }).detail.slice(0, 200) : "Tente novamente.";
    throw new Error(`Não foi possível concluir. ${detail}`);
  }
  return data;
}

function itemsOf<T>(value: unknown): T[] {
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) return (value as { items: T[] }).items;
  throw new Error("A API enviou uma resposta inválida.");
}

/** Área de moderação: só aparece quando o servidor confirma que a sessão é moderadora. */
export function MarketplaceModerationPanel({ token }: { token: string | null }) {
  const [allowed, setAllowed] = useState(false);
  const [tab, setTab] = useState<Tab>("reports");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [systems, setSystems] = useState<ModeratedSystem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"" | SystemStatus>("hidden");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const get = useCallback(async (path: string) => {
    if (!API || !token) throw new Error("Sessão ou API indisponível.");
    return readJson(await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }));
  }, [token]);

  useEffect(() => {
    if (!token || !API) { setAllowed(false); return; }
    const controller = new AbortController();
    void fetch(`${API}/api/v1/marketplace/moderation/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal })
      .then(readJson)
      .then((value) => setAllowed(Boolean(value && typeof value === "object" && (value as { is_moderator?: unknown }).is_moderator === true)))
      .catch(() => setAllowed(false));
    return () => controller.abort();
  }, [token]);

  const loadQueue = useCallback(async () => setQueue(itemsOf<QueueItem>(await get("/api/v1/marketplace/moderation/reports?page=1&limit=50"))), [get]);
  const loadHistory = useCallback(async () => setHistory(itemsOf<HistoryItem>(await get("/api/v1/marketplace/moderation/log?page=1&limit=50"))), [get]);
  const loadSystems = useCallback(async (status: "" | SystemStatus, q: string) => {
    const params = new URLSearchParams({ page: "1", limit: "50" });
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    setSystems(itemsOf<ModeratedSystem>(await get(`/api/v1/marketplace/moderation/systems?${params}`)));
  }, [get]);

  const run = useCallback(async (task: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await task(); } catch (error) { setMessage(error instanceof Error ? error.message : "Falha na moderação."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    // Carrega a aba visível; as outras são buscadas quando abertas.
    const task = tab === "reports" ? loadQueue : tab === "history" ? loadHistory : () => loadSystems(statusFilter, search);
    void run(task);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filtros de sistemas são aplicados pelo formulário
  }, [allowed, tab, loadQueue, loadHistory, run]);

  async function post(path: string, body: unknown) {
    if (!API || !token) throw new Error("Sessão ou API indisponível.");
    return readJson(await fetch(`${API}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  }

  function reasonFor(key: string): string | null {
    const note = notes[key]?.trim() ?? "";
    if (note.length < 3) { setMessage("Informe o motivo da decisão (mínimo de 3 caracteres)."); return null; }
    return note;
  }

  function resolveReport(item: QueueItem, action: "restore" | "remove") {
    const note = reasonFor(`report:${item.id}`);
    if (!note) return;
    if (action === "remove" && !(pendingRemoval?.kind === "report" && pendingRemoval.id === item.id)) { setPendingRemoval({ kind: "report", id: item.id }); return; }
    void run(async () => {
      await post(`/api/v1/marketplace/moderation/reports/${encodeURIComponent(item.id)}/resolve`, { action, note });
      setPendingRemoval(null);
      setNotes((current) => ({ ...current, [`report:${item.id}`]: "" }));
      await loadQueue();
      setMessage(action === "remove" ? `"${item.system_name}" foi removido e as denúncias abertas foram encerradas.` : "Denúncia resolvida. O modelo volta a ser publicado quando não restar denúncia aberta.");
    });
  }

  function moderateSystem(item: ModeratedSystem, action: "hide" | "restore" | "remove") {
    const note = reasonFor(`system:${item.id}`);
    if (!note) return;
    if (action === "remove" && !(pendingRemoval?.kind === "system" && pendingRemoval.id === item.id)) { setPendingRemoval({ kind: "system", id: item.id }); return; }
    void run(async () => {
      const result = await post(`/api/v1/marketplace/moderation/systems/${encodeURIComponent(item.id)}`, { action, note });
      const status = result && typeof result === "object" ? (result as { status?: SystemStatus }).status : undefined;
      setPendingRemoval(null);
      setNotes((current) => ({ ...current, [`system:${item.id}`]: "" }));
      await loadSystems(statusFilter, search);
      setMessage(`"${item.name}" agora está: ${status ? STATUS_LABEL[status] : "atualizado"}.`);
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() => loadSystems(statusFilter, search));
  }

  if (!allowed) return null;

  const removalPending = (kind: "report" | "system", id: string) => pendingRemoval?.kind === kind && pendingRemoval.id === id;

  return <section className={styles.panel} aria-labelledby="marketplace-moderation-title">
    <div className={styles.head}>
      <div><p className={styles.eyebrow}>MODERAÇÃO</p><h2 id="marketplace-moderation-title">Área do moderador</h2></div>
      <p className={styles.note}>Toda ação exige um motivo e fica registrada no histórico privado. O servidor confere sua permissão a cada pedido.</p>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Seções da moderação">
      {([["reports", "Denúncias abertas"], ["systems", "Modelos"], ["history", "Histórico"]] as const).map(([value, label]) =>
        <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? styles.activeTab : undefined} onClick={() => { setTab(value); setPendingRemoval(null); setMessage(""); }}>{label}</button>)}
    </div>
    {message && <p className={styles.message} role="status">{message}</p>}

    {tab === "reports" && <div role="tabpanel" aria-label="Denúncias abertas">
      <div className={styles.toolbar}><button type="button" disabled={busy} onClick={() => void run(loadQueue)}>{busy ? "Carregando…" : "Atualizar fila"}</button></div>
      {queue.length === 0 && !busy && <p className={styles.empty}>Nenhuma denúncia aberta.</p>}
      {queue.map((item) => {
        const key = `report:${item.id}`;
        return <article className={styles.item} key={item.id}>
          <div className={styles.itemHead}><h3>{item.system_name}</h3><span className={styles.badge} data-status={item.system_status}>{STATUS_LABEL[item.system_status] ?? item.system_status}</span></div>
          <p className={styles.meta}>Autor: {item.author_name} · Denunciado em <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>{item.open_reports > 1 ? ` · ${item.open_reports} denúncias abertas` : ""}</p>
          <blockquote className={styles.reason}>{item.reason}</blockquote>
          <label className={styles.field}>Motivo da decisão (obrigatório)<textarea required minLength={3} maxLength={2000} value={notes[key] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [key]: event.target.value }))} /></label>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => resolveReport(item, "restore")}>Resolver e restaurar</button>
            {removalPending("report", item.id)
              ? <><button type="button" className={styles.danger} disabled={busy} onClick={() => resolveReport(item, "remove")}>Confirmar remoção definitiva</button><button type="button" disabled={busy} onClick={() => setPendingRemoval(null)}>Cancelar</button></>
              : <button type="button" className={styles.dangerOutline} disabled={busy} onClick={() => resolveReport(item, "remove")}>Resolver e remover…</button>}
          </div>
          {removalPending("report", item.id) && <p className={styles.warning} role="alert">Remover tira o modelo da comunidade e encerra todas as denúncias abertas dele. Confirme para continuar.</p>}
        </article>;
      })}
    </div>}

    {tab === "systems" && <div role="tabpanel" aria-label="Modelos">
      <form className={styles.filters} onSubmit={submitSearch}>
        <label className={styles.field}>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | SystemStatus)}><option value="">Todos</option><option value="published">Publicados</option><option value="hidden">Ocultos</option><option value="removed">Removidos</option></select></label>
        <label className={styles.field}>Buscar<input type="search" maxLength={120} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome do modelo" /></label>
        <button type="submit" disabled={busy}>{busy ? "Buscando…" : "Filtrar"}</button>
      </form>
      {systems.length === 0 && !busy && <p className={styles.empty}>Nenhum modelo com esses filtros.</p>}
      {systems.map((item) => {
        const key = `system:${item.id}`;
        return <article className={styles.item} key={item.id}>
          <div className={styles.itemHead}><h3>{item.name}</h3><span className={styles.badge} data-status={item.status}>{STATUS_LABEL[item.status] ?? item.status}</span></div>
          <p className={styles.meta}>Autor: {item.author_name} · Atualizado em <time dateTime={item.updated_at}>{formatDate(item.updated_at)}</time>{item.open_reports > 0 ? ` · ${item.open_reports} denúncia(s) aberta(s)` : ""}</p>
          <label className={styles.field}>Motivo da decisão (obrigatório)<textarea required minLength={3} maxLength={2000} value={notes[key] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [key]: event.target.value }))} /></label>
          <div className={styles.actions}>
            {item.status === "published" && <button type="button" disabled={busy} onClick={() => moderateSystem(item, "hide")}>Ocultar</button>}
            {item.status !== "published" && <button type="button" disabled={busy || item.open_reports > 0} title={item.open_reports > 0 ? "Resolva as denúncias abertas antes de restaurar" : undefined} onClick={() => moderateSystem(item, "restore")}>Restaurar</button>}
            {item.status !== "removed" && (removalPending("system", item.id)
              ? <><button type="button" className={styles.danger} disabled={busy} onClick={() => moderateSystem(item, "remove")}>Confirmar remoção definitiva</button><button type="button" disabled={busy} onClick={() => setPendingRemoval(null)}>Cancelar</button></>
              : <button type="button" className={styles.dangerOutline} disabled={busy} onClick={() => moderateSystem(item, "remove")}>Remover…</button>)}
          </div>
          {item.open_reports > 0 && item.status !== "published" && <p className={styles.meta}>Restaurar fica bloqueado enquanto houver denúncia aberta; resolva-as na aba de denúncias.</p>}
          {removalPending("system", item.id) && <p className={styles.warning} role="alert">Remover tira o modelo da comunidade e encerra as denúncias abertas dele. Confirme para continuar.</p>}
        </article>;
      })}
    </div>}

    {tab === "history" && <div role="tabpanel" aria-label="Histórico">
      <div className={styles.toolbar}><button type="button" disabled={busy} onClick={() => void run(loadHistory)}>{busy ? "Carregando…" : "Atualizar histórico"}</button></div>
      {history.length === 0 && !busy && <p className={styles.empty}>Nenhuma ação registrada.</p>}
      {history.length > 0 && <ol className={styles.history}>
        {history.map((entry) => <li key={entry.id}>
          <p><strong>{ACTION_LABEL[entry.action] ?? entry.action}</strong> “{entry.system_name}” · {STATUS_LABEL[entry.previous_status] ?? entry.previous_status} → agora {STATUS_LABEL[entry.current_status] ?? entry.current_status}{entry.from_report ? " · via denúncia" : ""}</p>
          {entry.note && <p className={styles.reasonInline}>{entry.note}</p>}
          <p className={styles.meta}><time dateTime={entry.created_at}>{formatDate(entry.created_at)}</time> · {entry.by_me ? "por você" : "por outro moderador"}</p>
        </li>)}
      </ol>}
    </div>}
  </section>;
}
