"use client";

import { useEffect, useState } from "react";
import { getClarityConfig } from "../lib/clarity";
import styles from "./clarity-consent.module.css";

type ClarityApi = ((...args: unknown[]) => void) & { q?: unknown[][] };
declare global {
  interface Window {
    clarity?: ClarityApi;
  }
}

const CONSENT_KEY = "rpg-nexus-clarity-consent";
const { projectId: PROJECT_ID, enabled: ENABLED } = getClarityConfig();

function loadClarity() {
  if (!ENABLED || !PROJECT_ID || window.clarity) return;
  const clarity: ClarityApi = (...args) => {
    clarity.q = clarity.q ?? [];
    clarity.q.push(args);
  };
  window.clarity = clarity;
  clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${encodeURIComponent(PROJECT_ID)}`;
  script.dataset.rpgNexusClarity = "true";
  document.head.appendChild(script);
}

function readChoice(): "accepted" | "declined" | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : null;
  } catch {
    return null;
  }
}

function saveChoice(value: "accepted" | "declined") {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // A escolha permanece ativa nesta página mesmo se o navegador bloquear armazenamento.
  }
}

export function ClarityConsent() {
  const [choice, setChoice] = useState<"accepted" | "declined" | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const savedChoice = readChoice();
    if (savedChoice) {
      setChoice(savedChoice);
      setOpen(false);
    }
    if (savedChoice === "accepted") loadClarity();
  }, []);

  useEffect(() => {
    function navigatePrivatelyWithDocument(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download")) return;

      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      const privatePath = /^\/(?:app|login|auth)(?:\/|$)/.test(destination.pathname);
      if (!privatePath) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(destination.href);
    }

    document.addEventListener("click", navigatePrivatelyWithDocument, true);
    return () => document.removeEventListener("click", navigatePrivatelyWithDocument, true);
  }, []);

  function choose(nextChoice: "accepted" | "declined") {
    saveChoice(nextChoice);
    setChoice(nextChoice);
    setOpen(false);
    if (nextChoice === "accepted") {
      loadClarity();
    } else if (window.clarity) {
      window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" });
      window.location.reload();
    }
  }

  function revoke() {
    saveChoice("declined");
    setChoice("declined");
    setOpen(false);
    if (window.clarity) {
      window.clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" });
      window.location.reload();
    }
  }

  if (!ENABLED) return null;

  return (
    <>
      {open ? (
        <aside className={styles.banner} aria-label="Preferências de privacidade">
          <p>O RPG-Atlas pode registrar interações para análise de uso. O Clarity fica desligado até sua escolha. A análise fica restrita a esta página pública, com conteúdo mascarado.</p>
          <div className={styles.actions}>
            <button type="button" onClick={() => choose("declined")}>Recusar</button>
            <button type="button" onClick={() => choose("accepted")}>Permitir análise</button>
          </div>
        </aside>
      ) : (
        <div className={styles.preference} aria-label="Preferências do Clarity">
          {choice === "accepted" && <button type="button" onClick={revoke}>Revogar análise</button>}
          <button type="button" onClick={() => setOpen(true)}>Preferências de análise</button>
        </div>
      )}
    </>
  );
}
