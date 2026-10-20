// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import type { Plugin } from "vite";
import { isPublicShellRequest } from "./src/lib/pwa";

const pwaPlugins: Plugin[] = VitePWA({
  strategies: "generateSW",
  outDir: ".output/public",
  registerType: "autoUpdate",
  injectRegister: false,
  includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"],
  manifest: false,
  workbox: {
    globPatterns: ["**/*.{js,css,woff2,png,svg,ico,webmanifest}"],
    globIgnores: ["**/api/**", "**/auth/**"],
    additionalManifestEntries: [{ url: "/", revision: null }],
    navigateFallback: "/",
    navigateFallbackDenylist: [
      /^\/api(?:\/|$)/i,
      /^\/auth(?:\/|$)/i,
      /^\/(?:login|logout|oauth)(?:\/|$)/i,
    ],
    runtimeCaching: [
      {
        urlPattern: isPublicShellRequest,
        handler: "NetworkFirst",
        options: {
          cacheName: "rpg-nexus-shell-v1",
          networkTimeoutSeconds: 3,
          cacheableResponse: { statuses: [200] },
          expiration: { maxEntries: 20, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
    ],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true,
  },
}).map((plugin) => ({
  ...plugin,
  applyToEnvironment: (environment) => environment.name === "client",
}));

export default defineConfig({
  vite: {
    plugins: pwaPlugins,
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
