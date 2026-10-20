import { Link, useRouterState } from "@tanstack/react-router";
import { Castle, Dices, Map, Menu, ScrollText, CloudOff, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { outboxSummary, useNexus } from "@/lib/nexus/store";

const NAV = [
  { to: "/", label: "Mesa", icon: Castle },
  { to: "/fichas", label: "Fichas", icon: ScrollText },
  { to: "/dados", label: "Dados", icon: Dices },
  { to: "/mundo", label: "Mundo", icon: Map },
  { to: "/mais", label: "Mais", icon: Menu },
] as const;

function isActive(path: string, to: string) {
  return to === "/" ? path === "/" || path === "/sincronizacao" : path === to || path.startsWith(`${to}/`);
}

export function SyncIndicator() {
  const { state, ready } = useNexus();
  const s = outboxSummary(state);
  const label = !ready ? "Abrindo…" : s.conflicts ? `${s.conflicts} conflito${s.conflicts > 1 ? "s" : ""}` : `Modo local · ${s.queued} pendente${s.queued === 1 ? "" : "s"}`;
  return (
    <Link
      to="/sincronizacao"
      className={cn("tap inline-flex items-center gap-2 rounded-full border px-3 text-xs font-semibold",
        s.conflicts ? "border-warning bg-warning text-warning-foreground" : "border-border bg-secondary text-secondary-foreground")}
      aria-label={`Estado de sincronização: ${label}. Abrir fila de operações.`}
    >
      {s.conflicts ? <AlertTriangle className="size-4" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-dvh">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:p-2 focus:text-primary-foreground">Pular para o conteúdo</a>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 lg:flex" aria-label="Navegação principal">
        <div className="mb-6">
          <p className="font-display text-2xl font-semibold text-sidebar-primary">RPG-Atlas</p>
          <p className="text-xs uppercase tracking-widest text-sidebar-foreground/70">Mobile</p>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} aria-current={isActive(path, to) ? "page" : undefined}
              className={cn("tap flex items-center gap-3 rounded-lg px-3 text-base font-semibold",
                isActive(path, to) ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent")}>
              <Icon className="size-5" aria-hidden />{label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-30 border-b border-border bg-forest-deep/95 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2">
            <Link to="/" className="font-display text-xl font-semibold text-primary lg:hidden">RPG-Atlas</Link>
            <span className="hidden text-sm text-muted-foreground lg:block">Modo local, API RPG-Atlas não conectada</span>
            <SyncIndicator />
          </div>
        </header>
        <main id="conteudo" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-4 lg:pb-10">{children}</main>
      </div>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-forest-deep lg:hidden" aria-label="Navegação principal">
        <ul className="grid grid-cols-5">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = isActive(path, to);
            return (
              <li key={to}>
                <Link to={to} aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold", active ? "text-primary" : "text-muted-foreground")}>
                  <Icon className="size-5" aria-hidden />{label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

