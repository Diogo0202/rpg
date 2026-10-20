import { useState } from "react";
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createSheetBackup, type BackupInventoryItem } from "@/lib/sheet-backup.ts";
import { INVENTORY_CATEGORIES, type InventoryData } from "@/lib/nexus/sheets";
import { useNexus } from "@/lib/nexus/store";
import { Btn, Empty, Panel } from "./ui";

const blank: BackupInventoryItem = { name: "", category: "equipment", quantity: 1, resource_cost: 0, damage_bonus: 0, protection: 0, notes: "", acquired: true, equipped: false, sort_order: 0 };

export function InventoryEditor({ sheetId }: { sheetId: string }) {
  const { list, create, update, remove } = useNexus();
  const items = list<InventoryData>("character_inventory").filter((item) => item.data.sheet_id === sheetId).sort((a,b) => a.data.sort_order - b.data.sort_order);
  const [draft, setDraft] = useState<BackupInventoryItem | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof BackupInventoryItem>(key: K, value: BackupInventoryItem[K]) => setDraft((d) => d ? { ...d, [key]: value } : null);
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      const candidate = { ...draft, name: draft.name.trim() };
      const all = items.filter((item) => item.id !== editing).map(({data: {sheet_id, ...item}}) => item);
      // Reuse the exact inventory contract without implementing parallel validation.
      createSheetBackup({ name: "Inventário", template: { name: "Validação", version: 1, fields: [{ id: "nome", label: "Nome", kind: "text", required: false, options: [], expression: null }] }, values: {}, effects: [], inventory: [...all, candidate] });
      if (editing) await update("character_inventory", editing, Object.entries(candidate).map(([key, value]) => ({ path: [key], value })));
      else await create("character_inventory", { ...candidate, sheet_id: sheetId }, { dependsOnEntities: [["character_sheets", sheetId]] });
      setDraft(null); setEditing(null); toast.success("Item salvo neste aparelho.");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  };
  return <Panel title="Inventário" actions={<Btn variant="outline" onClick={() => { setEditing(null); setError(""); setDraft({ ...blank, sort_order: items.length }); }}><Plus className="size-4" aria-hidden />Adicionar item</Btn>}>
    {items.length === 0 ? <Empty>Nenhum item.</Empty> : <ul className="divide-y divide-border">
      {items.map((item) => <li key={item.id} className="flex items-center justify-between gap-2 py-3">
        <div className="min-w-0"><p className="break-words font-semibold text-ink">{item.data.name} × {item.data.quantity}</p><p className="text-xs text-ink-muted">{INVENTORY_CATEGORIES.find((c) => c.id === item.data.category)?.label} · {item.data.equipped ? "Equipado" : item.data.acquired ? "Adquirido" : "Não adquirido"}</p></div>
        <div className="flex shrink-0"><Btn size="icon" variant="ghost" className="w-11" aria-label={`Editar ${item.data.name}`} title="Editar item" onClick={() => { const {sheet_id, ...data} = item.data; setDraft(data); setEditing(item.id); setError(""); }}><Pencil className="size-4" /></Btn>
        <Btn size="icon" variant="ghost" className="w-11" aria-label={`Excluir ${item.data.name}`} title="Excluir item" onClick={async () => { if (!window.confirm(`Excluir ${item.data.name}?`)) return; try { await remove("character_inventory", item.id); } catch(e) { toast.error(e instanceof Error ? e.message : "Falha ao excluir."); } }}><Trash2 className="size-4" /></Btn></div>
      </li>)}
    </ul>}
    {draft && <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-ink">Nome do item<input autoFocus className="field-input mt-1" value={draft.name} maxLength={160} required onChange={(e) => set("name", e.target.value)} /></label>
        <label className="text-sm font-semibold text-ink">Categoria<select className="field-input mt-1" value={draft.category} onChange={(e) => { set("category", e.target.value as BackupInventoryItem["category"]); set("equipped", false); }}>{INVENTORY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        {([ ["quantity", "Quantidade", 1, 999], ["resource_cost", "Custo em recursos", 0, 10], ["damage_bonus", "Bônus de dano", 0, 10], ["protection", "Proteção", 0, 10], ["sort_order", "Ordem", 0, 9999] ] as const).map(([key, label, min, max]) => <label key={key} className="text-sm font-semibold text-ink">{label}<input type="number" className="field-input mt-1" min={min} max={max} step={1} required value={draft[key]} onChange={(e) => set(key, Number(e.target.value))} /></label>)}
      </div>
      <label className="block text-sm font-semibold text-ink">Observações<textarea className="field-input mt-1" value={draft.notes} maxLength={4000} onChange={(e) => set("notes", e.target.value)} /></label>
      <div className="flex flex-wrap gap-4">
        <label className="tap flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={draft.acquired} onChange={(e) => { set("acquired", e.target.checked); if (!e.target.checked) set("equipped", false); }} />Adquirido</label>
        <label className="tap flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={draft.equipped} disabled={!draft.acquired || !["weapon", "armor"].includes(draft.category)} onChange={(e) => set("equipped", e.target.checked)} />Equipado</label>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Btn type="submit" disabled={busy}>Salvar item</Btn><Btn variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Cancelar</Btn></div>
    </form>}
  </Panel>;
}
