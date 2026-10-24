import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { BookOpen, Bot, Library, Music2, Settings } from "lucide-react";
import { toast } from "sonner";
import { SheetImport } from "@/components/nexus/SheetImport";
import { ConnectionPanel } from "@/components/nexus/ConnectionPanel";
import { Btn, Empty, LocalGate, PageHeader, Panel, Tag } from "@/components/nexus/ui";
import { useNexus, outboxSummary } from "@/lib/nexus/store";
import { SYSTEM_STARTERS } from "@/lib/system-starters";
import type { JsonValue } from "@/lib/mobile-sync";
import { readThemeMode, saveThemeMode, type ThemeMode } from "@/lib/theme";

export const Route = createFileRoute("/mais")({
  head: () => ({
    meta: [
      { title: "Mais — RPG-Atlas Mobile" },
      { name: "description", content: "Diário, música, biblioteca e ajustes locais." },
      { property: "og:title", content: "Mais — RPG-Atlas Mobile" },
      { property: "og:description", content: "Diário, música, biblioteca e ajustes locais." },
    ],
  }),
  component: MaisRouteLayout,
});

type MusicLink = { title: string; url: string };
type Section = "inicio" | "music" | "library" | "assistant" | "settings";
const NAV_ITEMS: { id: Section; label: string; icon: typeof BookOpen }[] = [
  { id: "inicio", label: "Mais", icon: BookOpen },
  { id: "music", label: "Música", icon: Music2 },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "assistant", label: "Assistente", icon: Bot },
  { id: "settings", label: "Configurações", icon: Settings },
];
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "spotify.link"]);

function spotifyUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" &&
      SPOTIFY_HOSTS.has(url.hostname.toLowerCase()) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function MaisRouteLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      {pathname === "/mais" && <MaisHome />}
      <Outlet />
    </>
  );
}

function MaisHome() {
  const [section, setSection] = useState<Section>("inicio");
  return (
    <LocalGate>
      <PageHeader title="Mais" subtitle="Recursos salvos neste aparelho" />
      <nav aria-label="Recursos adicionais" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <Btn
            key={id}
            variant={section === id ? "ink" : "outline"}
            className={section === id ? undefined : "parchment text-ink"}
            onClick={() => setSection(id)}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Btn>
        ))}
        <Link
          to="/mais/diario"
          className="tap parchment col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ink/30 text-sm font-semibold text-ink sm:col-span-5"
        >
          <BookOpen className="size-4" aria-hidden />
          Abrir Diário
        </Link>
      </nav>
      {section === "inicio" && (
        <Panel title="Atalhos">
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              className="tap rounded-lg border border-border p-3 font-semibold text-ink"
              to="/mais/diario"
            >
              Diário{" "}
              <span className="block text-sm font-normal text-ink-muted">
                Sessões e anotações locais
              </span>
            </Link>
            <button
              className="tap rounded-lg border border-border p-3 text-left font-semibold text-ink"
              onClick={() => setSection("music")}
            >
              Música{" "}
              <span className="block text-sm font-normal text-ink-muted">
                Links Spotify sem login
              </span>
            </button>
            <button
              className="tap rounded-lg border border-border p-3 text-left font-semibold text-ink"
              onClick={() => setSection("library")}
            >
              Biblioteca{" "}
              <span className="block text-sm font-normal text-ink-muted">
                Modelos e importação de fichas
              </span>
            </button>
            <button
              className="tap rounded-lg border border-border p-3 text-left font-semibold text-ink"
              onClick={() => setSection("assistant")}
            >
              Assistente{" "}
              <span className="block text-sm font-normal text-ink-muted">Estado da conexão</span>
            </button>
            <button
              className="tap rounded-lg border border-border p-3 text-left font-semibold text-ink sm:col-span-2"
              onClick={() => setSection("settings")}
            >
              Configurações{" "}
              <span className="block text-sm font-normal text-ink-muted">
                Conexão, backup e dados locais
              </span>
            </button>
          </div>
        </Panel>
      )}
      {section === "music" && <MusicPanel />}
      {section === "library" && <LibraryPanel />}
      {section === "assistant" && (
        <Panel title="Assistente">
          <Tag tone="warn">Desconectado</Tag>
          <p className="mt-3 text-sm text-ink">
            Nenhum serviço de IA está ligado a esta prévia. Esta tela não envia texto a um servidor.
          </p>
        </Panel>
      )}
      {section === "settings" && <SettingsPanel />}
    </LocalGate>
  );
}

