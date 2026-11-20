import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useState } from "react";
import { toast } from "sonner";
import { ConnectionPanel } from "@/components/nexus/ConnectionPanel";
import { Btn, Panel } from "@/components/nexus/ui";
import { outboxSummary, useNexus } from "@/lib/nexus/store";
import { readThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme";

const THEMES: Array<{ mode: ThemeMode; label: string }> = [
  { mode: "standard", label: "Padrão" },
  { mode: "dark", label: "Escuro" },
  { mode: "hunter", label: "Caçador" },
  { mode: "demon-lord", label: "Demon Lord" },
];

const errorMessage = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

/** Pede ao navegador que baixe o JSON; o clique não confirma que o arquivo foi gravado. */
function downloadJson(data: unknown, fileName: string) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function ThemePanel() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const changeTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    if (!saveThemeMode(mode)) toast.error("O tema mudou, mas a preferência não pôde ser salva.");
  };
  return (
    <Panel title="Aparência">
      <p className="mb-3 text-sm text-ink-muted">Escolha as cores do aplicativo neste aparelho.</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Tema do aplicativo">
        {THEMES.map((theme) => (
          <Btn key={theme.mode} variant={themeMode === theme.mode ? "forest" : "outline"} aria-pressed={themeMode === theme.mode} onClick={() => changeTheme(theme.mode)}>
            {theme.label}
          </Btn>
        ))}
      </div>
    </Panel>
  );
}

function ConfirmClearDialog({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
  return (
    <AlertDialog.Portal>
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none">
        <AlertDialog.Title className="text-lg font-semibold">Apagar cópias locais?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-sm text-ink-muted">
          Esta ação remove todas as campanhas desta conta neste aparelho, incluindo operações pendentes. O contador e a exportação acima cobrem somente a campanha aberta. Exporte cada fila que deseja preservar antes de confirmar; o clique de exportação não confirma que o navegador gravou o arquivo.
        </AlertDialog.Description>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <AlertDialog.Cancel asChild>
            <Btn type="button" variant="outline" disabled={busy}>Cancelar</Btn>
          </AlertDialog.Cancel>
          <AlertDialog.Action asChild>
            <Btn type="button" variant="danger" disabled={busy} onClick={onConfirm}>Confirmar e apagar</Btn>
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  );
}

export function SettingsPanel() {
  const { state, engine, wipeLocal, refresh, ready } = useNexus();
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const summary = outboxSummary(state);

  const backup = async () => {
    if (!engine) return;
    downloadJson(await engine.exportPendingDrafts(), `rpg-atlas-pendencias-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const clear = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await wipeLocal();
      await refresh();
      toast.success("Cópias locais da conta apagadas neste aparelho.");
    } catch (caught) {
      toast.error(errorMessage(caught, "Falha na operação local."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root open={confirmClear} onOpenChange={setConfirmClear}>
      <div className="space-y-4">
        <ConnectionPanel />
        <ThemePanel />
        <Panel title="Backup e limpeza">
          <p className="mb-3 text-sm text-ink">
            Há {summary.total} operação(ões) pendentes na campanha aberta. A exportação solicita ao navegador um arquivo JSON desta fila.
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn variant="outline" disabled={!engine} onClick={() => void backup().catch((caught) => toast.error(errorMessage(caught, "Falha ao exportar.")))}>
              Exportar pendências da campanha aberta
            </Btn>
            <AlertDialog.Trigger asChild>
              <Btn variant="danger" disabled={!ready || busy}>{busy ? "Aguarde…" : "Apagar cópias locais"}</Btn>
            </AlertDialog.Trigger>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Dados confirmados no servidor permanecem na campanha. Pendências exportadas usam um formato próprio de recuperação da fila.
          </p>
        </Panel>
      </div>
      <ConfirmClearDialog busy={busy} onConfirm={() => { setConfirmClear(false); void clear(); }} />
    </AlertDialog.Root>
  );
}
