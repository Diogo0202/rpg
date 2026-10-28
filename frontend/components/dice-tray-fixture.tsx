"use client";

import { useState } from "react";

import { sotdlDice, sotdlFateDice } from "@dice3d/sotdl";
import { hunterDice } from "@dice3d/hunter";
import { v5Dice } from "@dice3d/v5";
import { DiceTrayOverlay, type TrayRoll } from "./dice-tray";

/**
 * Development-only harness: throws Shadow of the Demon Lord dice with fixed values so the landed
 * faces can be compared with the text. Served only by app/dev/dice-tray outside production.
 */
const CASES: Array<{ label: string; requests: TrayRoll["requests"]; summary: string; systemKey?: string }> = [
  { label: "1d20", requests: sotdlDice({ d20: 17, boonDice: [], netBoons: 0 }), summary: "d20 17" },
  { label: "1d20 + 2 dádivas", requests: sotdlDice({ d20: 9, boonDice: [2, 5], netBoons: 2 }), summary: "d20 9 · dádivas 2 e 5 (vale 5)" },
  { label: "1d20 + 1 perdição", requests: sotdlDice({ d20: 20, boonDice: [4], netBoons: -1 }), summary: "d20 20 · perdição 4" },
  { label: "1d20 + 10 d6", requests: sotdlDice({ d20: 1, boonDice: [1, 2, 3, 4, 5, 6, 6, 5, 4, 3], netBoons: 10 }), summary: "d20 1 · 10 dádivas (vale 6)" },
  { label: "Teste de destino", requests: sotdlFateDice(6), summary: "destino 6" },
  { label: "Caçador 5 dados", requests: hunterDice([1, 6, 8, 10, 3], []).requests, summary: "Caçador · laranja 1, 6, 8, 10, 3", systemKey: "hunter" },
  { label: "Caçador com Desespero", requests: hunterDice([4, 6, 10, 2, 8], [1, 10, 5]).requests, summary: "Caçador · laranja 4, 6, 10, 2, 8 · preto 1, 10, 5", systemKey: "hunter" },
  { label: "V5 6 dados, Fome 2", requests: v5Dice([10, 3, 7, 1, 6, 9], 2), summary: "V5 · Fome 10, 3 · comuns 7, 1, 6, 9", systemKey: "vampire-v5" },
  { label: "V5 15 dados, Fome 5", requests: v5Dice([1, 10, 4, 9, 2, 10, 8, 3, 7, 6, 5, 10, 1, 9, 2], 5), summary: "V5 · bandeja cheia", systemKey: "vampire-v5" },
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
        setRoll({ id: `dev-${count}-${item.label}`, systemKey: item.systemKey ?? "shadow-demon-lord", requests: item.requests, summary: item.summary, interactive: item.systemKey === "vampire-v5" || item.systemKey === "hunter" });
      }} style={{ minHeight: 40, padding: "8px 14px" }}>{item.label}</button>)}
    </div>
    <DiceTrayOverlay roll={roll} onDone={() => setRoll(null)} autoCloseMs={hold ? null : 4000} />
  </main>;
}