function MusicPanel() {
  const { list, create, update, remove } = useNexus();
  const links = list<MusicLink>("music_links");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const reset = () => {
    setTitle("");
    setUrl("");
    setEditing(null);
    setError("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const safeUrl = spotifyUrl(url);
    if (!title.trim() || title.trim().length > 120) {
      setError("Informe um título de até 120 caracteres.");
      return;
    }
    if (!safeUrl) {
      setError("Use um link HTTPS de open.spotify.com ou spotify.link.");
      return;
    }
    try {
      const data = { title: title.trim(), url: safeUrl } as Record<string, JsonValue>;
      if (editing)
        await update(
          "music_links",
          editing,
          Object.entries(data).map(([key, value]) => ({ path: [key], value })),
        );
      else await create("music_links", data);
      toast.success("Link salvo neste aparelho.");
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar link.");
    }
  };
  return (
    <div className="space-y-4">
      <Panel title="Música">
        <p className="mb-3 text-sm text-ink-muted">
          Cadastre links públicos do Spotify. Não há OAuth nem reprodução integrada.
        </p>
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => void save(e)}>
          <label className="text-sm font-semibold text-ink">
            Título
            <input
              className="field-input mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label className="text-sm font-semibold text-ink">
            Link Spotify
            <input
              className="field-input mt-1"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://open.spotify.com/..."
              required
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Btn type="submit">{editing ? "Salvar edição" : "Adicionar link"}</Btn>
            {editing && (
              <Btn variant="outline" onClick={reset}>
                Cancelar
              </Btn>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
        </form>
      </Panel>
      {!links.length ? (
        <Empty>Nenhum link cadastrado.</Empty>
      ) : (
        <ul className="grid gap-2">
          {links.map((item) => (
            <li key={item.id}>
              <Panel>
                <p className="font-semibold text-ink">{item.data.title}</p>
                <a
                  href={spotifyUrl(item.data.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm text-ink underline"
                >
                  Abrir no Spotify
                </a>
                <div className="mt-3 flex gap-2">
                  <Btn
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(item.id);
                      setTitle(item.data.title);
                      setUrl(item.data.url);
                    }}
                  >
                    Editar
                  </Btn>
                  <Btn
                    size="sm"
                    variant="danger"
                    onClick={() =>
                      void remove("music_links", item.id)
                        .then(() => toast.success("Link removido."))
                        .catch((e) =>
                          toast.error(e instanceof Error ? e.message : "Falha ao remover."),
                        )
                    }
                  >
                    Excluir
                  </Btn>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LibraryPanel() {
  const { mode, list } = useNexus();
  const [imported, setImported] = useState("");
  const templates =
    mode === "local"
      ? SYSTEM_STARTERS.map((starter) => ({
          id: starter.id,
          name: starter.label,
          version: starter.template.version,
          system: starter.label,
        }))
      : list<Record<string, JsonValue>>("system_templates")
          .filter(
            (row) =>
              row.data.status === "approved" &&
              typeof row.data.name === "string" &&
              row.data.name.trim().length > 0 &&
              typeof row.data.version === "number" &&
              Number.isSafeInteger(row.data.version) &&
              row.data.version >= 1,
          )
          .map((row) => {
            const schema = row.data.schema;
            const systemKey =
              schema && typeof schema === "object" && !Array.isArray(schema)
                ? (schema as Record<string, JsonValue>).system_key
                : undefined;
            const knownSystem =
              typeof systemKey === "string"
                ? SYSTEM_STARTERS.find((starter) => starter.id === systemKey)?.label
                : undefined;
            return {
              id: row.id,
              name: row.data.name as string,
              version: row.data.version as number,
              system:
                knownSystem ??
                (typeof systemKey === "string" && systemKey.trim()
                  ? systemKey
                  : "Sistema não informado"),
            };
          });
  return (
    <Panel title="Biblioteca">
      <p className="mb-3 text-sm text-ink-muted">
        {mode === "connected"
          ? "Modelos aprovados disponíveis nesta campanha."
          : "Modelos-base parciais disponíveis neste aparelho."}
      </p>
      {templates.length ? (
        <ul className="mb-4 grid gap-2 sm:grid-cols-3">
          {templates.map((template) => (
            <li key={template.id} className="parchment-inset p-3">
              <p className="font-semibold text-ink">{template.name}</p>
              <p className="text-xs text-ink-muted">Sistema: {template.system}</p>
              <p className="text-xs text-ink-muted">
                {mode === "connected" ? "Aprovado" : "Modelo local"} · versão {template.version}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="parchment-inset mb-4 p-3 text-sm text-ink-muted">
          Nenhum modelo aprovado disponível nesta campanha.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SheetImport onImported={setImported} />
        {imported && (
          <Link
            className="text-sm font-semibold text-ink underline"
            to="/fichas"
            search={{ ficha: imported }}
          >
            Abrir ficha importada
          </Link>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        {mode === "connected"
          ? "A criação de fichas continua sujeita à validação do modelo aprovado no servidor."
          : "Os perfis locais são parciais e não incluem regras oficiais completas. Consulte as fontes oficiais do sistema."}
      </p>
    </Panel>
  );
}

export function SettingsPanel() {
  const { state, engine, wipeLocal, refresh, ready } = useNexus();
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(readThemeMode);
  const summary = outboxSummary(state);
  const changeTheme = (mode: ThemeMode) => {
    setThemeMode(mode);
    if (!saveThemeMode(mode)) toast.error("O tema mudou, mas a preferência não pôde ser salva.");
  };
  const backup = async () => {
    if (!engine) return;
    const data = await engine.exportPendingDrafts();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `rpg-atlas-pendencias-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const clear = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await wipeLocal();
      await refresh();
      toast.success("Cópias locais da conta apagadas neste aparelho.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na operação local.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog.Root open={confirmClear} onOpenChange={setConfirmClear}>
      <div className="space-y-4">
        <ConnectionPanel />
        <Panel title="Aparência">
          <p className="mb-3 text-sm text-ink-muted">
            Escolha a iluminação das fichas neste aparelho.
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tema do aplicativo">
            <Btn
              variant={themeMode === "standard" ? "forest" : "outline"}
              aria-pressed={themeMode === "standard"}
              onClick={() => changeTheme("standard")}
            >
              Padrão
            </Btn>
            <Btn
              variant={themeMode === "dark" ? "forest" : "outline"}
              aria-pressed={themeMode === "dark"}
              onClick={() => changeTheme("dark")}
            >
              Escuro
            </Btn>
          </div>
        </Panel>
        <Panel title="Backup e limpeza">
          <p className="mb-3 text-sm text-ink">
            Há {summary.total} operação(ões) pendentes na campanha aberta. A exportação solicita ao
            navegador um arquivo JSON desta fila.
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="outline"
              disabled={!engine}
              onClick={() =>
                void backup().catch((e) =>
                  toast.error(e instanceof Error ? e.message : "Falha ao exportar."),
                )
              }
            >
              Exportar pendências da campanha aberta
            </Btn>
            <AlertDialog.Trigger asChild>
              <Btn variant="danger" disabled={!ready || busy}>
                {busy ? "Aguarde…" : "Apagar cópias locais"}
              </Btn>
            </AlertDialog.Trigger>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Dados confirmados no servidor permanecem na campanha. Pendências exportadas usam um
            formato próprio de recuperação da fila.
          </p>
        </Panel>
      </div>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none">
          <AlertDialog.Title className="text-lg font-semibold">
            Apagar cópias locais?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-ink-muted">
            Esta ação remove todas as campanhas desta conta neste aparelho, incluindo operações
            pendentes. O contador e a exportação acima cobrem somente a campanha aberta. Exporte
            cada fila que deseja preservar antes de confirmar; o clique de exportação não confirma
            que o navegador gravou o arquivo.
          </AlertDialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Btn type="button" variant="outline" disabled={busy}>
                Cancelar
              </Btn>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Btn
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => {
                  setConfirmClear(false);
                  void clear();
                }}
              >
                Confirmar e apagar
              </Btn>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
