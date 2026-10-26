"use client";

import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  CompendiumEntry,
  compendiumEntries,
  findCompendiumEntry,
  searchCompendium,
} from "../lib/compendium";
import {
  CAMPAIGN_COMPENDIUM_COLUMNS,
  CampaignCompendiumRow,
  CompendiumProposalDraft,
  emptyProposalDraft,
  mergeCompendiumEntries,
  originLabel,
  splitReviewRows,
  validateCompendiumProposal,
} from "../lib/campaign-compendium";
import { createClient } from "../lib/supabase/client";
import styles from "./compendium-panel.module.css";

type CompendiumPanelProps = {
  selectedNames?: string[];
  onSelect?: (name: string) => void;
  /** When present, approved entries of this campaign are merged with the local examples. */
  campaignId?: string;
  viewerId?: string;
  /** Narrator (owner/master) sees the review queue. */
  canReview?: boolean;
};

const typeLabel = (type: CompendiumEntry["type"]) => (type === "discipline" ? "Disciplina" : "Vantagem");

function EntryDialog({ entry, onClose }: { entry?: CompendiumEntry; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog className={styles.dialog} ref={dialogRef} onClose={onClose} aria-labelledby="compendium-dialog-title">
      <div className={styles.dialogHeader}>
        <div>
          <p className={styles.eyebrow}>DETALHE DO ACERVO</p>
          <h2 id="compendium-dialog-title">{entry?.title ?? "Sem verbete cadastrado"}</h2>
        </div>
        <button className={styles.closeButton} type="button" onClick={() => dialogRef.current?.close()} autoFocus>
          Fechar
        </button>
      </div>
      {entry ? (
        <>
          <p className={styles.description}>{entry.description}</p>
          <dl className={styles.details}>
            <div><dt>Tipo e nível</dt><dd>{typeLabel(entry.type)}, {entry.level}</dd></div>
            <div><dt>Custo</dt><dd>{entry.cost}</dd></div>
            <div><dt>Parada</dt><dd>{entry.pool}</dd></div>
            <div><dt>Duração</dt><dd>{entry.duration}</dd></div>
            <div><dt>Etiquetas</dt><dd>{entry.tags.join(", ") || "Sem etiquetas"}</dd></div>
            <div><dt>Proveniência</dt><dd>{originLabel(entry)}</dd></div>
          </dl>
        </>
      ) : <p className={styles.description}>Este nome não possui verbete cadastrado neste acervo.</p>}
    </dialog>
  );
}

export function CompendiumReference({ name, entries }: { name: string; entries?: CompendiumEntry[] }) {
  const [open, setOpen] = useState(false);
  const entry = findCompendiumEntry(name, entries);
  return <>
    <button className={styles.reference} type="button" onClick={() => setOpen(true)}>{name}</button>
    {open && <EntryDialog entry={entry} onClose={() => setOpen(false)} />}
  </>;
}

