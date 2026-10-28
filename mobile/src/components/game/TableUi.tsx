import { useEffect, useState, type ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation, m } from "framer-motion";
import { CloudOff, RotateCcw, Trash2 } from "lucide-react";
import type { QueuedAction } from "@/lib/game/action-queue";
import { cn } from "@/lib/utils";
import { Btn } from "@/components/nexus/ui";

function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const read = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setReduced(list.matches);
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

export type DieView = { face: number; tone?: "normal" | "special" | "bad" | "good"; label?: string };

/**
 * A row of 2D dice (DOM + Framer Motion transform/opacity only, no WebGL). With `onToggle` each
 * die is a ≥44px toggle button for a reroll pick; `rollKey` restarts the entrance animation.
 */
export function DiceRow({ dice, rollKey, selected = [], onToggle, disabled, label }: {
  dice: DieView[]; rollKey: string; selected?: number[]; onToggle?: (index: number) => void; disabled?: boolean; label: string;
}) {
  const reduced = useReducedMotion();
  const tones = {
    normal: "border-ink/30 bg-card text-ink",
    special: "border-destructive bg-destructive text-destructive-foreground",
    bad: "border-destructive/60 bg-destructive/10 text-destructive",
    good: "border-primary bg-primary/20 text-ink",
  };
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>
        <ul className="flex flex-wrap gap-2" aria-label={label}>
          {dice.map((die, index) => {
            const picked = selected.includes(index);
            const className = cn(
              "flex min-h-11 min-w-11 items-center justify-center rounded-lg border-2 px-2 text-lg font-bold tabular-nums shadow-sm",
              tones[die.tone ?? "normal"], picked && "ring-4 ring-ring",
            );
            const motion = reduced ? {} : {
              initial: { opacity: 0, y: -28, rotate: index % 2 ? -160 : 160, scale: 0.6 },
              animate: { opacity: 1, y: 0, rotate: 0, scale: 1 },
              transition: { duration: 0.45, delay: Math.min(index * 0.03, 0.2), ease: [0.2, 0.9, 0.3, 1.15] as const },
            };
            const name = `${die.label ?? "Dado"} ${die.face}${picked ? ", marcado para rerrolar" : ""}`;
            return (
              <li key={`${rollKey}-${index}`}>
                {onToggle ? (
                  <m.button type="button" className={cn(className, "touch-manipulation")} aria-pressed={picked} aria-label={name}
                    disabled={disabled} onClick={() => onToggle(index)} {...motion}>{die.face}</m.button>
                ) : (
                  <m.div className={className} aria-label={name} role="img" {...motion}>{die.face}</m.div>
                )}
              </li>
            );
          })}
        </ul>
      </MotionConfig>
    </LazyMotion>
  );
}

export function StatusLine({ message, tone = "info" }: { message: string; tone?: "info" | "error" | "queued" }) {
  if (!message) return <p className="sr-only" role="status" aria-live="polite" />;
  return (
    <p role={tone === "error" ? "alert" : "status"} aria-live="polite"
      className={cn("rounded-lg p-3 text-sm", tone === "error" ? "bg-destructive/10 text-destructive" : tone === "queued" ? "bg-warning text-warning-foreground" : "parchment-inset text-ink")}>
      {message}
    </p>
  );
}

/** Offline banner and the adjustments waiting to be sent (or refused, to discard). */
export function QueueBanner({ online, queued, sheetId, onRetry, onDiscard }: {
  online: boolean; queued: QueuedAction[]; sheetId?: string; onRetry: (id: string) => void; onDiscard: (id: string) => void;
}) {
  const items = sheetId ? queued.filter((item) => item.sheet_id === sheetId) : queued;
  if (online && !items.length) return null;
  return (
    <section className="parchment-inset space-y-2 p-3" aria-label="Ajustes pendentes">
      {!online && <p className="flex items-center gap-2 text-sm font-semibold text-ink" role="status"><CloudOff className="size-4" aria-hidden />Sem conexão: ajustes ficam na fila; rolagens precisam do servidor.</p>}
      {items.length > 0 && <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.operation_id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink">
            <span>{item.label} · {item.state === "failed" ? <strong className="text-destructive">recusado: {item.last_error}</strong> : "na fila"}</span>
            {item.state === "failed" && <span className="flex gap-2">
              <Btn size="sm" variant="outline" onClick={() => onRetry(item.operation_id)} aria-label={`Tentar de novo: ${item.label}`}><RotateCcw className="size-4" aria-hidden />Tentar</Btn>
              <Btn size="sm" variant="ghost" onClick={() => onDiscard(item.operation_id)} aria-label={`Descartar: ${item.label}`}><Trash2 className="size-4" aria-hidden />Descartar</Btn>
            </span>}
          </li>
        ))}
      </ul>}
    </section>
  );
}

export function Field({ label, children, htmlFor, hint }: { label: string; children: ReactNode; htmlFor: string; hint?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">{label}{hint && <span className="ml-1 font-normal text-ink-muted">{hint}</span>}</label>
      {children}
    </div>
  );
}

export function Check({ id, checked, onChange, disabled, children }: { id: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label htmlFor={id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm text-ink", disabled && "cursor-not-allowed opacity-60")}>
      <input id={id} type="checkbox" className="size-5 accent-primary" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export type HistoryItem = { id: string; title: string; text: string; at?: string };
export function History({ items, empty }: { items: HistoryItem[]; empty: string }) {
  if (!items.length) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="parchment-inset p-3 text-sm text-ink">
          <div className="flex flex-wrap justify-between gap-2"><strong>{item.title}</strong>{item.at && <time className="text-xs text-ink-muted">{item.at}</time>}</div>
          <p>{item.text}</p>
        </li>
      ))}
    </ol>
  );
}

export function formatWhen(value: string | number | undefined): string {
  if (value === undefined) return "";
  try { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); } catch { return ""; }
}

export const inputClass = "field-input min-h-11 w-full";
