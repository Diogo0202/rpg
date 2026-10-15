"use client";

import { useEffect, useMemo, useState } from "react";

import { calculateExperienceCost, type ExperienceKind } from "../lib/experience-math";
import { useCharacterSession } from "../lib/character-session";
import styles from "./experience-panel.module.css";

type ExperienceRecord = {
  id: string;
  label: string;
  kind: ExperienceKind;
  current: number;
  target: number;
  cost: number;
  createdAt: string;
};
type StorageState = { key: string | null; status: "loading" | "ready" | "error" };

const kindLabels: Record<ExperienceKind, string> = {
  attribute: "Atributo",
  skill: "Habilidade",
  discipline: "Disciplina de clã",
  outOfClanDiscipline: "Disciplina externa",
  bloodPotency: "Potência de Sangue",
};
const kinds = Object.keys(kindLabels) as ExperienceKind[];

function getStorageKey(viewerId: string, characterId: string | undefined): string | null {
  if (!viewerId || !characterId) return null;
  return `rpg-nexus:experience:v1:${encodeURIComponent(viewerId)}:${encodeURIComponent(characterId)}`;
}

function validateStoredHistory(raw: unknown): ExperienceRecord[] {
  if (!Array.isArray(raw) || raw.length > 200) throw new Error("O histórico local excede 200 registros ou tem formato inválido.");
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Registro ${index + 1} inválido.`);
    const row = item as Record<string, unknown>;
    const fields = ["id", "label", "kind", "current", "target", "cost", "createdAt"];
    if (Object.keys(row).some((key) => !fields.includes(key)) || fields.some((key) => !Object.prototype.hasOwnProperty.call(row, key))) {
      throw new Error(`Registro ${index + 1} contém campos inválidos.`);
    }
    if (typeof row.id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(row.id)) throw new Error(`Registro ${index + 1} tem id inválido.`);
    if (typeof row.label !== "string" || !row.label.trim() || row.label.length > 120) throw new Error(`Registro ${index + 1} tem rótulo inválido.`);
    if (typeof row.kind !== "string" || !kinds.includes(row.kind as ExperienceKind)) throw new Error(`Registro ${index + 1} tem tipo inválido.`);
    if (typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt))) throw new Error(`Registro ${index + 1} tem data inválida.`);
    const current = row.current;
    const target = row.target;
    const cost = row.cost;
    if (typeof current !== "number" || typeof target !== "number" || typeof cost !== "number") throw new Error(`Registro ${index + 1} tem valores numéricos inválidos.`);
    const expected = calculateExperienceCost(row.kind as ExperienceKind, current, target);
    if (cost !== expected) throw new Error(`Registro ${index + 1} tem custo inconsistente.`);
    return { id: row.id, label: row.label, kind: row.kind as ExperienceKind, current, target, cost, createdAt: row.createdAt };
  });
}

function downloadHistory(characterName: string, records: ExperienceRecord[]) {
  const backup = { format: "rpg-nexus-experience-history", format_version: 1, character_name: characterName, entries: records };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "rpg-nexus-historico-xp.json";
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ExperiencePanel({ viewerId }: { viewerId: string }) {
  const { character } = useCharacterSession();
  const storageKey = getStorageKey(viewerId, character?.id);
  const [history, setHistory] = useState<ExperienceRecord[]>([]);
  const [storageState, setStorageState] = useState<StorageState>({ key: null, status: "loading" });
  const [kind, setKind] = useState<ExperienceKind>("attribute");
  const [label, setLabel] = useState("");
  const [current, setCurrent] = useState(0);
  const [target, setTarget] = useState(1);
  const [message, setMessage] = useState("");
  const ready = storageKey !== null && storageState.key === storageKey && storageState.status === "ready";
  const visibleHistory = ready ? history : [];
  const cost = useMemo(() => {
    try { return { value: calculateExperienceCost(kind, current, target), error: "" }; }
    catch (error) { return { value: null, error: error instanceof Error ? error.message : "Níveis inválidos." }; }
  }, [kind, current, target]);

  useEffect(() => {
    setHistory([]);
    if (!storageKey) {
      setStorageState({ key: null, status: "loading" });
      setMessage("");
      return;
    }
    setStorageState({ key: storageKey, status: "loading" });
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && new TextEncoder().encode(saved).byteLength > 1_048_576) throw new Error("O histórico local excede 1 MB.");
      const records = saved ? validateStoredHistory(JSON.parse(saved) as unknown) : [];
      setHistory(records);
      setStorageState({ key: storageKey, status: "ready" });
      setMessage("");
    } catch (error) {
      setStorageState({ key: storageKey, status: "error" });
      setMessage(`Não foi possível ler o histórico local: ${error instanceof Error ? error.message : "acesso recusado"}`);
    }
  }, [storageKey]);

  function commit(next: ExperienceRecord[], success: string) {
    if (!storageKey || !ready) { setMessage("Aguarde a leitura local da ficha antes de editar o histórico."); return false; }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setHistory(next);
      setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof DOMException && error.name === "QuotaExceededError"
        ? "O navegador ficou sem espaço. Nenhuma alteração foi salva."
        : "O navegador recusou a gravação. Nenhuma alteração foi salva.");
      return false;
    }
  }

  function addRecord() {
    const cleanLabel = label.trim();
    if (!cleanLabel || cleanLabel.length > 120) { setMessage("Informe uma descrição de avanço com até 120 caracteres."); return; }
    if (cost.value === null) { setMessage(cost.error); return; }
    if (history.length >= 200) { setMessage("O histórico aceita até 200 avanços."); return; }
    const record: ExperienceRecord = {
      id: crypto.randomUUID(), label: cleanLabel, kind, current, target, cost: cost.value, createdAt: new Date().toISOString(),
    };
    if (commit([record, ...history], "Avanço registrado no histórico local. Nenhum valor da ficha ou saldo de XP foi alterado.")) setLabel("");
  }

  function removeRecord(record: ExperienceRecord) {
    if (!window.confirm(`Remover “${record.label}” do histórico local? Esta ação não pode ser desfeita.`)) return;
    commit(history.filter((item) => item.id !== record.id), "Registro removido do histórico local.");
  }

  return <section className={styles.panel} aria-labelledby="experience-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>COMPATIBILIDADE RPG ATLAS fb34a5b</p><h2 id="experience-title">Calculadora de experiência</h2>
        <p>O custo é uma referência matemática. Registrar um avanço não aplica pontos à ficha nem desconta XP automaticamente.</p></div>
      <span className={styles.character}>{character?.name ?? "Nenhuma ficha selecionada"}</span>
    </header>
    <p className={styles.notice} role="status" aria-live="polite">{message || (storageKey && !ready ? "Carregando histórico deste personagem…" : !storageKey ? "Selecione uma ficha para manter o histórico local." : "")}</p>
    <div className={styles.form}>
      <label>Categoria
        <select value={kind} onChange={(event) => setKind(event.target.value as ExperienceKind)}>
          {kinds.map((entry) => <option value={entry} key={entry}>{kindLabels[entry]}</option>)}
        </select>
      </label>
      <label>Descrição do avanço
        <input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: Investigação" />
      </label>
      <label>Nível atual
        <select value={current} onChange={(event) => setCurrent(Number(event.target.value))}>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select>
      </label>
      <label>Nível desejado
        <select value={target} onChange={(event) => setTarget(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select>
      </label>
      <div className={styles.cost} aria-live="polite"><span>Custo calculado</span><strong>{cost.value ?? "—"} XP</strong>{cost.error && <small>{cost.error}</small>}</div>
      <button type="button" disabled={!ready || cost.value === null || !label.trim()} onClick={addRecord}>Registrar no histórico local</button>
    </div>
    <div className={styles.historyHeading}><h3>Histórico local</h3><button type="button" disabled={!ready || history.length === 0} onClick={() => character && downloadHistory(character.name, history)}>Exportar JSON</button></div>
    {visibleHistory.length === 0 ? <p className={styles.empty}>{ready ? "Nenhum avanço registrado nesta ficha." : "O histórico ficará disponível após a leitura local."}</p> : <ol className={styles.history}>
      {visibleHistory.map((record) => <li key={record.id}>
        <div><strong>{record.label}</strong><span>{kindLabels[record.kind]} · {record.current} → {record.target} · {record.cost} XP</span><time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString("pt-BR")}</time></div>
        <button className={styles.remove} type="button" disabled={!ready} onClick={() => removeRecord(record)}>Excluir</button>
      </li>)}
    </ol>}
  </section>;
}
