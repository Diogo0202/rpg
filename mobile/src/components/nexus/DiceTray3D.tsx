import { useEffect, useRef, useState } from "react";
import type { DiceRoll } from "@/lib/dice";
import { seedFrom } from "@dice3d/random";
import { sotdlDice } from "@dice3d/sotdl";
import { hunterDice } from "@dice3d/hunter";
import { attachThrowGesture } from "@dice3d/aim";
import { v5Dice } from "@dice3d/v5";
import { diceStyleFor } from "@dice3d/styles";
import { canUseWebGL, prefersReducedMotion } from "@dice3d/support";
import type { Aim, DieRequest } from "@dice3d/types";
import { classifyV5 } from "@/lib/dice-roller";

/** Text for a settled V5 pool; the difficulty lives in the panel, so bestial failure is not judged here. */
function v5Summary(roll: DiceRoll): string {
  const rolls = roll.terms[0]?.rolls ?? [];
  const v5 = classifyV5(rolls, Math.min(roll.pool?.hungerDice.length ?? 0, rolls.length));
  const head = v5.messyCritical ? "Crítico sujo" : v5.critical ? "Sucesso crítico" : "Resultado";
  return `${head} · ${v5.successes} sucesso${v5.successes === 1 ? "" : "s"}${v5.bestialRisk ? " · Fome mostra 1" : ""}`;
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
  if (!roll.sotdl) return null;
  const d20 = roll.terms[0]?.rolls[0];
  if (!d20) return null;
  const boons = roll.terms[2];
  const boonDice = boons?.rolls ?? [];
  return sotdlDice({ d20, boonDice, netBoons: (boons && boons.subtotal < 0 ? -1 : 1) * boonDice.length });
}

export function canShowTray(roll: DiceRoll | null): boolean {
  return Boolean(roll && trayRequests(roll) && canUseWebGL());
}

/**
 * 3D tray over the local roller. three.js loads on the first throw; the roll is already decided,
 * so the dice only animate onto those faces. Tapping closes it; it also closes on its own.
 */
export function DiceTray3D({ roll, onDone }: { roll: DiceRoll; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"armed" | "rolling" | "settled">("rolling");
  const settled = phase === "settled";
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const interactive = Boolean(roll.pool || roll.hunter) && !prefersReducedMotion();
  const throwRef = useRef<((aim: Aim | null) => void) | null>(null);

  useEffect(() => {
    const requests = trayRequests(roll);
    if (!requests) { doneRef.current(); return; }
    let active = true;
    let timer = 0;
    let tray: { dispose(): void; resize(): void } | null = null;
    let detach = () => {};
    setPhase(interactive ? "armed" : "rolling");
    const onResize = () => tray?.resize();
    void import("@dice3d/tray").then(async ({ DiceTray }) => {
      if (!active || !canvas.current) return;
      const instance = new DiceTray(canvas.current, diceStyleFor(roll.hunter ? "hunter" : roll.pool ? "vampire-v5" : "shadow-demon-lord"));
      tray = instance;
      window.addEventListener("resize", onResize);
      const seed = seedFrom(roll.id);
      const play = async (aim?: Aim) => {
        setPhase("rolling");
        await instance.roll(requests, seed, { reducedMotion: prefersReducedMotion(), aim });
        if (!active) return;
        setPhase("settled");
        timer = window.setTimeout(() => doneRef.current(), 6000);
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
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      detach();
      throwRef.current = null;
      tray?.dispose();
    };
  }, [roll, interactive]);

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
      <p aria-live="polite" className={`relative max-w-sm rounded-md border border-[#c9a14a] bg-[#15130fe6] px-4 py-2 text-center font-display font-semibold text-[#ebe0c9]${interactive ? " mb-16" : ""}`}>
        {settled ? roll.hunter
          ? `${roll.hunter.critical ? "Crítico" : roll.hunter.success ? "Êxito" : "Falha"} · ${roll.total} ${roll.total === 1 ? "sucesso" : "sucessos"} contra dificuldade ${roll.hunter.difficulty}${roll.hunter.desperationOnes ? ` · ${roll.hunter.desperationOnes} ${roll.hunter.desperationOnes === 1 ? "dado de Desespero em 1" : "dados de Desespero em 1"}` : ""}${roll.terms[0].rolls.length + roll.terms[1].rolls.length > 15 ? " · parte dos dados exibida em 3D" : ""}`
          : roll.pool ? v5Summary(roll)
          : `Total ${roll.total}${roll.sotdl ? ` contra ${roll.sotdl.target} · ${roll.sotdl.critical ? "Crítico" : roll.sotdl.success ? "Sucesso" : "Falha"}` : ""}` : phase === "armed" ? "Arraste ou toque para lançar" : "Rolando…"}
      </p>
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
