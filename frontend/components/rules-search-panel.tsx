"use client";

import { FormEvent, ReactNode, useId, useRef, useState } from "react";

import { sessionJson, type SessionMessages } from "../lib/api/session";
import styles from "./rules-search-panel.module.css";

type SearchResult = {
  source_id: string;
  source_title: string;
  page_number: number;
  excerpt: string;
  rank: number;
};

type RulePage = {
  source_id: string;
  source_title: string;
  page_number: number;
  content: string;
};

type PageState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "ready"; key: string; page: RulePage }
  | { status: "error"; key: string; message: string };

type StepState = "pending" | "partial";

// Mirrors RAG-06 to RAG-09 in STATUS_FUNCIONALIDADES.md; update both together.
const ASSISTANT_STEPS: { label: string; state: StepState; detail: string }[] = [
  { label: "Envio de PDF", state: "pending", detail: "Validação do arquivo e quarentena" },
  { label: "Leitura por página", state: "pending", detail: "Texto, OCR e trechos com página de origem" },
  { label: "Busca semântica", state: "partial", detail: "Coluna de vetores pronta; falta gerar os embeddings" },
  { label: "Respostas por IA", state: "pending", detail: "Cada resposta cita as páginas conferidas" },
];

const STEP_LABEL: Record<StepState, string> = { pending: "Não iniciado", partial: "Em parte" };

function resultKey(result: { source_id: string; page_number: number }) {
  return `${result.source_id}:${result.page_number}`;
}

function highlight(text: string, query: string): ReactNode[] {
  const terms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return [text];
  const pattern = new RegExp(`(${terms.join("|")})`, "gi");
  return text.split(pattern).map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part));
}

function rulesGet<T>(path: string, messages: SessionMessages): Promise<T> {
  return sessionJson<T>(path, {}, {
    missingApi: "Configure NEXT_PUBLIC_API_URL para consultar as fontes da campanha.",
    signedOut: "Entre na sua conta para consultar as regras.",
    useDetail: false,
    ...messages,
  });
}

