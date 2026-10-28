"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useCharacterSession } from "../lib/character-session";
import {
  getExperienceSettings, listAdvances, purchaseAdvance, quoteServerAdvance, refundAdvance, reviewAdvance, setExperienceApproval,
  type AdvanceRequest, type AdvanceStatus, type CharacterAdvance, type ServerQuote,
} from "../lib/experience-advances";
import { calculateExperienceCost, isExperienceSystem, purchasableTraits, quoteAdvance, type ExperienceKind } from "../lib/experience-math";
import type { SheetTemplate } from "../lib/sheet-template";
import { createClient } from "../lib/supabase/client";
import styles from "./experience-panel.module.css";

/** Histórico do localStorage anterior ao EXP-02: só leitura, como estimativas. */
type LegacyEstimate = { id: string; label: string; kind: ExperienceKind; current: number; target: number; cost: number; createdAt: string };
type SheetContext = { sheetId: string; campaignId: string; ownerId: string; template: SheetTemplate };
type Pending = { request: AdvanceRequest; quote: ServerQuote; operationId: string; version: number };

const legacyKinds: Record<ExperienceKind, string> = {
  attribute: "Atributo", skill: "Habilidade", discipline: "Disciplina de clã", outOfClanDiscipline: "Disciplina externa", bloodPotency: "Potência de Sangue",
};
const statusLabels: Record<AdvanceStatus, string> = { pending: "Aguardando o narrador", applied: "Aplicado", rejected: "Recusado", refunded: "Estornado" };
const systemLabels: Record<string, string> = { "vampire-v5": "Vampiro V5", "vampire-v3": "Vampiro V3", hunter: "Caçador" };

function legacyKey(viewerId: string, characterId: string): string {
  return `rpg-nexus:experience:v1:${encodeURIComponent(viewerId)}:${encodeURIComponent(characterId)}`;
}

function readLegacy(key: string): LegacyEstimate[] {
  try {
    const saved = window.localStorage.getItem(key);
    if (!saved || saved.length > 1_048_576) return [];
    const raw = JSON.parse(saved) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 200).flatMap((item): LegacyEstimate[] => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.label !== "string" || typeof row.kind !== "string" || !(row.kind in legacyKinds)
        || typeof row.current !== "number" || typeof row.target !== "number" || typeof row.createdAt !== "string") return [];
      try {
        const cost = calculateExperienceCost(row.kind as ExperienceKind, row.current, row.target);
        return [{ id: row.id, label: row.label.slice(0, 120), kind: row.kind as ExperienceKind, current: row.current, target: row.target, cost, createdAt: row.createdAt }];
      } catch { return []; }
    });
  } catch { return []; }
}

