import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { BookOpen, Bot, Library, Music2, Settings, Users } from "lucide-react";
import { OneRingCompanyPanel } from "@/components/nexus/OneRingCompanyPanel";
import { LibraryPanel } from "@/components/nexus/more/LibraryPanel";
import { MusicPanel } from "@/components/nexus/more/MusicPanel";
import { SettingsPanel } from "@/components/nexus/more/SettingsPanel";
import { Btn, LocalGate, PageHeader, Panel, Tag } from "@/components/nexus/ui";

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

type Section = "inicio" | "music" | "library" | "assistant" | "settings" | "one-ring";

const NAV_ITEMS: { id: Section; label: string; icon: typeof BookOpen }[] = [
  { id: "inicio", label: "Mais", icon: BookOpen },
  { id: "music", label: "Música", icon: Music2 },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "assistant", label: "Assistente", icon: Bot },
  { id: "settings", label: "Configurações", icon: Settings },
  { id: "one-ring", label: "O Um Anel", icon: Users },
];

/** Atalhos da tela inicial que abrem uma seção (o diário é um link de rota). */
const SHORTCUTS: { id: Section; title: string; detail: string; wide?: boolean }[] = [
  { id: "music", title: "Música", detail: "Links Spotify sem login" },
  { id: "library", title: "Biblioteca", detail: "Modelos e importação de fichas" },
  { id: "assistant", title: "Assistente", detail: "Estado da conexão" },
  { id: "settings", title: "Configurações", detail: "Conexão, backup e dados locais", wide: true },
];

function MaisRouteLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <>
      {pathname === "/mais" && <MaisHome />}
      <Outlet />
    </>
  );
}

function Shortcuts({ onOpen }: { onOpen: (section: Section) => void }) {
  return (
    <Panel title="Atalhos">
      <div className="grid gap-2 sm:grid-cols-2">
        <Link className="tap rounded-lg border border-border p-3 font-semibold text-ink" to="/mais/diario">
          Diário{" "}
          <span className="block text-sm font-normal text-ink-muted">Sessões e anotações locais</span>
        </Link>
        {SHORTCUTS.map((item) => (
          <button key={item.id} className={`tap rounded-lg border border-border p-3 text-left font-semibold text-ink${item.wide ? " sm:col-span-2" : ""}`} onClick={() => onOpen(item.id)}>
            {item.title}{" "}
            <span className="block text-sm font-normal text-ink-muted">{item.detail}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function AssistantPanel() {
  return (
    <Panel title="Assistente">
      <Tag tone="warn">Desconectado</Tag>
      <p className="mt-3 text-sm text-ink">Nenhum serviço de IA está ligado a esta prévia. Esta tela não envia texto a um servidor.</p>
    </Panel>
  );
}

function MaisHome() {
  const [section, setSection] = useState<Section>("inicio");
  return (
    <LocalGate>
      <PageHeader title="Mais" subtitle="Recursos salvos neste aparelho" />
      <nav aria-label="Recursos adicionais" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <Btn key={id} variant={section === id ? "ink" : "outline"} className={section === id ? undefined : "bg-card text-card-foreground"} onClick={() => setSection(id)}>
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
      {section === "inicio" && <Shortcuts onOpen={setSection} />}
      {section === "music" && <MusicPanel />}
      {section === "library" && <LibraryPanel />}
      {section === "assistant" && <AssistantPanel />}
      {section === "settings" && <SettingsPanel />}
      {section === "one-ring" && <OneRingCompanyPanel />}
    </LocalGate>
  );
}
