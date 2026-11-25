"use client";

import { useEffect, useId, useRef, useState } from "react";

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
  const [failed, setFailed] = useState<string>();
  return url && failed !== url
    ? <img className={styles.avatar} src={url} onError={() => setFailed(url)} alt={`Retrato de ${name || "personagem"}`} width={size} height={size} />
    : <span className={styles.avatarFallback} style={{ width: size, height: size }} aria-label={`Sem retrato: ${name || "personagem"}`}>{initials(name)}</span>;
}

export function PortraitView({ path, name, size = 96 }: { path: string | null; name: string; size?: number }) {
  const urls = usePortraitUrls([path]);
  return <PortraitAvatar url={path ? urls[path] : undefined} name={name} size={size} />;
}

type Props = {
  campaignId: string;
  uploaderId: string;
  value: string | null;
  name: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  onUploadState?: (uploading: boolean) => void;
  onChange: (path: string) => void;
};

/** Upload happens on selection so the sheet only ever stores a confirmed object path. */
export function PortraitPicker({ campaignId, uploaderId, value, name, disabled, required = true, error, onUploadState, onChange }: Props) {
  const inputId = useId();
  const active = useRef(false);
  const uploading = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (uploading.current) onUploadState?.(false);
    };
  }, [onUploadState]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function choose(file: File | undefined) {
    if (!file || uploading.current) return;
    uploading.current = true;
    onUploadState?.(true);
    setBusy(true);
    setMessage("Preparando e enviando a foto…");
    try {
      const path = await uploadPortrait(campaignId, uploaderId, file);
      if (!active.current) return;
      onChange(path);
      setMessage("Foto enviada. Salve a ficha para exibi-la na ficha e no mapa.");

    } catch (problem) {
      if (active.current) setMessage(problem instanceof Error ? problem.message : "Não foi possível enviar a foto.");
    } finally {
      uploading.current = false;
      if (active.current) {
        setBusy(false);
        onUploadState?.(false);
      }
    }
  }

  return <div className={styles.picker}>
    <PortraitView path={value} name={name} />
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
