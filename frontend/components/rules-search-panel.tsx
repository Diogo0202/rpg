"use client";

import { FormEvent, useState } from "react";

import { createClient } from "../lib/supabase/client";

type SearchResult = {
  source_id: string;
  source_title: string;
  page_number: number;
  excerpt: string;
  rank: number;
};

export function RulesSearchPanel({ campaignId }: { campaignId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2 || trimmed.length > 160) {
      setMessage("Escreva entre 2 e 160 caracteres.");
      return;
    }
    const api = process.env.NEXT_PUBLIC_API_URL;
    if (!api) {
      setMessage("Configure NEXT_PUBLIC_API_URL para buscar nas fontes da campanha.");
      return;
    }
    setBusy(true);
    setMessage("");
    setResults([]);
    try {
      const { data, error } = await createClient().auth.getSession();
      if (error || !data.session) throw new Error("Entre na sua conta para consultar as regras.");
      const params = new URLSearchParams({ q: trimmed, limit: "5" });
      const response = await fetch(`${api}/api/v1/campaigns/${campaignId}/rules/search?${params}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      if (!response.ok) throw new Error(response.status === 403 ? "Esta campanha não permite a consulta." : "A busca falhou. Confira a API e tente novamente.");
      const rows = await response.json() as SearchResult[];
      setResults(rows);
      if (rows.length === 0) setMessage("Nenhum trecho aprovado corresponde à busca.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "A busca falhou.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content rules-search" aria-labelledby="rules-search-title">
      <div className="rules-search-intro">
        <p className="eyebrow">FONTES DA CAMPANHA</p>
        <h2 id="rules-search-title">Buscar regras com página de origem</h2>
        <p>Os resultados vêm dos trechos autorizados, concedidos à campanha e associados a um modelo aprovado.</p>
        <form onSubmit={search} className="rules-search-form">
          <label htmlFor="rules-query">Termos da busca</label>
          <input id="rules-query" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={160} placeholder="Ex.: Frenesi com Fome 3" />
          <button className="primary" disabled={busy} type="submit">{busy ? "Buscando..." : "Buscar"}</button>
        </form>
        <p className="notice">Busca por texto. A resposta por IA e a ingestão de PDF ainda estão em desenvolvimento.</p>
      </div>
      <div className="rules-results" aria-live="polite">
        {message && <p>{message}</p>}
        {results.map((result) => (
          <article key={`${result.source_id}-${result.page_number}-${result.excerpt}`} className="rules-result">
            <h3>{result.source_title} <small>p. {result.page_number}</small></h3>
            <p>{result.excerpt}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
