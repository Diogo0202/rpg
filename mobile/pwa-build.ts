import { resolve } from "node:path";
import { access, copyFile } from "node:fs/promises";
import { generateSW } from "workbox-build";
import type { Plugin } from "vite";

export const PWA_WORKBOX_OPTIONS = {
  globPatterns: [
    "_shell.html",
    "assets/**/*.{js,css,woff2,png,svg,ico}",
    "icons/**/*.{png,svg,ico}",
    "manifest.webmanifest",
    "favicon.ico",
  ],
  globIgnores: ["**/api/**", "**/auth/**", "sw.js", "workbox-*.js"],
  navigateFallback: "/_shell.html",
  navigateFallbackAllowlist: [
    /^\/(?:$|fichas(?:\/nova)?|dados|mundo|mais(?:\/diario)?|sincronizacao)(?:\?.*)?$/i,
  ],
  navigateFallbackDenylist: [
    /^\/api(?:\/|$)/i,
    /^\/auth(?:\/|$)/i,
    /^\/(?:login|logout|oauth)(?:\/|$)/i,
  ],
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
};

export function pwaWorkerOptions(publicDirectory: string, serviceWorkerPath: string) {
  return {
    ...PWA_WORKBOX_OPTIONS,
    globDirectory: publicDirectory,
    swDest: serviceWorkerPath,
    mode: "production" as const,
    sourcemap: false,
    maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
  };
}

export async function generatePwaWorker(publicDirectory: string, clientDirectory = publicDirectory) {
  const shell = resolve(publicDirectory, "_shell.html");
  if (resolve(clientDirectory) !== resolve(publicDirectory)) {
    // TanStack prerenders the shell into dist/client after Nitro copied assets
    // into .output/public. Copy the current release before Workbox hashes it.
    await copyFile(resolve(clientDirectory, "_shell.html"), shell);
  }
  try {
    await access(shell);
  } catch {
    throw new Error(`TanStack SPA shell was not generated: ${shell}`);
  }
  const serviceWorkerPath = resolve(publicDirectory, "sw.js");
  return generateSW(pwaWorkerOptions(publicDirectory, serviceWorkerPath));
}

/** Runs after TanStack Start's post-build hook has written its revisioned SPA shell. */
export function pwaBuildPlugin(): Plugin {
  let projectRoot = process.cwd();

  return {
    name: "rpg-atlas:pwa-worker-after-spa-shell",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      projectRoot = config.root;
    },
    buildApp: {
      order: "post",
      async handler() {
        const publicDirectory = process.env.RPG_MOBILE_LOCAL_BUILD === "1"
          ? resolve(projectRoot, "dist/client")
          : resolve(projectRoot, ".output/public");
        await generatePwaWorker(publicDirectory, resolve(projectRoot, "dist/client"));
      },
    },
  };
}
