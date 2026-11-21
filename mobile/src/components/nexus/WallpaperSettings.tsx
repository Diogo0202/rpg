import { useRef, useState } from "react";
import { toast } from "sonner";
import { Btn, Panel } from "@/components/nexus/ui";
import { useNexus } from "@/lib/nexus/store";
import type { SheetData } from "@/lib/nexus/sheets";
import { importWallpaper, removeWallpaper, useWallpaper, type WallpaperSlot } from "@/lib/wallpapers";

function WallpaperField({ slot, label, hint }: { slot: WallpaperSlot; label: string; hint: string }) {
  const image = useWallpaper([slot]);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await importWallpaper(slot, file);
      toast.success(`${label}: imagem salva neste aparelho.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível importar a imagem.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async () => {
    try { await removeWallpaper(slot); toast.success(`${label}: imagem removida.`); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível remover a imagem."); }
  };
  return (
    <div className="parchment-inset flex flex-wrap items-center gap-3 p-3">
      <div
        className="size-16 shrink-0 rounded-lg border border-border bg-muted bg-cover bg-center"
        style={image ? { backgroundImage: `url("${image.data}")` } : undefined}
        role={image ? "img" : undefined}
        aria-label={image ? `Prévia: ${label}` : undefined}
      />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{image ? image.name || "Imagem importada" : hint}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" className="hidden" aria-label={`Arquivo: ${label}`} onChange={(e) => void pick(e.target.files?.[0])} />
        <Btn size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Importando…" : image ? "Trocar imagem" : "Importar imagem"}
        </Btn>
        {image && <Btn size="sm" variant="danger" disabled={busy} onClick={() => void remove()}>Remover</Btn>}
      </div>
    </div>
  );
}

export function WallpaperSettings() {
  const { campaignId, campaignName, list } = useNexus();
  const sheets = list<SheetData>("character_sheets").sort((a, b) => a.data.name.localeCompare(b.data.name));
  const [sheetId, setSheetId] = useState("");
  const selected = sheets.find((s) => s.id === sheetId) ?? sheets[0];
  return (
    <Panel title="Wallpaper">
      <p className="mb-3 text-sm text-ink-muted">
        As imagens ficam só neste aparelho. O wallpaper geral aparece nas telas iniciais da Mesa e das Fichas. A foto da mesa substitui o geral na tela Mesa, e a imagem do personagem aparece ao abrir a ficha.
      </p>
      <div className="space-y-2">
        <WallpaperField slot={{ kind: "home" }} label="Wallpaper geral" hint="Telas iniciais da Mesa e das Fichas" />
        <WallpaperField slot={{ kind: "table", campaignId }} label="Foto da mesa" hint={`Campanha ${campaignName}`} />
        {sheets.length ? (
          <>
            <label className="block text-sm font-semibold text-ink">
              Ficha
              <select className="field-input mt-1" value={selected?.id ?? ""} onChange={(e) => setSheetId(e.target.value)}>
                {sheets.map((s) => <option key={s.id} value={s.id}>{s.data.name}</option>)}
              </select>
            </label>
            {selected && <WallpaperField key={selected.id} slot={{ kind: "sheet", campaignId, sheetId: selected.id }} label="Imagem do personagem" hint={selected.data.name} />}
          </>
        ) : <p className="parchment-inset p-3 text-sm text-ink-muted">Crie uma ficha para escolher a imagem do personagem.</p>}
      </div>
    </Panel>
  );
}
