"use client";

import { useState } from "react";

import { sotdlDice, sotdlFateDice } from "@dice3d/sotdl";
import { hunterDice } from "@dice3d/hunter";
import { v5Dice } from "@dice3d/v5";
import { poolResult, sotdlFateResult, sotdlResult } from "@dice3d/result";
import { DiceTrayOverlay, type TrayRoll } from "./dice-tray";

/**
 * Development-only harness: throws Shadow of the Demon Lord dice with fixed values so the landed
 * faces can be compared with the text. Served only by app/dev/dice-tray outside production.
 */
const sotdl = (d20: number, modifier: number, boonValue: number, netBoons: number, target = 10) => {
  const total = d20 + modifier + boonValue;
  return sotdlResult({ d20, modifier, boonValue, netBoons, total, target, success: total >= target, critical: d20 === 20 || (total >= 20 && total >= target + 5) });
};
const pool = (dice: number[], difficulty: number) => {
  const criticalPairs = Math.floor(dice.filter((value) => value === 10).length / 2);
  const successes = dice.filter((value) => value >= 6).length + criticalPairs * 2;
  return poolResult({ dice, criticalPairs, successes, difficulty, verdict: successes >= difficulty ? (criticalPairs ? "Crítico" : "Sucesso") : "Falha", tone: successes >= difficulty ? (criticalPairs ? "critical" : "success") : "failure" });
};

const CASES: Array<{ label: string; requests: TrayRoll["requests"]; summary: string; systemKey?: string; result?: TrayRoll["result"] }> = [
  { label: "1d20", requests: sotdlDice({ d20: 17, boonDice: [], netBoons: 0 }), summary: "d20 17", result: sotdl(17, 0, 0, 0) },
  { label: "1d20 + 2 dádivas", requests: sotdlDice({ d20: 9, boonDice: [2, 5], netBoons: 2 }), summary: "d20 9 · dádivas 2 e 5 (vale 5)", result: sotdl(9, 2, 5, 2, 14) },
  { label: "1d20 + 1 perdição", requests: sotdlDice({ d20: 20, boonDice: [4], netBoons: -1 }), summary: "d20 20 · perdição 4", result: sotdl(20, -1, -4, -1) },
  { label: "1d20 + 10 d6", requests: sotdlDice({ d20: 1, boonDice: [1, 2, 3, 4, 5, 6, 6, 5, 4, 3], netBoons: 10 }), summary: "d20 1 · 10 dádivas (vale 6)", result: sotdl(1, 1, 6, 10) },
  { label: "Teste de destino", requests: sotdlFateDice(6), summary: "destino 6", result: sotdlFateResult(6, "recovers", "Recupera-se") },
  { label: "Caçador 5 dados", requests: hunterDice([1, 6, 8, 10, 3], []).requests, summary: "Caçador · laranja 1, 6, 8, 10, 3", systemKey: "hunter", result: pool([1, 6, 8, 10, 3], 3) },
  { label: "Caçador com Desespero", requests: hunterDice([4, 6, 10, 2, 8], [1, 10, 5]).requests, summary: "Caçador · laranja 4, 6, 10, 2, 8 · preto 1, 10, 5", systemKey: "hunter", result: { ...pool([4, 6, 10, 2, 8, 1, 10, 5], 4), note: "1 dado(s) de Desespero em 1" } },
  { label: "V5 6 dados, Fome 2", requests: v5Dice([10, 3, 7, 1, 6, 9], 2), summary: "V5 · Fome 10, 3 · comuns 7, 1, 6, 9", systemKey: "vampire-v5", result: pool([10, 3, 7, 1, 6, 9], 5) },
  { label: "V5 15 dados, Fome 5", requests: v5Dice([1, 10, 4, 9, 2, 10, 8, 3, 7, 6, 5, 10, 1, 9, 2], 5), summary: "V5 · bandeja cheia", systemKey: "vampire-v5", result: pool([1, 10, 4, 9, 2, 10, 8, 3, 7, 6, 5, 10, 1, 9, 2], 6) },
  { label: "Só texto (sem soma)", requests: sotdlDice({ d20: 12, boonDice: [], netBoons: 0 }), summary: "d20 12 · sem painel de soma" },
];

export function DiceTrayFixture() {
  const [roll, setRoll] = useState<TrayRoll | null>(null);
  const [count, setCount] = useState(0);
  const [hold, setHold] = useState(false);
  return <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
    <h1>Bandeja de dados 3D</h1>
    <label style={{ display: "block", margin: "8px 0" }}><input type="checkbox" checked={hold} onChange={(event) => setHold(event.target.checked)} /> Manter a bandeja aberta</label>
    <div role="group" aria-label="Rolagens de teste" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {CASES.map((item) => <button key={item.label} type="button" onClick={() => {
        setCount((value) => value + 1);
        setRoll({ id: `dev-${count}-${item.label}`, systemKey: item.systemKey ?? "shadow-demon-lord", requests: item.requests, summary: item.summary, result: item.result, interactive: item.systemKey === "vampire-v5" || item.systemKey === "hunter" });
      }} style={{ minHeight: 40, padding: "8px 14px" }}>{item.label}</button>)}
    </div>
    <DiceTrayOverlay roll={roll} onDone={() => setRoll(null)} autoCloseMs={hold ? null : 8000} />
  </main>;
}
