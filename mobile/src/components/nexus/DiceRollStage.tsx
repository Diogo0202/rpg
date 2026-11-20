import { useEffect, useMemo, useState } from "react";
import { LazyMotion, MotionConfig, domAnimation, m } from "framer-motion";
import type { DiceRoll } from "@/lib/dice";
import {
  ROLL_ANIMATION_MS,
  planDice,
  summarizeRoll,
  type DieTone,
  type RollContext,
  type RollTone,
} from "@/lib/dice-roller";
import { cn } from "@/lib/utils";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Live `prefers-reduced-motion` read straight from matchMedia (no global cache). */
export function usePrefersReducedMotion(): boolean {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_QUERY).matches
      : false;
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(REDUCED_QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

const DIE_TONES: Record<DieTone, string> = {
  neutral: "border-ink/25 bg-card text-ink",
  success: "border-forest-deep/50 bg-card text-ink",
  crit: "border-gold bg-gold/25 text-ink ring-2 ring-gold",
  messy: "border-destructive bg-gold/25 text-destructive ring-2 ring-destructive",
  fail: "border-destructive/60 bg-destructive/10 text-destructive",
  bestial: "border-destructive bg-destructive text-destructive-foreground ring-2 ring-destructive",
};

const ROLL_TONES: Record<RollTone, string> = {
  neutral: "text-ink",
  success: "text-forest-deep",
  fail: "text-destructive",
  crit: "text-ink underline decoration-gold decoration-4 underline-offset-4",
  messy: "text-destructive underline decoration-gold decoration-4 underline-offset-4",
  bestial: "text-destructive underline decoration-destructive decoration-4 underline-offset-4",
};

const TONE_NAMES: Partial<Record<DieTone, string>> = {
  crit: "crítico",
  messy: "dez de fome",
  fail: "falha",
  bestial: "um de fome",
};

type Phase = "rolling" | "done";

export type DiceRollStageProps = {
  roll: DiceRoll | null;
  context: RollContext;
  /** Forces the reduced-motion path regardless of the system preference. */
  reducedMotion?: boolean;
};

/**
 * 2D presentation of an already computed roll. Only transform/opacity are animated, on DOM
 * elements; `will-change` is set only while rolling, and nothing runs after it stops.
 */
export function DiceRollStage({ roll, context, reducedMotion }: DiceRollStageProps) {
  const systemReduced = usePrefersReducedMotion();
  const reduced = reducedMotion ?? systemReduced;
  const rollId = roll?.id ?? null;
  const [phase, setPhase] = useState<Phase>("done");
  const [seenId, setSeenId] = useState<string | null>(null);

  // Start a new presentation only when a different roll arrives.
  if (rollId !== seenId) {
    setSeenId(rollId);
    setPhase(rollId && !reduced ? "rolling" : "done");
  }
  const activePhase: Phase = reduced ? "done" : phase;

  useEffect(() => {
    if (activePhase !== "rolling") return;
    const timer = window.setTimeout(() => setPhase("done"), ROLL_ANIMATION_MS + 120);
    return () => window.clearTimeout(timer);
  }, [activePhase, rollId]);

  const { hunger, difficulty, mode } = context;
  const view = useMemo(() => {
    if (!roll) return null;
    const ctx = { mode, hunger, difficulty };
    return { plan: planDice(roll, ctx), summary: summarizeRoll(roll, ctx) };
  }, [roll, mode, hunger, difficulty]);

  if (!roll || !view) {
    return (
      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="dice-stage-live" />
    );
  }

  const { plan, summary } = view;
  const rolling = activePhase === "rolling";
  const skip = () => setPhase("done");

  const items =
    plan.mode === "individual"
      ? plan.dice.map((die, index) => ({
          key: die.key,
          index,
          tone: die.tone,
          hunger: die.hunger,
          main: String(die.value),
          sub: die.faces ? `d${die.faces}` : "",
          label: `${die.hunger ? (mode === "hunter" ? "Dado de Desespero" : "Dado de fome") : "Dado"} d${die.faces}: ${die.value}${TONE_NAMES[die.tone] && mode !== "hunter" ? `, ${TONE_NAMES[die.tone]}` : ""}`,
        }))
      : plan.groups.map((group, index) => ({
          key: group.key,
          index,
          tone: group.tone,
          hunger: group.hunger,
          main: `×${group.values.length}`,
          sub: group.label,
          label: `${group.label}: ${group.values.length} dados, ${group.crits} críticos, ${group.fails} falhas`,
        }));

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>
        <section className="parchment-inset mt-4 space-y-3 p-3" aria-label="Resultado da rolagem">
          <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="dice-stage-live">
            {summary.announce}
          </div>
          <div className="relative min-h-11">
            {rolling && (
              <button
                type="button"
                onClick={skip}
                aria-label="Pular animação e mostrar o resultado"
                className="absolute inset-0 z-10 min-h-11 w-full touch-manipulation rounded-md bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            )}
            <ul className="flex flex-wrap gap-2" aria-label="Dados da rolagem">
              {items.map((item) => {
                const className = cn(
                  "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-lg border-2 px-2 font-bold tabular-nums shadow-sm",
                  item.hunger && "border-dashed",
                  DIE_TONES[item.tone],
                  mode === "hunter" && (item.hunger ? "border-[#f47a2f] bg-[#17191c] text-[#f47a2f]" : "border-[#ae4c1c] bg-[#f0782c] text-[#17191c]"),
                );
                const content = (
                  <>
                    <span className="text-lg leading-none">{item.main}</span>
                    {item.sub && (
                      <span className="mt-0.5 max-w-24 truncate text-[10px] font-normal leading-none opacity-75">
                        {item.sub}
                      </span>
                    )}
                  </>
                );
                return (
                  <li key={item.key} aria-label={item.label} data-tone={item.tone}>
                    {rolling ? (
                      <m.div
                        className={className}
                        style={{ willChange: "transform, opacity" }}
                        initial={{ opacity: 0, x: -24 + ((item.index * 37) % 48), y: -36, rotate: item.index % 2 ? -200 : 200, scale: 0.6 }}
                        animate={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
                        transition={{
                          duration: ROLL_ANIMATION_MS / 1000,
                          delay: Math.min(item.index * 0.015, 0.15),
                          ease: [0.2, 0.9, 0.3, 1.15],
                        }}
                      >
                        {content}
                      </m.div>
                    ) : (
                      <div className={className}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            {plan.mode === "grouped" && !rolling && (
              <p className="mt-2 break-words text-xs text-ink-muted">
                {plan.groups.map((group) => `${group.label}: ${group.values.join(", ")}`).join(" · ")}
              </p>
            )}
          </div>
          {rolling ? (
            <p className="text-xs text-ink-muted" aria-hidden>
              Toque nos dados para pular.
            </p>
          ) : (
            <div data-testid="dice-stage-result" data-tone={summary.tone}>
              <p className={cn("text-2xl font-bold", ROLL_TONES[summary.tone])}>{summary.headline}</p>
              <p className="text-sm text-ink">{summary.detail}</p>
              {plan.mode === "grouped" && (
                <p className="text-xs text-ink-muted">
                  {plan.dice.length} dados agrupados para manter a animação leve.
                </p>
              )}
            </div>
          )}
        </section>
      </MotionConfig>
    </LazyMotion>
  );
}
