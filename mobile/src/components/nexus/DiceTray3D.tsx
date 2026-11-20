import { useEffect, useRef, useState } from "react";
import type { DiceRoll } from "@/lib/dice";
import { seedFrom } from "@dice3d/random";
import { sotdlDice } from "@dice3d/sotdl";
import { hunterDice } from "@dice3d/hunter";
import { attachThrowGesture } from "@dice3d/aim";
import { v5Dice } from "@dice3d/v5";
import { diceStyleFor } from "@dice3d/styles";
import { canUseWebGL, prefersReducedMotion } from "@dice3d/support";
import { MAX_TRAY_DICE } from "@dice3d/simulate";
import { equation, expressionResult, poolResult, resultText, signed, sotdlResult, type TrayResult, type TrayTone } from "@dice3d/result";
import type { DieLabel } from "@dice3d/tray";
import type { Aim, DieKind, DieRequest } from "@dice3d/types";
import { classifyV5 } from "@/lib/dice-roller";

/** Free NdM rolls the tray can throw: only d6, d10 and d20, all added, within the tray limit. */
function expressionRequests(roll: DiceRoll): DieRequest[] | null {
  const requests: DieRequest[] = [];
  for (const term of roll.terms) {
    if (!term.rolls.length) continue;
    const faces = /^\d+d(6|10|20)$/.exec(term.label)?.[1];
    if (!faces) return null;
    for (const value of term.rolls) requests.push({ kind: `d${faces}` as DieKind, value, role: "main" });
  }
  return requests.length >= 1 && requests.length <= MAX_TRAY_DICE ? requests : null;
}

/** Dice the 3D tray can show for a local roll; null when the roll has no 3D set yet. */
export function trayRequests(roll: DiceRoll): DieRequest[] | null {
  if (roll.hunter) {
    try {
      return hunterDice(roll.terms[0]?.rolls ?? [], roll.terms[1]?.rolls ?? []).requests;
    } catch { return null; }
  }
  if (roll.pool) {
    try {
      return v5Dice(roll.terms[0]?.rolls ?? [], roll.pool.hungerDice.length);
    } catch { return null; }
  }
  if (!roll.sotdl) return expressionRequests(roll);
  const d20 = roll.terms[0]?.rolls[0];
  if (!d20) return null;
  const boons = roll.terms[2];
  const boonDice = boons?.rolls ?? [];
  return sotdlDice({ d20, boonDice, netBoons: (boons && boons.subtotal < 0 ? -1 : 1) * boonDice.length });
}

/** Sum and verdict the tray shows once the dice rest, built from the roll that was already decided. */
export function trayResult(roll: DiceRoll): TrayResult {
  if (roll.hunter) {
    const normal = roll.terms[0]?.rolls ?? [];
    const desperate = roll.terms[1]?.rolls ?? [];
    const ones = roll.hunter.desperationOnes;
    const omitted = normal.length + desperate.length - MAX_TRAY_DICE;
    return poolResult({
      dice: [...normal, ...desperate], criticalPairs: roll.hunter.criticalPairs, successes: roll.total, difficulty: roll.hunter.difficulty,
      verdict: roll.hunter.critical ? "Crítico" : roll.hunter.success ? "Êxito" : "Falha",
      tone: roll.hunter.critical ? "critical" : !roll.hunter.success ? "failure" : ones ? "warning" : "success",
      note: [
        ones ? `${ones} ${ones === 1 ? "dado de Desespero em 1" : "dados de Desespero em 1"}` : "",
        omitted > 0 ? "parte dos dados exibida em 3D" : "",
      ].filter(Boolean).join(" · ") || undefined,
    });
  }
  if (roll.pool) {
    const rolls = roll.terms[0]?.rolls ?? [];
    const v5 = classifyV5(rolls, Math.min(roll.pool.hungerDice.length, rolls.length));
    // The difficulty lives in the panel, so success and bestial failure are not judged here.
    const tone: TrayTone | undefined = v5.messyCritical ? "warning" : v5.critical ? "critical" : undefined;
    return poolResult({
      dice: rolls, criticalPairs: Math.floor(roll.pool.tens / 2), successes: roll.total,
      verdict: v5.messyCritical ? "Crítico sujo" : v5.critical ? "Sucesso crítico" : undefined, tone,
      note: v5.bestialRisk ? "Fome mostra 1" : undefined,
    });
  }
  if (roll.sotdl) {
    const boons = roll.terms[2];
    return sotdlResult({
      d20: roll.terms[0]?.rolls[0] ?? 0, modifier: roll.terms[1]?.subtotal ?? 0, boonValue: boons?.subtotal ?? 0,
      netBoons: boons ? (boons.subtotal < 0 ? -1 : 1) * boons.rolls.length : 0,
      total: roll.total, target: roll.sotdl.target, success: roll.sotdl.success, critical: roll.sotdl.critical,
    });
  }
  return expressionResult(roll.terms, roll.total);
}

