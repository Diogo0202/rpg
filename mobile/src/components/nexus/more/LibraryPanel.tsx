import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { SheetImport } from "@/components/nexus/SheetImport";
import { Panel } from "@/components/nexus/ui";
import type { JsonValue } from "@/lib/mobile-sync";
import { useNexus } from "@/lib/nexus/store";
import { campaignLibrary, localLibrary } from "./more-model";

export function LibraryPanel() {
  const { mode, list } = useNexus();
  const [imported, setImported] = useState("");
  const connected = mode === "connected";
  const templates = connected ? campaignLibrary(list<Record<string, JsonValue>>("system_templates")) : localLibrary();
  return (
    <Panel title="Biblioteca">
      <p className="mb-3 text-sm text-ink-muted">
        {connected ? "Modelos aprovados disponíveis nesta campanha." : "Modelos-base parciais disponíveis neste aparelho."}
      </p>
      {templates.length ? (
        <ul className="mb-4 grid gap-2 sm:grid-cols-3">
          {templates.map((template) => (
            <li key={template.id} className="parchment-inset p-3">
              <p className="font-semibold text-ink">{template.name}</p>
              <p className="text-xs text-ink-muted">Sistema: {template.system}</p>
              <p className="text-xs text-ink-muted">{connected ? "Aprovado" : "Modelo local"} · versão {template.version}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="parchment-inset mb-4 p-3 text-sm text-ink-muted">Nenhum modelo aprovado disponível nesta campanha.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SheetImport onImported={setImported} />
        {imported && (
          <Link className="text-sm font-semibold text-ink underline" to="/fichas" search={{ ficha: imported }}>
            Abrir ficha importada
          </Link>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {connected
          ? "A criação de fichas continua sujeita à validação do modelo aprovado no servidor."
          : "Os perfis locais são parciais e não incluem regras oficiais completas. Consulte as fontes oficiais do sistema."}
      </p>
    </Panel>
  );
}