function ProposalForm({ campaignId, onSaved }: { campaignId: string; onSaved: (message: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState<CompendiumProposalDraft>(emptyProposalDraft);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const field = <K extends keyof CompendiumProposalDraft>(key: K, value: CompendiumProposalDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const { payload, errors: found } = validateCompendiumProposal(campaignId, draft);
    setErrors(found);
    if (!payload) return;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("compendium_propose_entry", payload);
      if (error) throw error;
      setDraft(emptyProposalDraft());
      onSaved("Proposta enviada. O narrador precisa aprovar antes de ela aparecer para a mesa.");
    } catch {
      setErrors(["Não foi possível enviar a proposta. Confira os campos e sua participação na campanha."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <label htmlFor={`${id}-title`}>Nome<input id={`${id}-title`} value={draft.title} maxLength={120} required onChange={(e) => field("title", e.target.value)} /></label>
      <label htmlFor={`${id}-type`}>Tipo
        <select id={`${id}-type`} value={draft.type} onChange={(e) => field("type", e.target.value as CompendiumProposalDraft["type"])}>
          <option value="discipline">Disciplina</option><option value="advantage">Vantagem</option>
        </select>
      </label>
      <label htmlFor={`${id}-level`}>Nível
        <select id={`${id}-level`} value={draft.level} onChange={(e) => field("level", e.target.value)}>
          {[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label htmlFor={`${id}-tags`}>Etiquetas (separadas por vírgula)<input id={`${id}-tags`} value={draft.tags} onChange={(e) => field("tags", e.target.value)} placeholder="homebrew, mascara-preservada" /></label>
      <label htmlFor={`${id}-cost`}>Custo<input id={`${id}-cost`} value={draft.cost} maxLength={240} onChange={(e) => field("cost", e.target.value)} /></label>
      <label htmlFor={`${id}-pool`}>Parada<input id={`${id}-pool`} value={draft.pool} maxLength={240} onChange={(e) => field("pool", e.target.value)} /></label>
      <label htmlFor={`${id}-duration`}>Duração<input id={`${id}-duration`} value={draft.duration} maxLength={240} onChange={(e) => field("duration", e.target.value)} /></label>
      <label className={styles.wide} htmlFor={`${id}-description`}>Descrição (texto próprio, sem copiar livros)
        <textarea id={`${id}-description`} value={draft.description} maxLength={4000} required onChange={(e) => field("description", e.target.value)} />
      </label>
      <label htmlFor={`${id}-source`}>Fonte<input id={`${id}-source`} value={draft.sourceTitle} maxLength={240} required onChange={(e) => field("sourceTitle", e.target.value)} placeholder="Caderno da mesa" /></label>
      <label htmlFor={`${id}-page`}>Página<input id={`${id}-page`} value={draft.sourcePage} inputMode="numeric" onChange={(e) => field("sourcePage", e.target.value)} /></label>
      <label htmlFor={`${id}-kind`}>Origem da fonte
        <select id={`${id}-kind`} value={draft.sourceKind} onChange={(e) => field("sourceKind", e.target.value as CompendiumProposalDraft["sourceKind"])}>
          <option value="homebrew">Homebrew</option><option value="licensed">Licenciado (referência)</option>
        </select>
      </label>
      {errors.length > 0 && <ul className={`${styles.wide} ${styles.notice}`} role="alert">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      <div className={`${styles.wide} ${styles.actions}`}>
        <button className={styles.selectButton} type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar para revisão"}</button>
      </div>
    </form>
  );
}

function ReviewItem({ row, onDone }: { row: CampaignCompendiumRow; onDone: (message: string) => void }) {
  const id = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function review(action: "approve" | "reject") {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("compendium_review_entry", { p_entry_id: row.id, p_action: action, p_note: note.trim() || null });
      if (error) throw error;
      onDone(action === "approve" ? `“${row.title}” aprovado para a campanha.` : `“${row.title}” rejeitado.`);
    } catch {
      onDone(action === "approve" ? `Não foi possível aprovar “${row.title}”. Verifique se já existe um verbete aprovado com esse nome.` : `Não foi possível rejeitar “${row.title}”.`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li>
      <strong>{row.title}</strong>
      <p>{typeLabel(row.entry_type)} · nível {row.level} · {row.source_title}{row.source_page ? `, página ${row.source_page}` : ""} ({row.source_kind === "licensed" ? "licenciado" : "homebrew"})</p>
      <p>{row.description}</p>
      <label htmlFor={`${id}-note`}>Nota da revisão (opcional)<input className={styles.reviewNote} id={`${id}-note`} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} /></label>
      <div className={styles.actions}>
        <button className={styles.selectButton} type="button" disabled={busy} onClick={() => void review("approve")}>Aprovar</button>
        <button className={styles.detailButton} type="button" disabled={busy} onClick={() => void review("reject")}>Rejeitar</button>
      </div>
    </li>
  );
}

export function CompendiumPanel({ selectedNames = [], onSelect, campaignId, viewerId, canReview = false }: CompendiumPanelProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [level, setLevel] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [preservedMask, setPreservedMask] = useState(false);
  const [detail, setDetail] = useState<CompendiumEntry | undefined>();
  const [rows, setRows] = useState<CampaignCompendiumRow[]>([]);
  const [loading, setLoading] = useState(Boolean(campaignId));
  const [message, setMessage] = useState("");
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!campaignId) return;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const { data, error } = await createClient().from("campaign_compendium_entries").select(CAMPAIGN_COMPENDIUM_COLUMNS)
        .eq("campaign_id", campaignId).order("updated_at", { ascending: false }).limit(500);
      if (error) throw error;
      if (request === requestRef.current) setRows((data ?? []) as unknown as CampaignCompendiumRow[]);
    } catch {
      if (request === requestRef.current) setMessage("Não foi possível carregar os verbetes da campanha. Os exemplos locais continuam disponíveis.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    setRows([]); setMessage("");
    void load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const entries = useMemo(() => (campaignId ? mergeCompendiumEntries(compendiumEntries, rows) : compendiumEntries), [campaignId, rows]);
  const baseResults = useMemo(() => searchCompendium(query, entries), [query, entries]);
  const results = baseResults.filter((entry) =>
    (type === "all" || entry.type === type) &&
    (level === "all" || entry.level === Number(level)) &&
    (origin === "all" || (entry.origin ?? "local") === origin) &&
    (!preservedMask || entry.tags.includes("mascara-preservada")),
  );
  const selected = new Set(selectedNames.map((name) => name.toLocaleLowerCase("pt-BR")));
  const { pending, mine } = splitReviewRows(rows, viewerId);
  const campaignCount = entries.filter((entry) => entry.origin === "campaign").length;
  const afterChange = (text: string) => { setMessage(text); void load(); };

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>ACERVO DA CAMPANHA</p>
          <h2 id={`${id}-title`}>Compêndio</h2>
          <p>{campaignId
            ? "Verbetes aprovados pelo narrador desta campanha, somados aos exemplos homebrew locais. Nenhum texto de livro oficial vem incluído."
            : "Acervo com exemplos homebrew originais. Dados V5 autorizados estão pendentes."}</p>
        </div>
        <span className={styles.count}>{campaignId ? `${campaignCount} da campanha · ${entries.length - campaignCount} locais` : `${entries.length} exemplos`}</span>
      </header>

      {message && <p className={styles.notice} role="status">{message}</p>}

      <div className={styles.filters}>
        <label className={styles.searchLabel} htmlFor={`${id}-query`}>Buscar por nome, etiqueta ou descrição
          <input id={`${id}-query`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: contato" />
        </label>
        <label htmlFor={`${id}-type`}>Tipo
          <select id={`${id}-type`} value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">Todos</option><option value="discipline">Disciplina</option><option value="advantage">Vantagem</option>
          </select>
        </label>
        <label htmlFor={`${id}-level`}>Nível
          <select id={`${id}-level`} value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="all">Todos</option>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        {campaignId && <label htmlFor={`${id}-origin`}>Origem
          <select id={`${id}-origin`} value={origin} onChange={(event) => setOrigin(event.target.value)}>
            <option value="all">Todas</option><option value="campaign">Campanha</option><option value="local">Exemplos locais</option>
          </select>
        </label>}
        <label className={styles.checkbox} htmlFor={`${id}-mask`}>
          <input id={`${id}-mask`} type="checkbox" checked={preservedMask} onChange={(event) => setPreservedMask(event.target.checked)} />
          Etiqueta manual: mascara-preservada
        </label>
      </div>

      <div className={styles.results} aria-live="polite" aria-busy={loading}>
        {results.length === 0 && <p>Nenhum verbete corresponde aos filtros.</p>}
        {results.map((entry) => {
          const isSelected = selected.has(entry.title.toLocaleLowerCase("pt-BR"));
          const fromCampaign = entry.origin === "campaign";
          return <article className={styles.card} key={entry.id}>
            <div className={styles.cardTop}>
              <div><p className={styles.cardMeta}>{typeLabel(entry.type)} · nível {entry.level}</p><h3>{entry.title}</h3></div>
              {onSelect && <button type="button" className={isSelected ? styles.selectedButton : styles.selectButton} aria-pressed={isSelected} onClick={() => onSelect(entry.title)}>
                {isSelected ? "Selecionado" : "Adicionar à ficha"}
              </button>}
            </div>
            <p>{entry.description}</p>
            <span className={fromCampaign ? `${styles.origin} ${styles.originCampaign}` : styles.origin}>{fromCampaign ? "Campanha" : "Exemplo local"} · {entry.source.title}{entry.source.page ? `, p. ${entry.source.page}` : ""}</span>
            <div className={styles.cardBottom}>
              <span>{entry.tags.join(" · ")}</span>
              <button type="button" className={styles.detailButton} onClick={() => setDetail(entry)}>Ver detalhe</button>
            </div>
          </article>;
        })}
      </div>

      {campaignId && <details className={styles.workflow}>
        <summary>Propor verbete para a campanha</summary>
        <p className={styles.notice}>A proposta fica pendente até o narrador aprovar. Escreva com suas palavras e cite a fonte e a página.</p>
        <ProposalForm campaignId={campaignId} onSaved={afterChange} />
      </details>}

      {campaignId && mine.length > 0 && <section className={styles.workflow} aria-labelledby={`${id}-mine`}>
        <h3 id={`${id}-mine`}>Minhas propostas</h3>
        <ul className={styles.queue}>{mine.map((row) => <li key={row.id}>
          <strong>{row.title}</strong>
          <p>{row.status === "pending" ? "Aguardando revisão do narrador" : `Rejeitada${row.review_note ? `: ${row.review_note}` : ""}`}</p>
        </li>)}</ul>
      </section>}

      {campaignId && canReview && <section className={styles.workflow} aria-labelledby={`${id}-review`}>
        <h3 id={`${id}-review`}>Revisão do narrador ({pending.length})</h3>
        {pending.length === 0 ? <p>Nenhuma proposta pendente.</p> : <ul className={styles.queue}>{pending.map((row) => <ReviewItem key={row.id} row={row} onDone={afterChange} />)}</ul>}
      </section>}

      {detail && <EntryDialog entry={detail} onClose={() => setDetail(undefined)} />}
    </section>
  );
}
