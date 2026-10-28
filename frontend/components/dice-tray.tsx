"use client";

import { useEffect, useRef, useState } from "react";

import { attachThrowGesture } from "@dice3d/aim";
import type { Aim, DieRequest } from "@dice3d/types";
import { canUseWebGL, prefersReducedMotion } from "@dice3d/support";
import { diceStyleFor } from "@dice3d/styles";
import { seedFrom } from "@dice3d/random";
import styles from "./dice-tray.module.css";

/** `interactive` dice wait on the table for the player to drag or tap before they are thrown. */
export type TrayRoll = { id: string; systemKey: string; requests: DieRequest[]; summary: string; interactive?: boolean };

type Phase = "armed" | "rolling" | "settled";

/**
 * 3D dice laid over the roll panel. three.js loads only when the first roll opens the tray. The
 * result is already decided by the server; the tray just shows it landing, then closes itself.
 * Without WebGL it reports done at once and the panel keeps its text result.
 */
export function DiceTrayOverlay({ roll, onDone, autoCloseMs = 4000 }: { roll: TrayRoll | null; onDone: () => void; autoCloseMs?: number | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("rolling");
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const throwRef = useRef<((aim: Aim | null) => void) | null>(null);
  // Reduced motion skips the throw: the dice appear already resting on the result.
  const interactive = Boolean(roll?.interactive) && !prefersReducedMotion();

  useEffect(() => {
    if (!roll) return;
    if (!canUseWebGL()) { doneRef.current(); return; }
    let active = true;
    let timer = 0;
    let tray: { dispose(): void; resize(): void } | null = null;
    let detach = () => {};
    setPhase(interactive ? "armed" : "rolling");
    const onResize = () => tray?.resize();
    void import("@dice3d/tray").then(async ({ DiceTray }) => {
      if (!active || !canvas.current) return;
      const instance = new DiceTray(canvas.current, diceStyleFor(roll.systemKey));
      tray = instance;
      window.addEventListener("resize", onResize);
      const seed = seedFrom(roll.id);
      const play = async (aim?: Aim) => {
        setPhase("rolling");
        await instance.roll(roll.requests, seed, { reducedMotion: prefersReducedMotion(), aim });
        if (!active) return;
        setPhase("settled");
        if (autoCloseMs !== null) timer = window.setTimeout(() => doneRef.current(), interactive ? autoCloseMs + 2000 : autoCloseMs);
      };
      if (!interactive) return play();
      instance.prepare(roll.requests, seed);
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
  }, [roll, autoCloseMs, interactive]);

  if (!roll) return null;
  const settled = phase === "settled";
  return <div ref={overlay} className={styles.overlay} data-interactive={interactive || undefined} role="dialog" aria-label="Rolagem de dados" onClick={interactive ? undefined : () => doneRef.current()}>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
    <p className={styles.summary} aria-live="polite" data-visible={settled || undefined}>{settled ? roll.summary : phase === "armed" ? "Arraste ou toque para lançar" : "Rolando…"}</p>
    {interactive && <div className={styles.actions}>
      {phase === "armed" && <button type="button" onClick={(event) => { event.stopPropagation(); throwRef.current?.(null); }}>Lançar</button>}
      <button type="button" className={styles.secondary} onClick={(event) => { event.stopPropagation(); doneRef.current(); }}>Fechar</button>
    </div>}
    <span className={styles.hint}>{interactive ? (settled ? "Toque para fechar" : "") : "Toque para fechar"}</span>
  </div>;
}
