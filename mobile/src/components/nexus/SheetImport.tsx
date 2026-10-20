import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { parseBackupText, type SheetBackup } from "@/lib/sheet-backup.ts";
import { sheetFromBackup } from "@/lib/nexus/sheets";
import { useNexus } from "@/lib/nexus/store";
import type { JsonValue } from "@/lib/mobile-sync/index.ts";
import { Btn } from "./ui";

export function SheetImport({ onImported }: { onImported: (id: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { create, remove } = useNexus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const importDocs = async (docs: SheetBackup[]) => {
    // Validate every document and normalize before creating anything.
    const prepared = docs.map((doc) => ({ doc, sheet: sheetFromBackup(doc) }));
    const created: [string, string][] = [];
    try {
      let first = "";
      for (const { doc, sheet } of prepared) {
        const id = await create("character_sheets", JSON.parse(JSON.stringify(sheet)) as Record<string, JsonValue>);
        created.push(["character_sheets", id]); first ||= id;
        for (const item of doc.inventory ?? []) {
          const itemId = await create("character_inventory", { ...item, sheet_id: id }, { dependsOnEntities: [["character_sheets", id]] });
          created.push(["character_inventory", itemId]);
        }
      }
      toast.success(`${prepared.length} ficha(s) importada(s) neste aparelho.`);
      if (first) onImported(first);
    } catch (e) {
      for (const [type, id] of created.reverse()) await remove(type, id).catch(() => undefined);
      throw e;
    }
  };
  return <div>
    <Btn variant="outline" disabled={busy} onClick={() => input.current?.click()}><Upload className="size-4" aria-hidden />{busy ? "Importando…" : "Importar JSON"}</Btn>
    <input ref={input} type="file" accept="application/json,.json" className="sr-only" aria-label="Arquivo JSON de fichas" onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      setBusy(true); setError("");
      try {
        if (file.size > 50 * 1048576) throw new Error("O arquivo ultrapassa 50 MB.");
        await importDocs(parseBackupText(await file.text()));
      } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível importar."); }
      finally { setBusy(false); }
    }} />
    {error && <p role="alert" className="mt-2 max-w-sm text-sm text-destructive">{error}</p>}
  </div>;
}
