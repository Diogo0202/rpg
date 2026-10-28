"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { canApproveMarketplaceImport, marketplaceApprovalError, parsePendingMarketplaceImports, type PendingMarketplaceImport } from "../lib/marketplace-imports";
import styles from "./marketplace-imports-panel.module.css";

type Props = { campaignId: string; viewerId: string; canManage: boolean; onOpenSheets: () => void };
const fieldLabels: Record<string, string> = { text: "Texto", number: "Número", select: "Escolha", checkbox: "Marcação", collection: "Lista", formula: "Cálculo", roll: "Rolagem" };

export function MarketplaceImportsPanel({ campaignId, viewerId, canManage, onOpenSheets }: Props) {
  const context = `${campaignId}:${viewerId}:${canManage}`;
  const contextRef = useRef(context);
  contextRef.current = context;
  const busyRef = useRef(false);
  const lifecycleRef = useRef(0);
  const [items, setItems] = useState<PendingMarketplaceImport[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const selected = items.find((item) => item.id === selectedId);

  useEffect(() => {
    let active = true;
    const lifecycle = ++lifecycleRef.current;
    const close = () => { active = false; if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1; };
    const current = () => active && contextRef.current === context;
    setItems([]); setSelectedId(""); setReviewed(false); setError(""); setMessage("");
    busyRef.current = false; setBusy(false); setLoading(canManage);
    if (!canManage) return close;
    async function load() {
      try {
        const result = await createClient().rpc("marketplace_pending_imports", { p_campaign_id: campaignId });
        if (!current()) return;
        if (result.error) throw result.error;
        setItems(parsePendingMarketplaceImports(result.data));
      } catch {
        if (current()) setError("Não foi possível carregar os modelos importados. Confira a conexão e as permissões da campanha.");
      } finally { if (current()) setLoading(false); }
    }
    void load();
    return close;
  }, [campaignId, canManage, context, revision]);

  async function approve() {
    if (!canManage || busyRef.current || loading || !selected || !canApproveMarketplaceImport(selected, reviewed)) return;
    const requestContext = context;
    const requestLifecycle = lifecycleRef.current;
    const current = () => contextRef.current === requestContext && lifecycleRef.current === requestLifecycle;
    const item = selected;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await createClient().rpc("marketplace_approve_import", {
        p_campaign_id: campaignId, p_template_id: item.id, p_expected_schema: item.schema,
      });
      if (!current()) return;
      if (result.error) throw result.error;
      if (result.data !== item.id) throw new Error("invalid approval response");
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setSelectedId(""); setReviewed(false);
      setMessage(`${item.name} foi aprovado e está disponível para criar fichas nesta campanha.`);
    } catch (cause) {
      if (current()) {
        setError(marketplaceApprovalError(cause));
        setReviewed(false); setItems([]); setSelectedId("");
      }
    } finally {
      if (current()) { busyRef.current = false; setBusy(false); }
    }
  }

  if (!canManage) return <section className="content"><p>Somente o narrador pode revisar modelos importados para esta campanha.</p></section>;

  return <section className={`content ${styles.panel}`} aria-label="Modelos importados do Marketplace">
    <header className={styles.header}>
      <div><p className="eyebrow">MARKETPLACE / REVISÃO DA CAMPANHA</p><h2>Modelos aguardando sua revisão</h2>
        <p>A cópia permanece em revisão até você conferir os campos e aprovar o uso nesta mesa.</p></div>
      <a className="quiet" href="/marketplace">Explorar modelos</a>
    </header>
    <div className={styles.actions}>
      <button type="button" className="quiet" disabled={busy || loading} onClick={() => setRevision((value) => value + 1)}>Atualizar importações</button>
      <button type="button" className="quiet" disabled={busy} onClick={onOpenSheets}>Ir para fichas</button>
    </div>
    {loading && <p role="status">Carregando modelos importados…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.success}>{message}</p>}
    {!loading && !error && !items.length && <p>Nenhum modelo do Marketplace aguarda aprovação nesta campanha.</p>}
    <div className={styles.cards}>
      {items.map((item) => <article className={styles.card} key={item.id}>
        <h3>{item.name}</h3><p>Origem: {item.source_name} · versão {item.version} · {item.schema.fields.length} campos</p>
        <p>{item.source_status === "published" ? "Publicação disponível para revisão." : "A publicação de origem está indisponível. A aprovação está bloqueada."}</p>
        <button type="button" className="quiet" disabled={busy} aria-expanded={selectedId === item.id}
          onClick={() => { setSelectedId(selectedId === item.id ? "" : item.id); setReviewed(false); setError(""); setMessage(""); }}>Revisar {item.name}</button>
        {selectedId === item.id && <div className={styles.review}>
          <ul className={styles.fields}>{item.schema.fields.map((field) => <li key={field.id}>
            <b>{field.label}</b><span>{fieldLabels[field.kind]}{field.required ? " · obrigatório" : ""}</span>
            {field.options?.length ? <small>Opções: {field.options.join(", ")}</small> : null}
            {field.expression ? <code>{field.expression}</code> : null}
          </li>)}</ul>
          <details><summary>Conferir modelo completo e regras de criação</summary><pre>{JSON.stringify(item.schema, null, 2)}</pre></details>
          <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={busy || item.source_status !== "published"}
            onChange={(event) => setReviewed(event.target.checked)} />Conferi os campos e as regras deste modelo para esta campanha.</label>
          <button className="primary" type="button" disabled={busy || !canApproveMarketplaceImport(item, reviewed)} onClick={() => void approve()}>
            {busy ? "Aprovando modelo…" : "Aprovar para criar fichas"}
          </button>
        </div>}
      </article>)}
    </div>
  </section>;
}
