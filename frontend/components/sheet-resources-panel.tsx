"use client";

import { useEffect, useState } from "react";

import { useCharacterSession } from "../lib/character-session";
import { adjustExperience, listSheetEvents, spendMetaCurrency, type AdjustedSheet, type SheetEvent } from "../lib/sheet-adjustments";
import type { MetaCurrency, SheetTemplate } from "../lib/sheet-template";
import { createClient } from "../lib/supabase/client";
import styles from "./sheet-resources-panel.module.css";

type Resources = { sheetId: string; ownerId: string; experienceField: string | null; currencies: MetaCurrency[] };

function numeric(values: Record<string, unknown>, field: string): number {
  const value = values[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * XP and meta currencies change through atomic server deltas, so the master
 * granting XP and the player spending Willpower never overwrite each other.
 */
export function SheetResourcesPanel({ viewerId, canManage }: { viewerId: string; canManage: boolean }) {
  const { character, acceptSavedCharacter } = useCharacterSession();
  const [resources, setResources] = useState<Resources | null>(null);
  const [events, setEvents] = useState<SheetEvent[]>([]);
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const characterId = character?.id;

  useEffect(() => {
    setResources(null);
    setEvents([]);
    setMessage("");
    if (!characterId) return;
    let active = true;
    (async () => {
      const client = createClient();
      const { data: sheet, error: sheetError } = await client.from("character_sheets").select("template_id,owner_id").eq("id", characterId).single();
      if (!active) return;
      if (sheetError || !sheet) { setMessage("Não foi possível ler o modelo desta ficha."); return; }
      const { data: template, error: templateError } = await client.from("system_templates").select("schema").eq("id", sheet.template_id).single();
      if (!active) return;
      if (templateError || !template) { setMessage("Não foi possível ler o modelo desta ficha."); return; }
      const schema = template.schema as SheetTemplate;
      setResources({ sheetId: characterId, ownerId: sheet.owner_id, experienceField: schema.experience_field ?? null, currencies: schema.meta_currencies ?? [] });
      try { if (active) setEvents(await listSheetEvents(characterId)); } catch { /* the log is informative only */ }
    })();
    return () => { active = false; };
  }, [characterId]);

  async function run(action: () => Promise<AdjustedSheet>, success: string) {
    if (!character || busy) return;
    setBusy(true);
    try {
      const sheet = await action();
      acceptSavedCharacter({ ...character, version: sheet.version, values: sheet.values });
      setMessage(success);
      setReason("");
      setEvents(await listSheetEvents(sheet.id).catch(() => events));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível ajustar a ficha.");
    } finally { setBusy(false); }
  }

  if (!character) return null;
  if (!resources || resources.sheetId !== character.id) {
    return <section className={styles.panel} aria-labelledby="resources-title"><h2 id="resources-title">Recursos da ficha</h2><p className={styles.notice} role="status">{message || "Lendo o modelo da ficha…"}</p></section>;
  }
  const isOwner = resources.ownerId === viewerId;
  const validAmount = Number.isInteger(amount) && amount >= 1 && amount <= 1000;
  const labels = new Map(resources.currencies.map((item) => [item.id, item.label]));

  return <section className={styles.panel} aria-labelledby="resources-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>AJUSTES ATÔMICOS</p><h2 id="resources-title">Recursos da ficha</h2>
        <p>Cada ajuste soma ou subtrai do valor atual no servidor. Mestre e jogador podem alterar a mesma ficha ao mesmo tempo sem conflito.</p></div>
      <span className={styles.character}>{character.name}</span>
    </header>
    <p className={styles.notice} role="status" aria-live="polite">{message}</p>
    <div className={styles.controls}>
      <label>Quantidade<input type="number" min={1} max={1000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></label>
      <label>Motivo (opcional)<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: sessão 4" /></label>
    </div>
    {!resources.experienceField && resources.currencies.length === 0 && <p className={styles.empty}>O modelo desta ficha não declara experiência nem recursos como Força de Vontade ou Inspiração.</p>}
    <ul className={styles.resources}>
      {resources.experienceField && <li>
        <div><strong>Experiência disponível</strong><span>{numeric(character.values, resources.experienceField)} XP</span></div>
        <div className={styles.actions}>
          {canManage && <button type="button" disabled={busy || !validAmount} onClick={() => run(() => adjustExperience(character.id, amount, reason), `${amount} XP concedido.`)}>Conceder</button>}
          {(isOwner || canManage) && <button type="button" disabled={busy || !validAmount} onClick={() => run(() => adjustExperience(character.id, -amount, reason), `${amount} XP gasto.`)}>Gastar</button>}
        </div>
      </li>}
      {resources.currencies.map((currency) => {
        const current = numeric(character.values, currency.field);
        const mayGrant = currency.mode === "track" || canManage;
        return <li key={currency.id}>
          <div><strong>{currency.label}</strong><span>{currency.mode === "track" ? `${current} marcado${current === 1 ? "" : "s"} na trilha` : `${current} disponível`}{typeof currency.max === "number" ? ` · máximo ${currency.max}` : ""}</span></div>
          <div className={styles.actions}>
            <button type="button" disabled={busy || !validAmount} onClick={() => run(() => spendMetaCurrency(character.id, currency.id, amount, reason), `${currency.label}: ${amount} gasto.`)}>Gastar</button>
            {mayGrant && <button type="button" disabled={busy || !validAmount} onClick={() => run(() => spendMetaCurrency(character.id, currency.id, -amount, reason), `${currency.label}: ${amount} recuperado.`)}>{currency.mode === "pool" ? "Conceder" : "Recuperar"}</button>}
          </div>
        </li>;
      })}
    </ul>
    {events.length > 0 && <details className={styles.log}><summary>Últimos ajustes ({events.length})</summary><ol>
      {events.map((event) => <li key={event.id}>
        <span>{event.kind === "experience" ? "Experiência" : event.currency_id ? labels.get(event.currency_id) ?? event.currency_id : event.field_id}: {event.value_before} → {event.value_after}{event.reason ? ` · ${event.reason}` : ""}</span>
        <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString("pt-BR")}</time>
      </li>)}
    </ol></details>}
  </section>;
}
