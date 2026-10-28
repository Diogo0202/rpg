/**
 * Google AdSense: placement policy (pure, testable).
 *
 * Where ads may appear (documented in docs/MONETIZACAO.md):
 * - "/"            : inline (below the landing content) and sticky bottom (dismissible).
 * - "/marketplace" : inline only (after the public catalogue).
 * Never: /app/** (authenticated play area: sheets, rolls, combat, maps), /login, /auth/**, /dev/**,
 * or any page while a roll or combat is active.
 *
 * Formats: only "inline" and "sticky-bottom". Pop-ups, vignettes/full-screen, interstitials,
 * Auto ads (anchor/side rail) and autoplay video are forbidden: the script is loaded without any
 * page-level configuration, and Auto ads must stay OFF for the site in the AdSense dashboard.
 */

export type AdFormat = "inline" | "sticky-bottom";
export type AdConsent = "accepted" | "declined" | null;

export const ALLOWED_AD_FORMATS: readonly AdFormat[] = ["inline", "sticky-bottom"];
export const FORBIDDEN_AD_FORMATS = ["popup", "vignette", "fullscreen", "interstitial", "anchor-auto", "side-rail", "autoplay-video"] as const;

/** Public routes and the formats each one may show. Everything else shows no ads. */
export const AD_ROUTE_FORMATS: Readonly<Record<string, readonly AdFormat[]>> = {
  "/": ["inline", "sticky-bottom"],
  "/marketplace": ["inline"],
};

/** Reserved heights (px) so the slot never causes layout shift. */
export const AD_RESERVED_HEIGHT = {
  inline: { mobile: 280, desktop: 120 },
  "sticky-bottom": { mobile: 62, desktop: 100 },
} as const;

export const ADS_CONSENT_KEY = "rpg-nexus-ads-consent";
export const ADS_CONSENT_EVENT = "rpg-nexus-ads-consent-change";
export const ADS_STICKY_DISMISS_KEY = "rpg-nexus-ads-sticky-dismissed";

export type AdSenseEnv = {
  NEXT_PUBLIC_ADSENSE_ENABLED?: string;
  NEXT_PUBLIC_ADSENSE_CLIENT_ID?: string;
  NEXT_PUBLIC_ADSENSE_SLOT_INLINE?: string;
  NEXT_PUBLIC_ADSENSE_SLOT_STICKY?: string;
};

export type AdSenseConfig = {
  enabled: boolean;
  clientId: string | null;
  slots: Record<AdFormat, string | null>;
};

function readPublicEnv(): AdSenseEnv {
  // Static references so Next.js inlines the public values in client bundles.
  return {
    NEXT_PUBLIC_ADSENSE_ENABLED: process.env.NEXT_PUBLIC_ADSENSE_ENABLED,
    NEXT_PUBLIC_ADSENSE_CLIENT_ID: process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID,
    NEXT_PUBLIC_ADSENSE_SLOT_INLINE: process.env.NEXT_PUBLIC_ADSENSE_SLOT_INLINE,
    NEXT_PUBLIC_ADSENSE_SLOT_STICKY: process.env.NEXT_PUBLIC_ADSENSE_SLOT_STICKY,
  };
}

const slotId = (value: string | undefined) => {
  const slot = value?.trim() ?? "";
  return /^\d{6,20}$/.test(slot) ? slot : null;
};

export function getAdSenseConfig(env: AdSenseEnv = readPublicEnv()): AdSenseConfig {
  const client = env.NEXT_PUBLIC_ADSENSE_CLIENT_ID?.trim() ?? "";
  const clientId = /^ca-pub-\d{10,20}$/.test(client) ? client : null;
  const slots = { inline: slotId(env.NEXT_PUBLIC_ADSENSE_SLOT_INLINE), "sticky-bottom": slotId(env.NEXT_PUBLIC_ADSENSE_SLOT_STICKY) };
  const enabled = env.NEXT_PUBLIC_ADSENSE_ENABLED === "true" && clientId !== null && Object.values(slots).some(Boolean);
  return { enabled, clientId: enabled ? clientId : null, slots: enabled ? slots : { inline: null, "sticky-bottom": null } };
}

export type AdPlacementInput = {
  pathname: string;
  format: string;
  config: AdSenseConfig;
  consent: AdConsent;
  activeCombat?: boolean;
  rolling?: boolean;
  stickyDismissed?: boolean;
};

export type AdPlacementDecision =
  | { show: true; slot: string }
  | { show: false; reason: "disabled" | "format" | "slot" | "route" | "consent" | "gameplay" | "dismissed" };

export function normalizeAdPath(pathname: string) {
  const path = pathname.split(/[?#]/)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

export function adPlacement(input: AdPlacementInput): AdPlacementDecision {
  const { config, format } = input;
  if (!config.enabled || !config.clientId) return { show: false, reason: "disabled" };
  if (!(ALLOWED_AD_FORMATS as readonly string[]).includes(format)) return { show: false, reason: "format" };
  const adFormat = format as AdFormat;
  const slot = config.slots[adFormat];
  if (!slot) return { show: false, reason: "slot" };
  const routeFormats = AD_ROUTE_FORMATS[normalizeAdPath(input.pathname)];
  if (!routeFormats?.includes(adFormat)) return { show: false, reason: "route" };
  if (input.activeCombat || input.rolling) return { show: false, reason: "gameplay" };
  if (input.consent !== "accepted") return { show: false, reason: "consent" };
  if (adFormat === "sticky-bottom" && input.stickyDismissed) return { show: false, reason: "dismissed" };
  return { show: true, slot };
}

/** Whether a route may even render an ad placeholder / consent prompt (before consent is known). */
export function routeAllowsAds(pathname: string, format: AdFormat, config: AdSenseConfig = getAdSenseConfig()) {
  if (!config.enabled || !config.slots[format]) return false;
  return AD_ROUTE_FORMATS[normalizeAdPath(pathname)]?.includes(format) ?? false;
}

export function adSenseScriptUrl(clientId: string) {
  return `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
}

/**
 * CSP sources to append ONLY when AdSense is enabled. The project currently ships no CSP header;
 * if one is added, merge these into the matching directives. Returns {} when disabled.
 */
export function adSenseCspSources(config: AdSenseConfig = getAdSenseConfig()): Partial<Record<"script-src" | "img-src" | "frame-src" | "connect-src", string[]>> {
  if (!config.enabled) return {};
  return {
    "script-src": ["https://pagead2.googlesyndication.com", "https://*.googlesyndication.com", "https://*.adtrafficquality.google"],
    "img-src": ["https://pagead2.googlesyndication.com", "https://*.googlesyndication.com", "https://*.g.doubleclick.net", "https://*.adtrafficquality.google"],
    "frame-src": ["https://googleads.g.doubleclick.net", "https://tpc.googlesyndication.com", "https://*.googlesyndication.com", "https://www.google.com", "https://*.adtrafficquality.google"],
    "connect-src": ["https://pagead2.googlesyndication.com", "https://*.adtrafficquality.google"],
  };
}
