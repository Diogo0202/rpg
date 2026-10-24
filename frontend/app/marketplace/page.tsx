import type { Metadata } from "next";
import { MarketplacePanel } from "../../components/marketplace-panel";
import { SupportLinks } from "../../components/support-links";
import { getPublicMarketplaceItems } from "../../lib/marketplace-public";
import { getSiteMetadataConfig } from "../../lib/site-metadata";
import styles from "./marketplace.module.css";

const site = getSiteMetadataConfig();
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Comunidade | RPG-Atlas",
  description: "Explore modelos de ficha publicados pela comunidade de RPG-Atlas.",
  ...(site.indexable ? { alternates: { canonical: new URL("/marketplace", site.publicUrl!).toString() } } : {}),
};

export default async function MarketplacePage() {
  const initial = await getPublicMarketplaceItems();
  return <main className={styles.page}>
    <header className={styles.header}>
      <a className={styles.brand} href="/">RPG-Atlas</a>
      <a className={styles.homeLink} href="/login">Entrar na mesa</a>
    </header>
    <MarketplacePanel initialItems={initial.items} initialError={initial.error} />
    <SupportLinks />
  </main>;
}
