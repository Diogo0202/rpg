// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { pwaBuildPlugin } from "./pwa-build";

const localBuild = process.env.RPG_MOBILE_LOCAL_BUILD === "1";

export default defineConfig({
  // Local preview serves the generated SPA shell through Vite. Keep Nitro
  // enabled for the Lovable deployment build.
  nitro: localBuild ? false : undefined,
  vite: {
    plugins: [pwaBuildPlugin()],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // The worker falls back to this content-free document for offline routes.
    spa: { enabled: true, prerender: { outputPath: "/_shell" } },
  },
});
