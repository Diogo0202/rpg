import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { BookOpen, Bot, Library, Music2, Settings } from "lucide-react";
import { toast } from "sonner";
import { SheetImport } from "@/components/nexus/SheetImport";
import { Btn, Empty, LocalGate, PageHeader, Panel, Tag } from "@/components/nexus/ui";
import { connectionStatus } from "@/lib/nexus/config";
import { useNexus, outboxSummary } from "@/lib/nexus/store";
import { SYSTEM_STARTERS } from "@/lib/system-starters";
import type { JsonValue } from "@/lib/mobile-sync";

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
          <Btn key={id} variant={section === id ? "ink" : "outline"} onClick={() => setSection(id)}>
            <Icon className="size-4" aria-hidden />
            {label}
          </Btn>
        ))}
        <Link
          to="/mais/diario"
          className="tap col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ink/30 text-sm font-semibold text-ink sm:col-span-5"
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
                  className="break-all text-sm text-secondary underline"
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

function LibraryPanel() {
  const [imported, setImported] = useState("");
  return (
    <Panel title="Biblioteca">
      <p className="mb-3 text-sm text-ink-muted">
        Modelos de ficha disponíveis para criar em Fichas.
      </p>
      <ul className="mb-4 grid gap-2 sm:grid-cols-3">
        {SYSTEM_STARTERS.map((starter) => (
          <li key={starter.id} className="parchment-inset p-3">
            <p className="font-semibold text-ink">{starter.label}</p>
            <p className="text-xs text-ink-muted">
              Modelo local · versão {starter.template.version}
            </p>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <SheetImport onImported={setImported} />
        {imported && (
          <Link
            className="text-sm font-semibold text-secondary underline"
            to="/fichas"
            search={{ ficha: imported }}
          >
            Abrir ficha importada
          </Link>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Os modelos são os três modelos incluídos no app. Catálogo remoto não está conectado.
      </p>
    </Panel>
  );
}

function SettingsPanel() {
  const { state, engine, wipeLocal, refresh, ready } = useNexus();
  const [busy, setBusy] = useState(false);
  const status = connectionStatus();
  const summary = outboxSummary(state);
  const backup = async () => {
    if (!engine) return;
    const data = await engine.exportPendingDrafts();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `rpg-nexus-pendencias-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const clear = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (summary.total > 0) {
        await backup();
        if (
          !window.confirm(
            `Foi solicitada a exportação de ${summary.total} operação(ões) pendente(s). Confirme que o arquivo foi salvo antes de apagar os dados deste aparelho.`,
          )
        )
          return;
      } else if (
        !window.confirm(
          "Apagar todos os dados locais deste aparelho? Esta ação não pode ser desfeita.",
        )
      )
        return;
      await wipeLocal();
      await refresh();
      toast.success(
        "Partição local apagada. Dados demonstrativos podem voltar ao reiniciar esta prévia.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na operação local.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Panel title="Conexão">
        <Tag tone="warn">Apenas local</Tag>
        <p className="mt-2 text-sm text-ink">
          API configurada: {status.apiUrlConfigured ? "sim" : "não"}. Supabase Auth:{" "}
          {status.supabaseUrlConfigured ? "sim" : "não"}. Sessão autenticada: não.
        </p>
        <p className="mt-1 text-xs text-ink-muted">{status.pendingReason}</p>
      </Panel>
      <Panel title="Backup e limpeza">
        <p className="mb-3 text-sm text-ink">
          Há {summary.total} operação(ões) na fila. Exportar baixa um JSON com as operações
          pendentes.
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
            Exportar pendências
          </Btn>
          <Btn variant="danger" disabled={!ready || busy} onClick={() => void clear()}>
            {busy ? "Aguarde…" : "Apagar cofre e sair"}
          </Btn>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          A limpeza apaga a partição local e encerra o estado atual. Como esta prévia semeia dados
          demonstrativos quando inicia vazia, eles podem voltar após reiniciar o app. Login remoto
          ainda não está implementado.
        </p>
      </Panel>
    </div>
  );
}
