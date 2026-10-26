"use client";

import { useEffect, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { diffSheetVersions, listSheetVersions, restoreSheetVersion, type SheetVersion } from "../lib/sheet-history";
import type { SheetTemplate } from "../lib/sheet-template";

async function sessionToken(): Promise<{ api: string; token: string }> {
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (!api) throw new Error("A API de fichas não está configurada.");
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error("Entre na campanha para ver o histórico.");
  return { api, token: data.session.access_token };
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** FIC-18: lista as versões guardadas da ficha, mostra a diferença e restaura. */
export function SheetVersionHistory({ sheetId, sheetVersion, template, viewerId, canRestore, busy, onRestored }: {
  sheetId: string;
  sheetVersion: number;
  template: SheetTemplate;
  viewerId: string;
  canRestore: boolean;
  busy: boolean;
  onRestored: (sheet: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<SheetVersion[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    sessionToken()
      .then(({ api, token }) => listSheetVersions(api, token, sheetId))
      .then((items) => { if (active) { setVersions(items); setSelected((current) => items.some((item) => item.version === current) ? current : null); } })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Não foi possível carregar o histórico."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, sheetId, sheetVersion]);

  const labels = Object.fromEntries(template.fields.map((field) => [field.id, field.label]));
  const latest = versions[0];
  const chosen = versions.find((item) => item.version === selected);
  const changes = chosen && latest ? diffSheetVersions(latest, chosen, labels) : [];

  async function restore() {
    if (!chosen || restoring || busy) return;
    setRestoring(true);
    setMessage("");
    try {
      const { api, token } = await sessionToken();
      const sheet = await restoreSheetVersion(api, token, sheetId, chosen.version, sheetVersion);
      setMessage(`Versão ${chosen.version} restaurada como versão ${String(sheet.version)}.`);
      setSelected(null);
      onRestored(sheet);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível restaurar a versão.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <article className="sheet-template-card">
      <div className="sheet-template-heading">
        <div>
          <p className="eyebrow">HISTÓRICO DA FICHA</p>
          <h2>Versões anteriores</h2>
        </div>
        <button className="quiet" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          {open ? "Ocultar histórico" : "Ver histórico"}
        </button>
      </div>
      {open ? <>
        <p>As últimas 50 alterações de nome e valores ficam guardadas. Restaurar grava a versão escolhida como uma nova versão.</p>
        {loading ? <p className="sheet-feedback">Carregando versões…</p> : null}
        {!loading && versions.length === 0 && !message ? <p className="sheet-feedback">Nenhuma versão guardada ainda.</p> : null}
        <ol className="sheet-version-list" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {versions.map((item, index) => (
            <li key={item.id}>
              <button className={item.version === selected ? "primary" : "quiet"} type="button" aria-pressed={item.version === selected}
                style={{ width: "100%", textAlign: "left" }}
                onClick={() => setSelected(item.version === selected ? null : item.version)}>
                v{item.version} · {dateFormat.format(new Date(item.created_at))} · {item.author_id === viewerId ? "você" : item.author_name ?? "participante da campanha"}
                {index === 0 ? " · mais recente" : ""}
                {item.restored_from ? ` · restaurada da v${item.restored_from}` : ""}
              </button>
            </li>
          ))}
        </ol>
        {chosen && latest && chosen.version !== latest.version ? <div>
          <h3>Diferença da v{chosen.version} para a versão mais recente (v{latest.version})</h3>
          {changes.length === 0 ? <p className="sheet-feedback">Os valores são iguais aos da versão mais recente.</p> : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th scope="col" align="left">Campo</th><th scope="col" align="left">Atual (v{latest.version})</th><th scope="col" align="left">Na v{chosen.version}</th></tr></thead>
              <tbody>{changes.map((change) => (
                <tr key={change.fieldId}><td>{change.label}</td><td>{change.before}</td><td>{change.after}</td></tr>
              ))}</tbody>
            </table>
          )}
          {canRestore ? <div className="actions">
            <button className="primary" type="button" disabled={busy || restoring || changes.length === 0} onClick={restore}>
              {restoring ? "Restaurando…" : `Restaurar a v${chosen.version}`}
            </button>
          </div> : <p className="sheet-feedback">Seu papel permite apenas consultar o histórico.</p>}
        </div> : null}
        {chosen && latest && chosen.version === latest.version ? <p className="sheet-feedback">Esta é a versão mais recente da ficha.</p> : null}
        {message ? <p className="sheet-feedback" role="status">{message}</p> : null}
      </> : null}
    </article>
  );
}
