"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ADS_CONSENT_EVENT,
  ADS_CONSENT_KEY,
  ADS_STICKY_DISMISS_KEY,
  AD_RESERVED_HEIGHT,
  adPlacement,
  adSenseScriptUrl,
  getAdSenseConfig,
  routeAllowsAds,
  type AdConsent,
  type AdFormat,
} from "../lib/ads";
import styles from "./ad-slot.module.css";

type AdsByGoogle = unknown[] & { requestNonPersonalizedAds?: number };
declare global {
  interface Window {
    adsbygoogle?: AdsByGoogle;
  }
}

const CONFIG = getAdSenseConfig();

function readConsent(): AdConsent {
  try {
    const value = window.localStorage.getItem(ADS_CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

function saveConsent(value: "accepted" | "declined") {
  try {
    window.localStorage.setItem(ADS_CONSENT_KEY, value);
  } catch {
    // A escolha vale nesta página mesmo sem armazenamento.
  }
  window.dispatchEvent(new CustomEvent(ADS_CONSENT_EVENT, { detail: value }));
}

function readStickyDismissed() {
  try {
    return window.sessionStorage.getItem(ADS_STICKY_DISMISS_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Loads adsbygoogle.js once, only after consent. No page-level config is pushed, so Auto ads,
 * anchor, side rail and vignette are never requested from code (they must also stay OFF in the
 * AdSense dashboard). Ads are requested as non-personalized.
 */
function loadAdSense(clientId: string) {
  const queue: AdsByGoogle = window.adsbygoogle ?? [];
  queue.requestNonPersonalizedAds = 1;
  window.adsbygoogle = queue;
  if (document.querySelector("script[data-rpg-nexus-adsense]")) return;
  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = adSenseScriptUrl(clientId);
  script.dataset.rpgNexusAdsense = "true";
  document.head.appendChild(script);
}

function useAdConsent() {
  const [consent, setConsent] = useState<AdConsent | "unknown">("unknown");
  useEffect(() => {
    setConsent(readConsent());
    const sync = () => setConsent(readConsent());
    window.addEventListener(ADS_CONSENT_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ADS_CONSENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return consent;
}

function AdUnit({ format, slot, clientId }: { format: AdFormat; slot: string; clientId: string }) {
  const pushed = useRef(false);
  useEffect(() => {
    loadAdSense(clientId);
    if (pushed.current) return;
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch {
      // Bloqueadores de anúncio podem impedir a fila; o espaço reservado permanece.
    }
  }, [clientId]);
  return <ins
    className={`adsbygoogle ${styles.unit}`}
    style={{ display: "block" }}
    data-ad-client={clientId}
    data-ad-slot={slot}
    data-full-width-responsive="false"
    data-rpg-ad-format={format}
  />;
}

type GameplayState = { activeCombat?: boolean; rolling?: boolean };

/** Inline ad with reserved height. Asks for consent in place (no pop-up). */
export function InlineAd({ activeCombat, rolling }: GameplayState) {
  const pathname = usePathname() ?? "/";
  const consent = useAdConsent();
  if (!routeAllowsAds(pathname, "inline", CONFIG) || activeCombat || rolling) return null;
  if (consent === "declined") return null;
  const reserved = { "--ad-h-mobile": `${AD_RESERVED_HEIGHT.inline.mobile}px`, "--ad-h-desktop": `${AD_RESERVED_HEIGHT.inline.desktop}px` } as React.CSSProperties;
  const decision = consent === "unknown" ? null : adPlacement({ pathname, format: "inline", config: CONFIG, consent, activeCombat, rolling });

  return <aside className={styles.inline} style={reserved} aria-label="Publicidade">
    {consent === null && <div className={styles.prompt}>
      <p>Anúncios ajudam a manter o RPG-Atlas gratuito. Eles ficam desligados até sua escolha, aparecem só nas páginas públicas e nunca na mesa de jogo.</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => saveConsent("declined")}>Recusar</button>
        <button type="button" onClick={() => saveConsent("accepted")}>Permitir anúncios</button>
      </div>
    </div>}
    {decision?.show && CONFIG.clientId && <>
      <div className={styles.label}><span>Publicidade</span><button type="button" onClick={() => { saveConsent("declined"); if (window.adsbygoogle) window.location.reload(); }}>Desativar anúncios</button></div>
      <AdUnit format="inline" slot={decision.slot} clientId={CONFIG.clientId} />
    </>}
  </aside>;
}

/** Dismissible sticky bottom ad. Pushes fixed controls up and pads the page so nothing is covered. */
export function StickyBottomAd({ activeCombat, rolling }: GameplayState) {
  const pathname = usePathname() ?? "/";
  const consent = useAdConsent();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(readStickyDismissed()), []);
  if (consent === "unknown") return null;
  const decision = adPlacement({ pathname, format: "sticky-bottom", config: CONFIG, consent, activeCombat, rolling, stickyDismissed: dismissed });
  if (!decision.show || !CONFIG.clientId) return null;

  function close() {
    try {
      window.sessionStorage.setItem(ADS_STICKY_DISMISS_KEY, "true");
    } catch {
      // Fecha apenas nesta página.
    }
    setDismissed(true);
  }

  const { mobile, desktop } = AD_RESERVED_HEIGHT["sticky-bottom"];
  return <>
    <style>{`:root{--rpg-ad-sticky-h:${mobile}px}@media(min-width:768px){:root{--rpg-ad-sticky-h:${desktop}px}}
body{padding-bottom:calc(var(--rpg-ad-sticky-h) + env(safe-area-inset-bottom))}
.theme-switcher,aside[aria-label="Preferências de privacidade"],div[aria-label="Preferências do Clarity"]{bottom:calc(16px + var(--rpg-ad-sticky-h) + env(safe-area-inset-bottom))!important}
@media(max-width:520px){.theme-switcher{bottom:auto!important}}`}</style>
    <aside className={styles.sticky} aria-label="Publicidade fixa">
      <button type="button" className={styles.close} onClick={close} aria-label="Fechar anúncio">×</button>
      <AdUnit format="sticky-bottom" slot={decision.slot} clientId={CONFIG.clientId} />
    </aside>
  </>;
}
