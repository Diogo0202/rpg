import { useState } from "react";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";
import { computeFormulas, downloadJson, exportSheet, focusSheetError, prepareSheetValues, slug, templateFor, type InventoryData, type SheetData } from "@/lib/nexus/sheets";
import { characterNameField, reconcileDependentValues } from "@/lib/sheet-creation.ts";
import type { FieldValue } from "@/lib/sheet-template.ts";
import { useNexus, type Entity } from "@/lib/nexus/store";
import { FieldInput } from "./FieldInput";
import { InventoryEditor } from "./InventoryEditor";
import { Btn, Panel } from "./ui";

export function SheetEditor({ sheet }: { sheet: Entity<SheetData> }) {
  const { update, list } = useNexus();
  const template = templateFor(sheet.data);
  const [values, setValues] = useState({ ...sheet.data.values });
  const [name, setName] = useState(sheet.data.name);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const formulas = computeFormulas(template, values);
  const prepared = () => {
    const result = prepareSheetValues(template, values, name);
    setErrors(result.errors); focusSheetError("edit", result.errors);
    return Object.keys(result.errors).length ? null : result;
  };
  return <div className="space-y-4">
    <form onSubmit={async (event) => {
      event.preventDefault(); const result = prepared(); if (!result) return;
      setBusy(true);
      try {
        await update("character_sheets", sheet.id, [{ path: ["name"], value: result.name }, { path: ["values"], value: result.values }]);
        setValues(result.values); setName(result.name); toast.success("Ficha salva neste aparelho.");
      } catch(e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar."); }
      finally { setBusy(false); }
    }}>
      <Panel title={sheet.data.template_name} actions={<><Btn variant="outline" onClick={() => {
        const result = prepared(); if (!result) return;
        try { downloadJson(`${slug(result.name)}.json`, exportSheet({ ...sheet.data, ...result }, list<InventoryData>("character_inventory").filter((i) => i.data.sheet_id === sheet.id).map((i) => i.data))); }
        catch(e) { toast.error(e instanceof Error ? e.message : "Exportação inválida."); }
      }}><Download className="size-4" aria-hidden />Exportar JSON</Btn><Btn type="submit" disabled={busy}><Save className="size-4" aria-hidden />{busy ? "Salvando…" : "Salvar ficha"}</Btn></>}>
        {removed.length > 0 && <p role="status" className="mb-3 text-sm text-ink">Escolhas incompatíveis removidas: {removed.join(", ")}. Revise.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {!characterNameField(template) && <label className="text-sm font-semibold text-ink">Nome da ficha<input id="edit-__name" className="field-input mt-1" value={name} maxLength={120} aria-invalid={!!errors.__name} onChange={(e) => setName(e.target.value)} />{errors.__name && <span className="text-destructive">{errors.__name}</span>}</label>}
          {template.fields.map((field) => <FieldInput key={field.id} template={template} field={field} values={values} formula={formulas[field.id]} error={errors[field.id]} idPrefix="edit" onChange={(id, value: FieldValue | undefined) => {
            const next = { ...values }; if (value === undefined) delete next[id]; else next[id] = value;
            const result = reconcileDependentValues(template, next);
            setRemoved(result.removedIds.filter((key) => values[key] !== undefined && result.values[key] === undefined));
            setValues(result.values); setErrors({});
          }} />)}
        </div>
      </Panel>
    </form>
    <InventoryEditor sheetId={sheet.id} />
  </div>;
}
