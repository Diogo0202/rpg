/**
 * Affiliate links per RPG system (Amazon, DriveThruRPG).
 * - IDs come only from public env vars; no ID configured => no link for that store.
 * - Links are plain search URLs on the official store plus the store's own affiliate parameter;
 *   no extra tracking parameters, redirects or click handlers are added.
 */

export const AFFILIATE_REL = "sponsored noopener noreferrer";
export const AFFILIATE_DISCLOSURE = "Links de afiliado: se você comprar por eles, o RPG-Atlas pode receber uma comissão, sem custo extra para você.";

export type AffiliateStore = "amazon" | "drivethrurpg";
export type AffiliateEnv = {
  NEXT_PUBLIC_AMAZON_AFFILIATE_TAG?: string;
  NEXT_PUBLIC_AMAZON_STORE_DOMAIN?: string;
  NEXT_PUBLIC_DRIVETHRURPG_AFFILIATE_ID?: string;
};

export type AffiliateSystem = { id: string; label: string; amazonQuery: string; drivethruQuery: string };

export const AFFILIATE_SYSTEMS: readonly AffiliateSystem[] = [
  { id: "vampire-v5", label: "Vampiro: A Máscara 5ª edição", amazonQuery: "Vampiro A Máscara 5ª edição livro de regras", drivethruQuery: "Vampire: The Masquerade 5th Edition" },
  { id: "vampire-v3", label: "Vampiro: A Máscara (Revisado)", amazonQuery: "Vampiro A Máscara Revisado", drivethruQuery: "Vampire: The Masquerade Revised" },
  { id: "hunter", label: "Caçador: A Revanche 5ª edição", amazonQuery: "Hunter The Reckoning 5th Edition", drivethruQuery: "Hunter: The Reckoning 5th Edition" },
  { id: "one-ring", label: "O Um Anel", amazonQuery: "O Um Anel RPG", drivethruQuery: "The One Ring Roleplaying Game" },
  { id: "shadow-demon-lord", label: "Shadow of the Demon Lord", amazonQuery: "Shadow of the Demon Lord RPG", drivethruQuery: "Shadow of the Demon Lord" },
  { id: "demon-the-fallen", label: "Demônio: A Queda", amazonQuery: "Demon The Fallen RPG", drivethruQuery: "Demon: The Fallen" },
];

const AMAZON_DOMAINS = ["amazon.com.br", "amazon.com"] as const;

function readPublicEnv(): AffiliateEnv {
  // Static references so Next.js inlines public values in client bundles.
  return {
    NEXT_PUBLIC_AMAZON_AFFILIATE_TAG: process.env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG,
    NEXT_PUBLIC_AMAZON_STORE_DOMAIN: process.env.NEXT_PUBLIC_AMAZON_STORE_DOMAIN,
    NEXT_PUBLIC_DRIVETHRURPG_AFFILIATE_ID: process.env.NEXT_PUBLIC_DRIVETHRURPG_AFFILIATE_ID,
  };
}

export function getAffiliateConfig(env: AffiliateEnv = readPublicEnv()) {
  const tag = env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG?.trim() ?? "";
  const domain = env.NEXT_PUBLIC_AMAZON_STORE_DOMAIN?.trim().toLowerCase() || "amazon.com.br";
  const drivethru = env.NEXT_PUBLIC_DRIVETHRURPG_AFFILIATE_ID?.trim() ?? "";
  return {
    amazonTag: /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(tag) ? tag : null,
    amazonDomain: (AMAZON_DOMAINS as readonly string[]).includes(domain) ? domain : "amazon.com.br",
    drivethruId: /^\d{1,12}$/.test(drivethru) ? drivethru : null,
  };
}

export type AffiliateLink = { systemId: string; systemLabel: string; store: AffiliateStore; storeLabel: string; href: string };

export function buildAffiliateLink(system: AffiliateSystem, store: AffiliateStore, config: ReturnType<typeof getAffiliateConfig>): AffiliateLink | null {
  if (store === "amazon") {
    if (!config.amazonTag) return null;
    const url = new URL(`https://www.${config.amazonDomain}/s`);
    url.searchParams.set("k", system.amazonQuery);
    url.searchParams.set("tag", config.amazonTag);
    return { systemId: system.id, systemLabel: system.label, store, storeLabel: "Amazon", href: url.toString() };
  }
  if (!config.drivethruId) return null;
  const url = new URL("https://www.drivethrurpg.com/en/browse");
  url.searchParams.set("keyword", system.drivethruQuery);
  url.searchParams.set("affiliate_id", config.drivethruId);
  return { systemId: system.id, systemLabel: system.label, store, storeLabel: "DriveThruRPG", href: url.toString() };
}

/** Links for one system (or all systems when omitted). Empty when no affiliate ID is configured. */
export function affiliateLinks(systemId?: string | null, env?: AffiliateEnv): AffiliateLink[] {
  const config = getAffiliateConfig(env);
  const systems = systemId ? AFFILIATE_SYSTEMS.filter((system) => system.id === systemId) : AFFILIATE_SYSTEMS;
  return systems.flatMap((system) => (["amazon", "drivethrurpg"] as const).flatMap((store) => buildAffiliateLink(system, store, config) ?? []));
}
