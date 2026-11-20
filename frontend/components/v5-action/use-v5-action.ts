"use client";

import { useEffect, useRef, useState } from "react";

import { useCharacterSession, type SessionCharacter } from "../../lib/character-session";
import { CHRONICLE_ACTIVITY_HEADER, newRollKey, parseChronicleActivity } from "../../lib/chronicle-context";
import { browserDb } from "../../lib/data/browser";
import * as sheetRepo from "../../lib/data/sheets";
import { applyV5Damage } from "../../lib/data/v5";
import { ensureOk } from "../../lib/api/http";
import { apiBase, sessionJson, sessionSend, type SessionMessages } from "../../lib/api/session";
import { bloodPotency } from "../../../shared/rules/v5-blood";
import {
  actionChronicle, attackDamageSplit, attackDamageOperationId, canApplyAttackDamage, damageRpcArgs, describeDamageResult,
  mergeRollHistory, storedModifierPreview, type AttackResult, type DamageKind, type DamageResult,
} from "../../lib/v5-action-roll";
import { canThrowV5, v5Dice } from "@dice3d/v5";
import { poolResult } from "@dice3d/result";
import type { TrayRoll } from "../dice-tray";
import {
  actionTagsFor, buildNumericFields, damageKey, integerValue, maxTrack, outcomeLabel, SHEET_COLUMNS, storedEntry, surgeBonusUsed,
  trackDamage, traitChoices, TRACK_NAMES,
  type HistoryEntry, type IncomingDamage, type NumericField, type PanelRoll, type RerollResponse, type StoredAttack, type TargetSheet, type Track,
} from "./model";

type Operation = { id: number; controller: AbortController; character: SessionCharacter };

const ACTION_MESSAGES: SessionMessages = {
  missingApi: "Configure NEXT_PUBLIC_API_URL para rolar a ação.",
  signedOut: "Entre na campanha para rolar a ação.",
  rejected: "A API recusou a rolagem.",
  validationDetail: true,
};

async function apiPost(path: string, body: unknown, signal: AbortSignal, fallback?: string): Promise<{ body: unknown; headers: Headers }> {
  const messages = fallback ? { ...ACTION_MESSAGES, rejected: fallback } : ACTION_MESSAGES;
  const response = ensureOk(await sessionSend(path, { method: "POST", body, signal }, messages), messages);
  return { body: response.body, headers: response.headers };
}