function downloadEstimates(characterName: string, records: LegacyEstimate[]) {
  const backup = { format: "rpg-nexus-experience-history", format_version: 1, character_name: characterName, kind: "estimates", entries: records };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "rpg-nexus-estimativas-xp.json";
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * EXP-02: o jogador escolhe o traço, vê o custo calculado pelo servidor e
 * confirma. O banco desconta o XP e sobe o traço numa só gravação; o
 * histórico fica em character_advances, visível ao dono e ao narrador.
 */
export function ExperiencePanel({ viewerId, canManage = false }: { viewerId: string; canManage?: boolean }) {
  const { character, acceptSavedCharacter } = useCharacterSession();
  const characterId = character?.id;
  const [context, setContext] = useState<SheetContext | null>(null);
  const [advances, setAdvances] = useState<CharacterAdvance[]>([]);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [trait, setTrait] = useState("");
  const [target, setTarget] = useState(1);
  const [itemName, setItemName] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [legacy, setLegacy] = useState<LegacyEstimate[]>([]);

  const refreshHistory = useCallback(async (sheetId: string) => {
    try { setAdvances(await listAdvances(sheetId)); } catch { /* o histórico é informativo */ }
  }, []);

  useEffect(() => {
    setContext(null); setAdvances([]); setPending(null); setMessage(""); setTrait(""); setLegacy([]);
    if (!characterId) return;
    setLegacy(readLegacy(legacyKey(viewerId, characterId)));
    let active = true;
    (async () => {
      const client = createClient();
      const { data: sheet, error } = await client.from("character_sheets").select("campaign_id,template_id,owner_id").eq("id", characterId).single();
      if (!active) return;
      if (error || !sheet) { setMessage("Não foi possível ler o modelo desta ficha."); return; }
      const { data: template, error: templateError } = await client.from("system_templates").select("schema").eq("id", sheet.template_id).single();
      if (!active) return;
      if (templateError || !template) { setMessage("Não foi possível ler o modelo desta ficha."); return; }
      const schema = template.schema as SheetTemplate;
      setContext({ sheetId: characterId, campaignId: sheet.campaign_id, ownerId: sheet.owner_id, template: schema });
      setTrait(purchasableTraits(schema)[0] ?? "");
      void refreshHistory(characterId);
      getExperienceSettings(sheet.campaign_id).then((settings) => { if (active) setRequiresApproval(settings.requires_approval); }).catch(() => undefined);
    })();
    return () => { active = false; };
  }, [characterId, viewerId, refreshHistory]);

  const template = context?.template;
  const traits = useMemo(() => (template ? purchasableTraits(template) : []), [template]);
  const labels = useMemo(() => new Map((template?.fields ?? []).map((field) => [field.id, field.label])), [template]);
  const field = template?.fields.find((entry) => entry.id === trait);
  const isCollection = field?.kind === "collection";
  const xpField = template?.experience_field ?? null;
  const xpAvailable = character && xpField && typeof character.values[xpField] === "number" ? character.values[xpField] as number : 0;
  const estimate = useMemo(() => {
    if (!template || !character || !trait) return { value: null as number | null, label: "", from: 0, error: "" };
    try {
      const quote = quoteAdvance(template, character.values, trait, target, itemName);
      return { value: quote.cost, label: quote.label, from: quote.from, error: "" };
    } catch (error) { return { value: null, label: "", from: 0, error: error instanceof Error ? error.message : "Pedido inválido." }; }
  }, [template, character, trait, target, itemName]);

  if (!character) return <section className={styles.panel} aria-labelledby="experience-title"><h2 id="experience-title">Experiência</h2><p className={styles.empty}>Selecione uma ficha.</p></section>;

  const supported = template ? isExperienceSystem(template.system_key) && Boolean(xpField) : false;
  const mayBuy = context ? context.ownerId === viewerId || canManage : false;

  async function review() {
    if (!context || !character || estimate.value === null) return;
    const advance: AdvanceRequest = { trait, target_level: target, item_name: isCollection ? itemName.trim() : null };
    setBusy(true);
    try {
      const quote = await quoteServerAdvance(context.sheetId, advance);
      setPending({ request: advance, quote, operationId: crypto.randomUUID(), version: character.version });
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível calcular o custo."); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!context || !character || !pending) return;
    setBusy(true);
    try {
      // Mantém o operationId: repetir depois de uma resposta perdida não cobra duas vezes.
      const result = await purchaseAdvance(context.sheetId, pending.request, pending.version, pending.operationId, reason);
      acceptSavedCharacter({ ...character, version: result.sheet.version, values: result.sheet.values });
      setMessage(result.advance.status === "pending"
        ? `Pedido enviado ao narrador: ${result.advance.cost} XP serão descontados na aprovação.`
        : `${labels.get(result.advance.trait) ?? result.advance.trait} comprado por ${result.advance.cost} XP.`);
      setPending(null); setItemName(""); setReason("");
      await refreshHistory(context.sheetId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível comprar o avanço.");
    } finally { setBusy(false); }
  }

  async function act(action: () => Promise<{ sheet: { version: number; values: Record<string, unknown> } }>, success: string) {
    if (!context || !character) return;
    setBusy(true);
    try {
      const result = await action();
      acceptSavedCharacter({ ...character, version: result.sheet.version, values: result.sheet.values });
      setMessage(success);
      await refreshHistory(context.sheetId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }

  async function toggleApproval(next: boolean) {
    if (!context) return;
    setBusy(true);
    try { setRequiresApproval((await setExperienceApproval(context.campaignId, next)).requires_approval); setMessage(next ? "Compras dos jogadores agora aguardam aprovação." : "Jogadores compram direto."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível mudar a política."); }
    finally { setBusy(false); }
  }

  function discardLegacy() {
    if (!characterId || !window.confirm("Descartar as estimativas antigas deste navegador? Elas nunca foram aplicadas à ficha.")) return;
    try { window.localStorage.removeItem(legacyKey(viewerId, characterId)); setLegacy([]); } catch { setMessage("O navegador recusou a remoção."); }
  }

  const describe = (advance: CharacterAdvance) => {
    const name = labels.get(advance.trait) ?? advance.trait;
    return advance.item_value ? `${name}: ${advance.item_value}` : `${name} ${advance.from_level} → ${advance.to_level}`;
  };

  return <section className={styles.panel} aria-labelledby="experience-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>EXPERIÊNCIA{template?.system_key && systemLabels[template.system_key] ? ` · ${systemLabels[template.system_key]}` : ""}</p>
        <h2 id="experience-title">Comprar avanço</h2>
        <p>O servidor recalcula o custo pela tabela do sistema, desconta o XP e sobe o traço na mesma gravação. Os custos ainda estão em conferência com o livro.</p></div>
      <span className={styles.character}>{character.name} · {xpAvailable} XP</span>
    </header>
    <p className={styles.notice} role="status" aria-live="polite">{message || (!context ? "Lendo o modelo da ficha…" : "")}</p>

    {context && !supported && <p className={styles.empty}>Este modelo não tem tabela de custos de XP (sistemas com compra: Vampiro V5, Vampiro V3 e Caçador) ou não declara o campo de experiência.</p>}

    {canManage && context && <label className={styles.toggle}>
      <input type="checkbox" checked={requiresApproval} disabled={busy} onChange={(event) => void toggleApproval(event.target.checked)} />
      Compras dos jogadores precisam da minha aprovação
    </label>}

    {supported && mayBuy && <div className={styles.form}>
      <label>Traço
        <select value={trait} onChange={(event) => { setTrait(event.target.value); setPending(null); setTarget(1); }}>
          {traits.map((id) => <option key={id} value={id}>{labels.get(id) ?? id}</option>)}
        </select>
      </label>
      {isCollection && <label>Nome do item
        <input value={itemName} maxLength={120} onChange={(event) => { setItemName(event.target.value); setPending(null); }} placeholder="Ex.: Investigação (Cenas de crime)" />
      </label>}
      <label>{isCollection ? "Nível / pontos" : "Nível desejado"}
        <select value={target} onChange={(event) => { setTarget(Number(event.target.value)); setPending(null); }}>
          {Array.from({ length: Math.min(10, typeof field?.max === "number" ? field.max : isCollection ? 5 : 10) }, (_, index) => index + 1)
            .map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <div className={styles.cost} aria-live="polite"><span>{estimate.label || "Estimativa"}{!isCollection && estimate.value !== null ? ` · atual ${estimate.from}` : ""}</span>
        <strong>{estimate.value ?? "—"} XP</strong>{estimate.error && <small>{estimate.error}</small>}</div>
      <button type="button" disabled={busy || estimate.value === null || Boolean(pending)} onClick={() => void review()}>Ver custo</button>
    </div>}

    {pending && <div className={styles.confirm} role="group" aria-label="Confirmar compra">
      <p><strong>{pending.quote.label}</strong>: {labels.get(pending.request.trait) ?? pending.request.trait}
        {pending.request.item_name ? ` (${pending.request.item_name})` : ""} {pending.quote.from_level} → {pending.quote.to_level} custa <strong>{pending.quote.cost} XP</strong>.
        {" "}Disponível: {pending.quote.xp_available ?? 0} XP.{pending.quote.requires_approval ? " O narrador precisa aprovar." : ""}</p>
      {pending.quote.cost !== estimate.value && <p className={styles.warning}>O servidor calculou um valor diferente da estimativa local; vale o do servidor.</p>}
      <label>Motivo (opcional)<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: treino com o mentor" /></label>
      <div className={styles.actions}>
        <button type="button" disabled={busy || (pending.quote.xp_available ?? 0) < pending.quote.cost} onClick={() => void confirm()}>
          {pending.quote.requires_approval ? "Enviar ao narrador" : "Confirmar compra"}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => setPending(null)}>Cancelar</button>
      </div>
    </div>}

    <div className={styles.historyHeading}><h3>Histórico de avanços</h3></div>
    {advances.length === 0 ? <p className={styles.empty}>Nenhum avanço comprado nesta ficha.</p> : <ol className={styles.history}>
      {advances.map((advance) => <li key={advance.id}>
        <div><strong>{describe(advance)}</strong>
          <span>{statusLabels[advance.status]} · {advance.cost} XP{advance.xp_before !== null ? ` · saldo ${advance.xp_before} → ${advance.xp_after}` : ""}{advance.reason ? ` · ${advance.reason}` : ""}</span>
          <time dateTime={advance.created_at}>{new Date(advance.created_at).toLocaleString("pt-BR")}</time></div>
        <div className={styles.actions}>
          {advance.status === "pending" && canManage && <button type="button" disabled={busy} onClick={() => void act(() => reviewAdvance(advance.id, true), "Avanço aprovado e aplicado.")}>Aprovar</button>}
          {advance.status === "pending" && (canManage || advance.actor_id === viewerId) && <button type="button" className={styles.remove} disabled={busy}
            onClick={() => void act(() => reviewAdvance(advance.id, false), canManage ? "Avanço recusado." : "Pedido cancelado.")}>{canManage ? "Recusar" : "Cancelar pedido"}</button>}
          {advance.status === "applied" && canManage && <button type="button" className={styles.remove} disabled={busy}
            onClick={() => { if (window.confirm(`Estornar ${describe(advance)} e devolver ${advance.cost} XP?`)) void act(() => refundAdvance(advance.id), "Avanço estornado; XP devolvido."); }}>Estornar</button>}
        </div>
      </li>)}
    </ol>}

    {legacy.length > 0 && <details className={styles.legacy}>
      <summary>Estimativas antigas deste navegador ({legacy.length})</summary>
      <p>Registros da calculadora anterior. São só estimativas: nunca alteraram a ficha nem o XP. Compre de novo acima para aplicar.</p>
      <ol className={styles.history}>{legacy.map((record) => <li key={record.id}>
        <div><strong>{record.label}</strong><span>{legacyKinds[record.kind]} · {record.current} → {record.target} · estimativa {record.cost} XP</span>
          <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString("pt-BR")}</time></div>
      </li>)}</ol>
      <div className={styles.actions}>
        <button type="button" onClick={() => downloadEstimates(character.name, legacy)}>Exportar JSON</button>
        <button type="button" className={styles.remove} onClick={discardLegacy}>Descartar</button>
      </div>
    </details>}
  </section>;
}
