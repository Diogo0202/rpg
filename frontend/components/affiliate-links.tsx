import { AFFILIATE_DISCLOSURE, AFFILIATE_REL, affiliateLinks } from "../lib/affiliate-links";

type Props = {
  /** System id from lib/system-starters (e.g. "vampire-v5"). Omit to list every system. */
  systemId?: string | null;
  title?: string;
  /** Compact single-line variant, e.g. inside a card. */
  compact?: boolean;
};

/**
 * Affiliate store links per system. Renders nothing without configured affiliate IDs.
 * Plain anchors: no click tracking, no extra parameters beyond the store's affiliate ID.
 */
export function AffiliateLinks({ systemId, title = "Livros oficiais", compact = false }: Props) {
  const links = affiliateLinks(systemId);
  if (!links.length) return null;
  const bySystem = new Map<string, typeof links>();
  for (const link of links) bySystem.set(link.systemLabel, [...(bySystem.get(link.systemLabel) ?? []), link]);

  if (compact) {
    return <p className="affiliate-links compact">
      <small>{AFFILIATE_DISCLOSURE}</small>{" "}
      {links.map((link, index) => <span key={link.href}>{index ? " · " : ""}<a href={link.href} rel={AFFILIATE_REL} target="_blank">{systemId ? link.storeLabel : `${link.systemLabel} (${link.storeLabel})`}</a></span>)}
    </p>;
  }

  return <section className="affiliate-links" aria-label="Links de afiliado" style={{ maxWidth: 1000, margin: "24px auto", padding: "0 16px" }}>
    <h2 style={{ fontSize: 18, margin: "0 0 6px" }}>{title}</h2>
    <p role="note" style={{ margin: "0 0 10px", fontSize: 13 }}><strong>Aviso de afiliado:</strong> {AFFILIATE_DISCLOSURE}</p>
    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
      {[...bySystem].map(([label, items]) => <li key={label}>
        <span>{label}: </span>
        {items.map((link, index) => <span key={link.href}>{index ? " · " : ""}<a href={link.href} rel={AFFILIATE_REL} target="_blank">{link.storeLabel}</a></span>)}
      </li>)}
    </ul>
  </section>;
}