async function fetchAttack(rollId: string, signal: AbortSignal): Promise<AttackResult> {
  const { body } = await apiPost(`/api/v1/v5/rolls/${rollId}/attack`, { use_equipped_weapon: true }, signal, "Não foi possível calcular o dano do ataque.");
  return (body as StoredAttack).attack;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function sheetOf(result: DamageResult): SessionCharacter {
  const { id, name, version, values, effects } = result.sheet;
  return { id, name, version, values, effects } as SessionCharacter;
}

/**
 * Estado e chamadas do painel de ação V5. Só uma operação roda por vez: a nova cancela a anterior,
 * e um resultado que chega depois da troca de ficha é ignorado.
 */
export function useV5Action(campaignId: string, canEdit: boolean, canNarrate: boolean) {
  const { character, contextTags, acceptSavedCharacter } = useCharacterSession();
  const selectedRef = useRef(character);
  selectedRef.current = character;
  const operationId = useRef(0);
  const pendingOperation = useRef<Operation | null>(null);
  const historyRef = useRef(new Map<string, HistoryEntry[]>());
  const surgeOperations = useRef(new Map<string, string>());
  const [historyRevision, setHistoryRevision] = useState(0);
  const [fieldData, setFieldData] = useState<{ characterId: string; fields: NumericField[]; error: string } | null>(null);
  const [remoteHistory, setRemoteHistory] = useState<{ sheetId: string; entries: HistoryEntry[]; error: string } | null>(null);
  const [attributeId, setAttributeId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [manualPool, setManualPool] = useState(6);
  const [difficulty, setDifficulty] = useState(3);
  const [useSurge, setUseSurge] = useState(false);
  const [turnKey, setTurnKey] = useState("");
  const [attackMode, setAttackMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tray, setTray] = useState<TrayRoll | null>(null);
  const [message, setMessage] = useState("");
  const [rerollPick, setRerollPick] = useState<{ rollId: string; indices: number[] } | null>(null);
  const [targets, setTargets] = useState<TargetSheet[]>([]);
  const [targetId, setTargetId] = useState("");
  const [targetArmor, setTargetArmor] = useState(true);
  // F1: the attack may hit Willpower (social or mental attacks); physical Health damage is halved for vampires on the server.
  const [targetTrack, setTargetTrack] = useState<Track>("health");
  const [targetPhysical, setTargetPhysical] = useState(true);
  const [incoming, setIncoming] = useState<IncomingDamage>({ track: "health", superficial: 1, aggravated: 0, armor: true, physical: true });

  // F1: rolls saved on the server (other devices and earlier sessions), merged with this session's.
  useEffect(() => {
    const sheetId = character?.id;
    if (!sheetId || !apiBase()) {
      setRemoteHistory(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const body = await sessionJson(`/api/v1/v5/sheets/${encodeURIComponent(sheetId)}/rolls?limit=20`, { signal: controller.signal }, {
          signedOut: "Entre na campanha para ver o histórico guardado.",
          rejected: "Não foi possível ler o histórico guardado.",
          validationDetail: true,
        });
        if (!Array.isArray(body)) throw new Error("Não foi possível ler o histórico guardado.");
        if (controller.signal.aborted) return;
        setRemoteHistory({ sheetId, error: "", entries: (body as PanelRoll[]).map((roll) => storedEntry(roll, storedModifierPreview(roll.details))) });
      } catch (error) {
        if (!controller.signal.aborted) setRemoteHistory({ sheetId, entries: [], error: errorText(error, "Falha ao ler o histórico guardado.") });
      }
    })();
    return () => controller.abort();
  }, [character?.id]);

  useEffect(() => {
    const selected = character;
    if (!selected) {
      setFieldData(null);
      setMessage("");
      return;
    }
    const controller = new AbortController();
    let active = true;
    const isCurrent = () => active && !controller.signal.aborted && selectedRef.current === selected;
    setFieldData(null);
    void (async () => {
      try {
        const db = browserDb();
        const { data: sheet, error: sheetError } = await sheetRepo.findSheetTemplateId(db, selected.id, campaignId, controller.signal);
        if (!isCurrent()) return;
        if (sheetError || !sheet) throw new Error("A ficha não pertence a esta campanha ou não está acessível.");
        const { data: template, error: templateError } = await sheetRepo.findApprovedTemplateSchema(db, sheet.template_id, campaignId, controller.signal);
        if (!isCurrent()) return;
        if (templateError || !template) throw new Error("Não foi possível ler o modelo da ficha.");
        setFieldData({ characterId: selected.id, fields: buildNumericFields(template.schema, selected.values), error: "" });
      } catch (error) {
        if (isCurrent()) setFieldData({ characterId: selected.id, fields: [], error: errorText(error, "Falha ao ler os campos do modelo.") });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [campaignId, character]);

  useEffect(() => {
    operationId.current += 1;
    pendingOperation.current?.controller.abort();
    pendingOperation.current = null;
    setBusy(false);
    setMessage("");
    setAttributeId("");
    setSkillId("");
    setManualPool(6);
    setDifficulty(3);
    setUseSurge(false);
    setTurnKey("");
    setRerollPick(null);
  }, [character?.id, campaignId]);

  // Narrator only: the campaign sheets that can receive attack damage. RLS still decides on apply.
  useEffect(() => {
    if (!canNarrate) {
      setTargets([]);
      setTargetId("");
      return;
    }
    const controller = new AbortController();
    void (async () => {
      const { data, error } = await sheetRepo.listSheetNames(browserDb(), campaignId, controller.signal);
      if (controller.signal.aborted) return;
      if (error || !Array.isArray(data)) {
        setTargets([]);
        return;
      }
      const rows = (data as { id: unknown; name: unknown }[])
        .filter((row): row is TargetSheet => typeof row.id === "string" && typeof row.name === "string");
      setTargets(rows);
      setTargetId((current) => rows.some((row) => row.id === current) ? current : "");
    })();
    return () => controller.abort();
  }, [campaignId, canNarrate]);

  const fieldsReady = fieldData !== null && fieldData.characterId === character?.id;
  const fields = fieldsReady ? fieldData.fields : [];
  const { attributes: attributeChoices, skills: skillChoices } = traitChoices(fields);

  useEffect(() => {
    if (!attributeChoices.some((field) => field.id === attributeId)) setAttributeId(attributeChoices[0]?.id ?? "");
    if (!skillChoices.some((field) => field.id === skillId)) setSkillId(skillChoices[0]?.id ?? "");
  }, [fields, attributeChoices, skillChoices, attributeId, skillId]);

  function beginOperation(selected: SessionCharacter): Operation {
    pendingOperation.current?.controller.abort();
    const next = { id: ++operationId.current, controller: new AbortController(), character: selected };
    pendingOperation.current = next;
    setBusy(true);
    setMessage("");
    return next;
  }

  function operationIsCurrent(operation: Operation): boolean {
    return !operation.controller.signal.aborted
      && operation.id === operationId.current
      && selectedRef.current === operation.character;
  }

  function endOperation(operation: Operation) {
    if (operation.id !== operationId.current) return;
    pendingOperation.current = null;
    setBusy(false);
  }

  /** Abre uma operação para a ficha atual, roda `work` e mostra o erro dela se ainda for a operação vigente. */
  async function runOperation(fallback: string, work: (operation: Operation, selected: SessionCharacter) => Promise<void>) {
    const selected = character;
    if (!selected) return;
    const operation = beginOperation(selected);
    try {
      await work(operation, selected);
    } catch (error) {
      if (operationIsCurrent(operation)) setMessage(errorText(error, fallback));
    } finally {
      endOperation(operation);
    }
  }

  function updateEntry(sheetId: string, rollId: string, update: (entry: HistoryEntry) => HistoryEntry) {
    const entries = historyRef.current.get(sheetId) ?? [];
    historyRef.current.set(sheetId, entries.map((entry) => entry.roll.id === rollId ? update(entry) : entry));
    // Stored (server) rolls live in remoteHistory; keep them updatable too (attack, applied targets).
    setRemoteHistory((current) => current && current.sheetId === sheetId
      ? { ...current, entries: current.entries.map((entry) => entry.roll.id === rollId ? update(entry) : entry) } : current);
    setHistoryRevision((value) => value + 1);
  }

  /** Busca o dano do ataque e grava no histórico; uma falha fica na própria entrada. */
  async function attachAttack(operation: Operation, sheetId: string, rollId: string, fallback: string, extra: Partial<HistoryEntry> = {}) {
    try {
      const attack = await fetchAttack(rollId, operation.controller.signal);
      if (operationIsCurrent(operation)) updateEntry(sheetId, rollId, (item) => ({ ...item, ...extra, attack, attackError: "" }));
    } catch (error) {
      if (operationIsCurrent(operation)) updateEntry(sheetId, rollId, (item) => ({ ...item, attackError: errorText(error, fallback) }));
    }
  }

  // Stored rolls carry no persisted attack: the server derives it from the stored outcome (margin) + equipped weapon.
  function calculateStoredAttack(entry: HistoryEntry) {
    return runOperation("Falha ao calcular o dano.", (operation, selected) =>
      attachAttack(operation, selected.id, entry.roll.id, "Falha ao calcular o dano.", { attackRequested: true }));
  }

  async function refreshSheet(selected: SessionCharacter, signal: AbortSignal) {
    const { data } = await sheetRepo.findSheet(browserDb(), selected.id, campaignId, SHEET_COLUMNS, signal);
    if (data) acceptSavedCharacter(data as SessionCharacter);
  }

  /** Valida a parada antes de abrir a operação; devolve a mensagem de erro ou o bônus de Surto. */
  function checkRoll(selected: SessionCharacter, pool: number): { error: string } | { surgeKey: string } {
    if (!Number.isInteger(pool) || pool < 0 || pool > 30 || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 100) {
      return { error: "Use uma parada de 0 a 30 dados e dificuldade de 1 a 100." };
    }
    const hunger = integerValue(selected.values.fome);
    if (hunger === null || hunger < 0 || hunger > 5) return { error: "A ficha precisa ter Fome entre 0 e 5 antes da rolagem." };
    const surgeKey = useSurge ? turnKey.trim() : "";
    if (useSurge && !surgeKey) return { error: "Informe a chave desta rodada para usar Surto de Sangue." };
    const surgeBonus = useSurge ? bloodPotency(integerValue(selected.values.potencia_sangue) ?? 0).surge : 0;
    if (pool + surgeBonus > 30) return { error: "Pool mais Surto de Sangue excede 30 dados." };
    return { surgeKey };
  }

  /** Mesmo id de operação para a mesma ficha e rodada, assim um reenvio não gasta Surto duas vezes. */
  function surgeOperationFor(sheetId: string, surgeKey: string): string {
    const receipt = `${sheetId}:${surgeKey}`;
    let operation = surgeOperations.current.get(receipt);
    if (!operation) { operation = crypto.randomUUID(); surgeOperations.current.set(receipt, operation); }
    return operation;
  }

  function showOnTray(roll: PanelRoll, actionName: string) {
    // The server already decided the dice; the tray only throws them onto those faces.
    if (!canThrowV5(roll.normal_dice.length + roll.hunger_dice.length)) return;
    const verdict = outcomeLabel(roll);
    setTray({
      id: roll.id, systemKey: "vampire-v5", interactive: true,
      requests: v5Dice([...roll.hunger_dice, ...roll.normal_dice], roll.hunger_dice.length),
      summary: `${actionName} · ${roll.outcome.successes} sucessos / dif. ${roll.difficulty} · ${verdict}`,
      result: poolResult({
        dice: [...roll.hunger_dice, ...roll.normal_dice], criticalPairs: roll.outcome.critical_pairs,
        successes: roll.outcome.successes, difficulty: roll.difficulty, verdict,
        tone: roll.outcome.messy_critical ? "warning" : roll.outcome.clean_critical ? "critical" : roll.outcome.success ? "success" : "failure",
      }),
    });
  }

  async function performRoll(pool: number, actionName: string, actionTags: string[] = contextTags, traits: { attributeId: string; skillId: string } | null = null) {
    const selected = character;
    if (!selected) return;
    const check = checkRoll(selected, pool);
    if ("error" in check) { setMessage(check.error); return; }
    const chronicle = actionChronicle({
      sheetId: selected.id, campaignId, attributeId: traits?.attributeId, skillId: traits?.skillId, rollKey: newRollKey("v5-action"),
    });
    await runOperation("Falha ao rolar a ação.", async (operation) => {
      // V5-07: the database rolls the dice and stores them; Hunger, effects and damage come from the saved sheet.
      const surge = useSurge ? { surge_turn_key: check.surgeKey, surge_operation_id: surgeOperationFor(selected.id, check.surgeKey) } : {};
      const { body, headers } = await apiPost(`/api/v1/v5/sheets/${selected.id}/rolls`, {
        pool, difficulty, context_tags: actionTags, ...surge, ...(chronicle ? { chronicle } : {}),
      }, operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      const roll = body as PanelRoll;
      const surgeUsed = surgeBonusUsed(roll.details);
      const entry: HistoryEntry = {
        roll, preview: storedModifierPreview(roll.details), recordedAt: new Date().toLocaleTimeString(),
        actionName: `${attackMode ? `Ataque · ${actionName}` : actionName}${surgeUsed ? ` · Surto +${surgeUsed}` : ""}`,
        attackRequested: attackMode, attack: null, attackError: "",
        chronicle: parseChronicleActivity(headers.get(CHRONICLE_ACTIVITY_HEADER)),
        applied: [],
      };
      historyRef.current.set(selected.id, [entry, ...(historyRef.current.get(selected.id) ?? [])].slice(0, 8));
      setHistoryRevision((value) => value + 1);
      setRerollPick(null);
      if (surgeUsed) setUseSurge(false);
      showOnTray(roll, entry.actionName);
      if (attackMode) await attachAttack(operation, selected.id, roll.id, "Falha ao calcular o dano.");
    });
  }

  function rerollWithWillpower(entry: HistoryEntry) {
    if (!rerollPick || rerollPick.rollId !== entry.roll.id || !rerollPick.indices.length) return;
    const indices = rerollPick.indices;
    return runOperation("Falha ao rerrolar.", async (operation, selected) => {
      const { body } = await apiPost(`/api/v1/v5/rolls/${entry.roll.id}/willpower-reroll`, { normal_indices: indices }, operation.controller.signal, "Não foi possível rerrolar.");
      if (!operationIsCurrent(operation)) return;
      const result = body as RerollResponse;
      updateEntry(selected.id, entry.roll.id, (item) => ({ ...item, roll: { ...result.roll, details: result.roll.details ?? item.roll.details } }));
      setRerollPick(null);
      setMessage(result.willpower_spent ? "Rerrolagem feita. 1 dano superficial de Vontade foi marcado na ficha." : "Rerrolagem feita. Este modelo de ficha não tem trilha de Vontade.");
      if (entry.attackRequested) await attachAttack(operation, selected.id, entry.roll.id, "Falha ao recalcular o dano.");
      if (result.willpower_spent && operationIsCurrent(operation)) await refreshSheet(selected, operation.controller.signal);
    });
  }

  function applyAttackToTarget(entry: HistoryEntry) {
    const target = targets.find((item) => item.id === targetId);
    const split = attackDamageSplit(entry.attack);
    if (!character || !target || !split || !canApplyAttackDamage({ canNarrate, attack: entry.attack, targetId })) return;
    if (entry.applied.includes(target.id)) return;
    return runOperation("Falha ao aplicar o dano no alvo.", async (operation, selected) => {
      const operationUuid = await attackDamageOperationId(entry.roll.id, target.id);
      if (!operationIsCurrent(operation)) return;
      const { data, error } = await applyV5Damage(browserDb(), damageRpcArgs({
        sheetId: target.id, track: targetTrack, superficial: split.superficial, aggravated: split.aggravated,
        armor: targetArmor, operationId: operationUuid, reason: `Ataque de ${selected.name}`, physical: targetPhysical,
      }), operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if (error || !data) throw new Error(`O servidor recusou o dano. Confira a trilha de ${TRACK_NAMES[targetTrack]} do alvo e o acesso à ficha.`);
      const result = data as DamageResult;
      if (result.sheet?.id === selected.id) acceptSavedCharacter(sheetOf(result));
      updateEntry(selected.id, entry.roll.id, (item) => ({ ...item, applied: [...new Set([...item.applied, target.id])] }));
      setMessage(describeDamageResult(result, target.name));
    });
  }

  function applyDamage(track: Track, superficial: number, aggravated: number, armor: boolean, physical = false) {
    if (!character || !canEdit) return;
    if (![superficial, aggravated].every((value) => Number.isInteger(value) && value >= 0 && value <= 30) || superficial + aggravated === 0) {
      setMessage("Informe de 0 a 30 pontos de cada tipo, com pelo menos um ponto de dano.");
      return;
    }
    return runOperation("Falha ao aplicar dano.", async (operation, selected) => {
      const { data, error } = await applyV5Damage(browserDb(), damageRpcArgs({
        sheetId: selected.id, track, superficial, aggravated, armor, operationId: crypto.randomUUID(), physical,
      }), operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if (error || !data) throw new Error("O servidor recusou o dano. Confira a trilha e o acesso à ficha.");
      const result = data as DamageResult;
      acceptSavedCharacter(sheetOf(result));
      setMessage(describeDamageResult(result));
    });
  }

  function changeDamage(track: Track, kind: DamageKind, amount: -1 | 1) {
    const selected = character;
    if (!selected || !canEdit) return;
    if (maxTrack(selected.values, track) === 0) return;
    // Adding goes through the atomic RPC so a full track converts Superficial into Aggravated.
    if (amount > 0) return applyDamage(track, kind === "superficial" ? 1 : 0, kind === "aggravated" ? 1 : 0, false);
    const damage = trackDamage(selected.values, track);
    const next = (kind === "superficial" ? damage.superficial : damage.aggravated) + amount;
    if (next < 0) {
      setMessage("Não há dano desse tipo para remover.");
      return;
    }
    const updatedValues = { ...selected.values, [damageKey(track, kind)]: next };
    return runOperation("Falha ao atualizar dano.", async (operation) => {
      const { data, error } = await sheetRepo.replaceSheetValues(browserDb(), { id: selected.id, campaignId, version: selected.version },
        updatedValues, SHEET_COLUMNS, operation.controller.signal);
      if (!operationIsCurrent(operation)) return;
      if (error || !data) throw new Error("A ficha mudou em outra sessão. Atualize a sessão antes de ajustar o dano.");
      acceptSavedCharacter(data as SessionCharacter);
      setMessage("Dano atualizado na ficha.");
    });
  }

  function rollManual() {
    void performRoll(manualPool, "Rolagem manual");
  }

  function quickRoll(field: NumericField, kind: "attribute" | "skill") {
    const other = fields.find((item) => item.id === (kind === "attribute" ? skillId : attributeId));
    const total = field.value + (other?.value ?? 0);
    const name = kind === "attribute" ? `${field.label} + ${other?.label ?? "0"}` : `${other?.label ?? "0"} + ${field.label}`;
    const currentAttributeId = kind === "attribute" ? field.id : attributeId;
    const currentSkillId = kind === "skill" ? field.id : skillId;
    setAttributeId(currentAttributeId);
    setSkillId(currentSkillId);
    void performRoll(total, name, actionTagsFor(currentAttributeId, contextTags), { attributeId: currentAttributeId, skillId: currentSkillId });
  }

  const sessionHistory = character ? historyRef.current.get(character.id) ?? [] : [];
  const remote = remoteHistory && remoteHistory.sheetId === character?.id ? remoteHistory : null;
  void historyRevision;

  return {
    character, contextTags, busy, message, tray, closeTray: () => setTray(null),
    fieldsError: fieldsReady ? fieldData.error : "", fieldsLoaded: fieldsReady,
    fields, attributeChoices, skillChoices,
    roll: {
      attributeId, setAttributeId, skillId, setSkillId, manualPool, setManualPool, difficulty, setDifficulty,
      useSurge, setUseSurge, turnKey, setTurnKey, attackMode, setAttackMode,
      selectedPool: (fields.find((field) => field.id === attributeId)?.value ?? 0) + (fields.find((field) => field.id === skillId)?.value ?? 0),
    },
    rollManual, quickRoll,
    history: {
      entries: mergeRollHistory(sessionHistory, remote?.entries ?? []),
      sessionRollIds: new Set(sessionHistory.map((entry) => entry.roll.id)),
      remoteError: remote?.error ?? "",
      rerollPick, setRerollPick,
    },
    rerollWithWillpower, calculateStoredAttack,
    target: { targets, targetId, setTargetId, targetArmor, setTargetArmor, targetTrack, setTargetTrack, targetPhysical, setTargetPhysical },
    applyAttackToTarget,
    incoming, setIncoming, applyDamage, changeDamage,
  };
}

export type V5Action = ReturnType<typeof useV5Action>;