export function canShowTray(roll: DiceRoll | null): boolean {
  return Boolean(roll && trayRequests(roll) && canUseWebGL());
}

const TONE: Record<TrayTone, string> = { success: "#7fae6b", failure: "#c2513f", critical: "#e9c25a", warning: "#d99a3d" };
const RIM: Partial<Record<DieRequest["role"], string>> = { hunger: "#c2513f", bane: "#c2513f", boon: "#7fae6b", desperation: "#e2762a" };

/**
 * 3D tray over the local roller. three.js loads on the first throw; the roll is already decided,
 * so the dice only animate onto those faces. Once they rest, each die gets its value and the panel
 * shows the sum with the modifiers. It stays open until the player closes it.
 */
export function DiceTray3D({ roll, onDone }: { roll: DiceRoll; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"armed" | "rolling" | "settled">("rolling");
  const [labels, setLabels] = useState<DieLabel[]>([]);
  const settled = phase === "settled";
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const interactive = Boolean(roll.pool || roll.hunter) && !prefersReducedMotion();
  const throwRef = useRef<((aim: Aim | null) => void) | null>(null);

  useEffect(() => {
    const requests = trayRequests(roll);
    if (!requests) { doneRef.current(); return; }
    let active = true;
    let tray: { dispose(): void; resize(): void; labels(): DieLabel[] } | null = null;
    let detach = () => {};
    setPhase(interactive ? "armed" : "rolling");
    setLabels([]);
    const onResize = () => {
      if (!tray) return;
      tray.resize();
      setLabels(tray.labels());
    };
    void import("@dice3d/tray").then(async ({ DiceTray }) => {
      if (!active || !canvas.current) return;
      const instance = new DiceTray(canvas.current, diceStyleFor(roll.hunter ? "hunter" : roll.pool ? "vampire-v5" : "shadow-demon-lord"));
      tray = instance;
      window.addEventListener("resize", onResize);
      const seed = seedFrom(roll.id);
      const play = async (aim?: Aim) => {
        setPhase("rolling");
        // Room for the result panel, which sits above the bottom navigation and the throw buttons.
        await instance.roll(requests, seed, { reducedMotion: prefersReducedMotion(), aim, panelHeight: interactive ? 360 : 300 });
        if (!active) return;
        setLabels(instance.labels());
        setPhase("settled");
      };
      if (!interactive) return play();
      instance.prepare(requests, seed);
      let thrown = false;
      throwRef.current = (aim) => {
        if (thrown) { doneRef.current(); return; }
        thrown = true;
        void play(aim ?? undefined);
      };
      if (overlay.current) detach = attachThrowGesture(overlay.current, (aim) => throwRef.current?.(aim));
    }).catch(() => { if (active) doneRef.current(); });
    return () => {
      active = false;
      window.removeEventListener("resize", onResize);
      detach();
      throwRef.current = null;
      tray?.dispose();
    };
  }, [roll, interactive]);

  const result = settled ? trayResult(roll) : null;
  const tone = result?.tone ? TONE[result.tone] : "#c9a14a";
  return (
    <div
      ref={overlay}
      role="dialog"
      aria-label="Rolagem de dados"
      className="fixed inset-0 z-50 grid cursor-pointer touch-none select-none place-items-end justify-center px-4 pb-[calc(6rem+env(safe-area-inset-bottom))]"
      style={{ background: "radial-gradient(circle at 50% 40%, #2a1a12cc, #0d0c0bf2 70%)" }}
      onClick={interactive ? undefined : () => doneRef.current()}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      {settled && labels.map((label, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`pointer-events-none absolute grid h-7 min-w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 bg-[#15130f] px-1.5 font-display text-base font-bold tabular-nums shadow-[0_2px_8px_#000a] ${label.kept ? "text-[#f4ead2]" : "text-[#a39c8f] line-through opacity-80"}`}
          style={{ left: label.x + label.radius * 0.72, top: label.y - label.radius * 0.72, borderColor: label.kept ? RIM[label.role] ?? "#c9a14a" : "#6b665f" }}
        >
          {label.value}
        </span>
      ))}
      <div aria-live="polite" className={`relative w-full max-w-sm${interactive ? " mb-16" : ""}`}>
        {result ? (
          <div className="grid justify-items-center gap-1.5 rounded-lg border bg-[#15130ff2] px-4 pb-3 pt-3.5 text-center font-display text-[#ebe0c9] shadow-[0_10px_32px_#000a]" style={{ borderColor: tone }}>
            {result.verdict && (
              <strong className="rounded-full px-3 py-0.5 font-sans text-xs font-bold uppercase tracking-wider text-[#15130f]" style={{ background: tone }}>
                {result.verdict}
              </strong>
            )}
            <p className="flex flex-wrap items-baseline justify-center gap-x-2.5 gap-y-1" aria-label={resultText(result)}>
              <span className="text-5xl font-bold leading-none tabular-nums text-[#fbf3de]">{result.total}</span>
              {result.unit && <span className="text-lg">{result.unit}</span>}
              {result.against && <span className="border-l border-[#d8ccb4]/30 pl-2.5 text-[#d8ccb4]">{result.against.label} {result.against.value}</span>}
            </p>
            {result.parts.length > 1 && (
              <ol className="mt-0.5 flex flex-wrap justify-center gap-2" aria-label={`Conta: ${equation(result)}`}>
                {result.parts.map((part, index) => (
                  <li key={index} className="grid min-w-14 justify-items-center rounded-md border border-[#d8ccb4]/20 bg-[#221e18] px-2.5 py-1">
                    <b className="text-xl tabular-nums">{index === 0 ? part.value : signed(part.value)}</b>
                    <span className="font-sans text-[11px] text-[#bfb49d]">{part.label}</span>
                  </li>
                ))}
                <li className="grid min-w-14 justify-items-center rounded-md border bg-[#2b241a] px-2.5 py-1" style={{ borderColor: tone }}>
                  <b className="text-xl tabular-nums">= {result.total}</b>
                  <span className="font-sans text-[11px] text-[#bfb49d]">Total</span>
                </li>
              </ol>
            )}
            {result.note && <p className="font-sans text-xs text-[#e6c98a]">{result.note}</p>}
            {roll.label && <p className="font-sans text-xs text-[#bfb49d]">{roll.label}</p>}
          </div>
        ) : (
          <p className="mx-auto w-fit rounded-md border border-[#c9a14a] bg-[#15130fe6] px-4 py-2 text-center font-display font-semibold text-[#ebe0c9]">
            {phase === "armed" ? "Arraste ou toque para lançar" : "Rolando…"}
          </p>
        )}
      </div>
      {interactive && (
        <div className="absolute bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 gap-3">
          {phase === "armed" && (
            <button type="button" className="min-h-11 rounded-md border border-[#c9a14a] bg-[#15130fe6] px-4 text-sm font-semibold text-[#ebe0c9]" onClick={(event) => { event.stopPropagation(); throwRef.current?.(null); }}>
              Lançar
            </button>
          )}
          <button type="button" className="min-h-11 rounded-md border border-[#d8ccb4]/40 bg-[#15130fe6] px-4 text-sm text-[#d8ccb4]" onClick={(event) => { event.stopPropagation(); doneRef.current(); }}>
            Fechar
          </button>
        </div>
      )}
      <span className="absolute right-4 top-[calc(0.9rem+env(safe-area-inset-top))] text-xs text-[#d8ccb4]">{interactive ? (settled ? "Toque para fechar" : "") : "Toque para fechar"}</span>
    </div>
  );
}
