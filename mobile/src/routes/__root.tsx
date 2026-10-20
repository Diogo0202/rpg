import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/nexus/AppShell";
import { NexusProvider } from "@/lib/nexus/store";
import { setupServiceWorker } from "@/lib/pwa";

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="parchment max-w-md p-6 text-center">
        <h1 className="text-5xl font-bold text-ink">404</h1>
        <p className="mt-2 text-sm text-ink-muted">Esta página não existe no RPG-Atlas Mobile.</p>
        <Link to="/" className="tap mt-4 inline-flex items-center justify-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Voltar à Mesa</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="parchment max-w-md p-6 text-center">
        <h1 className="text-xl font-semibold text-ink">Esta tela não carregou</h1>
        <p className="mt-2 text-sm text-ink-muted">Seus dados locais continuam no aparelho. Tente novamente.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="tap rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Tentar de novo</button>
          <a href="/" className="tap inline-flex items-center rounded-lg border border-ink/30 px-4 font-semibold text-ink">Mesa</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#1b3325" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "RPG-Atlas" },
      { title: "RPG-Atlas Mobile" },
      { name: "description", content: "Mesa, fichas, dados e mundo do RPG-Atlas no celular, com modo local offline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Sans+3:wght@400;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => { void setupServiceWorker(); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <NexusProvider>
        <AppShell>
          <Outlet />
        </AppShell>
        <Toaster position="top-center" />
      </NexusProvider>
    </QueryClientProvider>
  );
}

