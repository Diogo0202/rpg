"use client";

import { useEffect, useId, useState } from "react";

import { portraitUrls, uploadPortrait } from "../lib/portrait-upload";
import { initials } from "../lib/portraits";
import styles from "./portrait-picker.module.css";

/** Resolves signed URLs for portrait paths; unknown paths simply stay absent. */
export function usePortraitUrls(paths: (string | null | undefined)[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = [...new Set(paths.filter((path): path is string => Boolean(path)))].sort().join("|");
  useEffect(() => {
    let active = true;
    if (!key) { setUrls({}); return; }
    portraitUrls(key.split("|")).then((result) => { if (active) setUrls(result); }).catch(() => { if (active) setUrls({}); });
    return () => { active = false; };
  }, [key]);
  return urls;
}

export function PortraitAvatar({ url, name, size = 72 }: { url?: string; name: string; size?: number }) {
  return url
    ? <img className={styles.avatar} src={url} alt={`Retrato de ${name || "personagem"}`} width={size} height={size} />
    : <span className={styles.avatarFallback} style={{ width: size, height: size }} aria-label={`Sem retrato: ${name || "personagem"}`}>{initials(name)}</span>;
}

type Props = {
  campaignId: string;
  uploaderId: string;
  value: string | null;
  name: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  onChange: (path: string) => void;
};

/** Upload happens on selection so the sheet only ever stores a confirmed object path. */
export function PortraitPicker({ campaignId, uploaderId, value, name, disabled, required = true, error, onChange }: Props) {
  const inputId = useId();
  const urls = usePortraitUrls([value]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function choose(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setMessage("Preparando e enviando a foto…");
    try {
      onChange(await uploadPortrait(campaignId, uploaderId, file));
      setMessage("Foto enviada. Ela aparece no pin do personagem no mapa.");
    } catch (problem) {
      setMessage(problem instanceof Error ? problem.message : "Não foi possível enviar a foto.");
    } finally { setBusy(false); }
  }

  return <div className={styles.picker}>
    <PortraitAvatar url={value ? urls[value] : undefined} name={name} size={96} />
    <div className={styles.controls}>
      <label htmlFor={inputId} className={styles.label}>Retrato do personagem{required && <span className={styles.required}>Obrigatório</span>}</label>
      <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy}
        aria-invalid={Boolean(error)} aria-describedby={`${inputId}-help`}
        onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
      <small id={`${inputId}-help`}>JPG, PNG ou WebP. A foto é recortada em quadrado, reduzida e os dados de localização são removidos antes do envio.</small>
      {(error || message) && <p className={error ? styles.error : styles.status} role={error ? "alert" : "status"}>{error || message}</p>}
    </div>
  </div>;
}
