import { ImagePlus } from "lucide-react";
import { useId, useState } from "react";
import { preparePortrait } from "@/lib/nexus/portraits";
import { Btn } from "./ui";

type SheetPortraitProps = {
  src: string | null;
  hasPortrait?: boolean;
  onChange: (value: string | null) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
};

export function SheetPortrait({ src, hasPortrait = Boolean(src), onChange, onBusyChange, disabled }: SheetPortraitProps) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  async function change(file: File | null) {
    setError("");
    setBusy(true);
    onBusyChange?.(true);
    try {
      const data = file ? await preparePortrait(file) : null;
      await onChange(data);
      setFailedSrc(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o retrato.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return <section className="parchment-inset mb-3 flex flex-wrap items-center gap-3 p-3" aria-label="Retrato do personagem">
    <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border">
      {src && src !== failedSrc
        ? <img src={src} className="size-full object-contain" alt="Retrato do personagem" onError={() => setFailedSrc(src)} />
        : <ImagePlus className="size-7 text-ink-muted" aria-hidden />}
    </div>
    <div className="min-w-0 space-y-2">
      <label htmlFor={inputId} className="block text-sm font-semibold text-ink">Foto do personagem (opcional)</label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="block w-full text-sm text-ink"
        disabled={disabled || busy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void change(file);
        }}
      />
      {hasPortrait && <Btn variant="outline" size="sm" disabled={disabled || busy} onClick={() => void change(null)}>Remover retrato</Btn>}
      {busy && <p className="text-sm text-ink-muted" role="status">Atualizando retrato…</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  </section>;
}