export function RulesSearchPanel({ campaignId }: { campaignId: string }) {
  const uid = useId();
  const pageRequest = useRef(0);
  const [query, setQuery] = useState("");
  const [searchedFor, setSearchedFor] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<PageState>({ status: "idle" });

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed.length > 160) {
      setMessage("Escreva entre 2 e 160 caracteres.");
      return;
    }
    setBusy(true);
    setMessage("");
    setResults([]);
    setPage({ status: "idle" });
    pageRequest.current += 1;
    try {
      const params = new URLSearchParams({ q: trimmed, limit: "5" });
      const failed = "A busca falhou. Confira a API e tente novamente.";
      const rows = await rulesGet<SearchResult[]>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/rules/search?${params}`, {
        status: { 403: "Esta campanha não permite a consulta." }, unavailable: failed, rejected: failed,
      });
      setResults(rows);
      setSearchedFor(trimmed);
      if (rows.length === 0) setMessage(`Nenhum trecho aprovado menciona “${trimmed}”.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "A busca falhou.");
    } finally {
      setBusy(false);
    }
  }

  async function openPage(result: SearchResult) {
    const key = resultKey(result);
    const request = ++pageRequest.current;
    setPage({ status: "loading", key });
    try {
      const failed = "Não foi possível abrir a página.";
      const data = await rulesGet<RulePage>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/sources/${result.source_id}/pages/${result.page_number}`, {
        status: { 404: "Esta página não está aprovada nesta campanha." }, unavailable: failed, rejected: failed,
      });
      if (request === pageRequest.current) setPage({ status: "ready", key, page: data });
    } catch (error) {
      if (request === pageRequest.current) setPage({ status: "error", key, message: error instanceof Error ? error.message : "Não foi possível abrir a página." });
    }
  }

  const openKey = page.status === "idle" ? null : page.key;
  const openResult = results.find((result) => resultKey(result) === openKey);
  const resultLine = results.length > 0
    ? `${results.length} ${results.length === 1 ? "trecho" : "trechos"} para “${searchedFor}”, do mais relevante ao menos.`
    : "Trechos de fontes autorizadas e concedidas à campanha, sempre com a página de origem.";

  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`}>
      <header className={styles.header}>
        <h2 id={`${uid}-title`}>Buscar nas regras</h2>
        <p className={styles.subline}>{resultLine}</p>
      </header>

      <form onSubmit={search} className={styles.searchForm} role="search">
        <label className={styles.label} htmlFor={`${uid}-query`}>Termos da busca</label>
        <div className={styles.inputRow}>
          <input
            id={`${uid}-query`}
            className={styles.input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={160}
            placeholder="Ex.: Frenesi com Fome 3"
            aria-describedby={`${uid}-message`}
          />
          <button className={styles.primaryButton} disabled={busy} type="submit">{busy ? "Buscando…" : "Buscar"}</button>
        </div>
      </form>

      <p className={styles.status} id={`${uid}-message`} role="status" aria-live="polite">{message}</p>

      <div className={styles.layout}>
        <div className={styles.results} aria-busy={busy}>
          <h3 className={styles.blockTitle}>Trechos</h3>
          {busy ? (
            <ul className={styles.list} aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <li className={styles.result} key={row}>
                  <span className={styles.skeletonTitle} />
                  <span className={styles.skeletonLine} />
                  <span className={styles.skeletonLine} />
                </li>
              ))}
            </ul>
          ) : results.length > 0 ? (
            <ul className={styles.list}>
              {results.map((result) => {
                const key = resultKey(result);
                const open = key === openKey;
                return (
                  <li className={`${styles.result} ${open ? styles.resultOpen : ""}`} key={`${key}-${result.excerpt}`}>
                    <div className={styles.resultHeader}>
                      <span className={styles.sourceTitle}>{result.source_title}</span>
                      <span className={styles.pageNumber}>p. {result.page_number}</span>
                    </div>
                    <p className={styles.excerpt}>{highlight(result.excerpt, searchedFor)}</p>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      aria-pressed={open}
                      aria-controls={`${uid}-reader`}
                      onClick={() => void openPage(result)}
                    >
                      {open ? "Página aberta" : "Abrir página"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={styles.emptyBox}>
              {searchedFor ? "Tente outro termo, ou o nome exato de uma regra ou disciplina." : "Busque um termo para ver os trechos e a página de cada um."}
            </p>
          )}
        </div>

        <article className={styles.reader} id={`${uid}-reader`} aria-live="polite" aria-busy={page.status === "loading"}>
          {page.status === "ready" ? (
            <>
              <header className={styles.readerHeader}>
                <h3>{page.page.source_title}</h3>
                <span className={styles.pageNumber}>Página {page.page.page_number}</span>
              </header>
              <div className={styles.pageText}>{highlight(page.page.content, searchedFor)}</div>
            </>
          ) : page.status === "loading" ? (
            <>
              <header className={styles.readerHeader}>
                <h3>{openResult?.source_title ?? "Abrindo página"}</h3>
                {openResult && <span className={styles.pageNumber}>Página {openResult.page_number}</span>}
              </header>
              <div className={styles.pageText} aria-hidden="true">
                {[92, 100, 86, 97, 64].map((width) => <span className={styles.skeletonLine} style={{ width: `${width}%` }} key={width} />)}
              </div>
            </>
          ) : page.status === "error" ? (
            <div className={styles.errorBox}>
              <p>{page.message}</p>
              {openResult && <button type="button" className={styles.textButton} onClick={() => void openPage(openResult)}>Tentar de novo</button>}
            </div>
          ) : (
            <div className={styles.readerEmpty}>
              <h3>Página de origem</h3>
              <p>Abra um trecho para ler a página inteira do livro, com os termos da busca marcados.</p>
            </div>
          )}
        </article>
      </div>

      <section className={styles.assistant} aria-labelledby={`${uid}-assistant`}>
        <div className={styles.assistantMain}>
          <div className={styles.assistantHeader}>
            <h3 id={`${uid}-assistant`}>Perguntar ao assistente</h3>
            <span className={styles.statePill}>Indisponível</span>
          </div>
          <p className={styles.assistantText}>
            O assistente vai responder perguntas de regras e lore citando as páginas que usou. Ele abre quando os PDFs da campanha estiverem lidos e indexados.
          </p>
          <div className={styles.composer}>
            <label className={styles.label} htmlFor={`${uid}-question`}>Pergunta</label>
            <textarea
              id={`${uid}-question`}
              className={styles.input}
              rows={2}
              disabled
              placeholder="Ex.: Quanto de Fome custa usar Celeridade?"
              aria-describedby={`${uid}-assistant-why`}
            />
            <p className={styles.help} id={`${uid}-assistant-why`}>Enquanto isso, a busca acima mostra o texto exato e a página.</p>
          </div>
        </div>
        <ol className={styles.steps} aria-label="O que falta para o assistente">
          {ASSISTANT_STEPS.map((step) => (
            <li className={styles.step} key={step.label}>
              <div>
                <span className={styles.stepLabel}>{step.label}</span>
                <span className={styles.stepDetail}>{step.detail}</span>
              </div>
              <span className={`${styles.stepState} ${step.state === "partial" ? styles.stepPartial : ""}`}>{STEP_LABEL[step.state]}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
