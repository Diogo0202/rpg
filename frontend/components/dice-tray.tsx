"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { attachThrowGesture } from "@dice3d/aim";
import type { Aim, DieRequest } from "@dice3d/types";
import { canUseWebGL, prefersReducedMotion } from "@dice3d/support";
import { diceStyleFor } from "@dice3d/styles";
import { seedFrom } from "@dice3d/random";
import { equation, resultText, signed, type TrayResult } from "@dice3d/result";
import type { DieLabel } from "@dice3d/tray";
import styles from "./dice-tray.module.css";

/**
 * `interactive` dice wait on the table for the player to drag or tap before they are thrown.
 * `result` is the sum the tray shows once they rest; without it only `summary` is shown.
 */
export type TrayRoll = { id: string; systemKey: string; requests: DieRequest[]; summary: string; interactive?: boolean; result?: TrayResult };

type Phase = "armed" | "rolling" | "settled";

/** Total, the parcels that add up to it and the verdict, shown as soon as the dice rest. */
function ResultPanel({ result, detail }: { result: TrayResult; detail: string }) {
  return <div className={styles.result} data-tone={result.tone}>
    {result.verdict && <strong className={styles.verdict}>{result.verdict}</strong>}
    <p className={styles.total} aria-label={resultText(result)}>
      <span className={styles.number}>{result.total}</span>
      {result.unit && <span className={styles.unit}>{result.unit}</span>}
      {result.against && <span className={styles.against}>{result.against.label} {result.against.value}</span>}
    </p>
    {result.parts.length > 1 && <ol className={styles.parts} aria-label={`Conta: ${equation(result)}`}>
      {result.parts.map((part, index) => <li key={index} style={{ "--step": index } as CSSProperties}>
        <b>{index === 0 ? part.value : signed(part.value)}</b><span>{part.label}</span>
      </li>)}
      <li className={styles.sum} style={{ "--step": result.parts.length } as CSSProperties}><b>= {result.total}</b><span>Total</span></li>
    </ol>}
    {result.note && <p className={styles.note}>{result.note}</p>}
    <p className={styles.detail}>{detail}</p>
  </div>;
}

/**
 * 3D dice laid over the roll panel. three.js loads only when the first roll opens the tray. The
 * result is already decided by the server; the tray shows it landing, then the value of each die
 * and the sum. It stays open until the player closes it, unless `autoCloseMs` is given.
 * Without WebGL it reports done at once and the panel keeps its text result.
 */
export function DiceTrayOverlay({ roll, onDone, autoCloseMs = null }: { roll: TrayRoll | null; onDone: () => void; autoCloseMs?: number | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("rolling");
  const [labels, setLabels] = useState<DieLabel[]>([]);
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
    let tray: { dispose(): void; resize(): void; labels(): DieLabel[] } | null = null;
    let detach = () => {};
    setPhase(interactive ? "armed" : "rolling");
    setLabels([]);
    const onResize = () => {
      if (!tray) return;
      tray.resize();
      setLabels(tray.labels());
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") doneRef.current(); };
    window.addEventListener("keydown", onKey);
    void import("@dice3d/tray").then(async ({ DiceTray }) => {
      if (!active || !canvas.current) return;
      const instance = new DiceTray(canvas.current, diceStyleFor(roll.systemKey));
      tray = instance;
      window.addEventListener("resize", onResize);
      const seed = seedFrom(roll.id);
      const play = async (aim?: Aim) => {
        setPhase("rolling");
        // Room for the result panel and, when the dice were thrown by hand, the buttons under it.
        await instance.roll(roll.requests, seed, { reducedMotion: prefersReducedMotion(), aim, panelHeight: roll.result ? (interactive ? 310 : 250) : (interactive ? 150 : 90) });
        if (!active) return;
        setLabels(instance.labels());
        setPhase("settled");
        if (autoCloseMs !== null) timer = window.setTimeout(() => doneRef.current(), autoCloseMs);
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
      window.removeEventListener("keydown", onKey);
      detach();
      throwRef.current = null;
      tray?.dispose();
    };
  }, [roll, autoCloseMs, interactive]);

  if (!roll) return null;
  const settled = phase === "settled";
  return <div ref={overlay} className={styles.overlay} data-interactive={interactive || undefined} role="dialog" aria-label="Rolagem de dados" onClick={interactive ? undefined : () => doneRef.current()}>
    <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
    {settled && labels.map((label, index) => <span
      key={index} className={styles.badge} data-role={label.role} data-dropped={label.kept ? undefined : ""} aria-hidden="true"
      style={{ left: label.x + label.radius * 0.72, top: label.y - label.radius * 0.72 }}
    >{label.value}</span>)}
    <div className={styles.panel} aria-live="polite">
      {settled && roll.result
        ? <ResultPanel result={roll.result} detail={roll.summary} />
        : <p className={styles.summary} data-visible={settled || undefined}>{settled ? roll.summary : phase === "armed" ? "Arraste ou toque para lançar" : "Rolando…"}</p>}
    </div>
    {interactive && <div className={styles.actions}>
      {phase === "armed" && <button type="button" onClick={(event) => { event.stopPropagation(); throwRef.current?.(null); }}>Lançar</button>}
      <button type="button" className={styles.secondary} onClick={(event) => { event.stopPropagation(); doneRef.current(); }}>Fechar</button>
    </div>}
    <span className={styles.hint}>{interactive ? (settled ? "Toque para fechar" : "") : "Toque ou Esc para fechar"}</span>
  </div>;
}
