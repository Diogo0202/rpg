/**
 * What the tray shows once the dice rest: the parcels of the sum, the total and the verdict.
 * Pure, so the same builders serve the web panels, the local mobile roller and the Node tests.
 */
export type TrayPart = { label: string; value: number };
export type TrayTone = "success" | "failure" | "critical" | "warning";

export type TrayResult = {
  /** Parcels in the order they are added. Empty when they do not add up to the given total. */
  parts: TrayPart[];
  total: number;
  /** "sucessos" for pools; absent for a plain sum. */
  unit?: string;
  against?: { label: string; value: number };
  verdict?: string;
  tone?: TrayTone;
  note?: string;
};

type Extra = Omit<TrayResult, "parts" | "total">;

/** The total always wins: a sum that disagrees with it is hidden instead of shown wrong. */
function build(parts: TrayPart[], total: number, extra: Extra = {}): TrayResult {
  const sum = parts.reduce((value, part) => value + part.value, 0);
  const clean = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)) as Extra;
  return { parts: sum === total ? parts : [], total, ...clean };
}

export function signed(value: number): string {
  return value >= 0 ? `+${value}` : `−${Math.abs(value)}`;
}

/** "14 + 2 − 5 = 11", or just the total when there is nothing to add. */
export function equation(result: TrayResult): string {
  if (result.parts.length < 2) return String(result.total);
  const sum = result.parts.map((part, index) => index === 0 ? String(part.value) : `${part.value >= 0 ? "+" : "−"} ${Math.abs(part.value)}`).join(" ");
  return `${sum} = ${result.total}`;
}

/** One line for screen readers and for places without the visual panel. */
export function resultText(result: TrayResult): string {
  const total = `${equation(result)}${result.unit ? ` ${result.unit}` : ""}`;
  return [result.verdict, total, result.against && `${result.against.label} ${result.against.value}`, result.note].filter(Boolean).join(" · ");
}

export type SotdlResultInput = {
  d20: number; modifier: number; boonValue: number; netBoons: number; total: number; target: number;
  success: boolean; critical: boolean; verdict?: string;
};

/** d20 + (attribute - 10) + the highest boon d6, or minus the highest bane d6. */
export function sotdlResult(input: SotdlResultInput): TrayResult {
  const parts: TrayPart[] = [{ label: "d20", value: input.d20 }];
  if (input.modifier) parts.push({ label: "Atributo", value: input.modifier });
  if (input.netBoons) parts.push({ label: input.netBoons > 0 ? "Dádiva" : "Perdição", value: input.boonValue });
  return build(parts, input.total, {
    against: { label: "Alvo", value: input.target },
    verdict: input.verdict ?? (input.critical ? "Crítico" : input.success ? "Sucesso" : "Falha"),
    tone: input.critical ? "critical" : input.success ? "success" : "failure",
  });
}

export function sotdlFateResult(die: number, outcome: "dying" | "stable" | "recovers", verdict: string): TrayResult {
  return build([{ label: "d6", value: die }], die, { verdict, tone: outcome === "recovers" ? "success" : outcome === "dying" ? "failure" : "warning" });
}

export type PoolResultInput = {
  /** Every d10 of the pool, shown in the tray or not. */
  dice: readonly number[]; criticalPairs: number; successes: number;
  difficulty?: number; verdict?: string; tone?: TrayTone; note?: string;
};

/** d10 pools (V5, Hunter): one success per die at 6 or more, plus two per pair of tens. */
export function poolResult(input: PoolResultInput): TrayResult {
  const parts: TrayPart[] = [{ label: "Dados com 6+", value: input.dice.filter((value) => value >= 6).length }];
  if (input.criticalPairs) parts.push({ label: input.criticalPairs === 1 ? "Par de 10" : "Pares de 10", value: input.criticalPairs * 2 });
  return build(parts, input.successes, {
    unit: input.successes === 1 ? "sucesso" : "sucessos",
    against: input.difficulty === undefined ? undefined : { label: "Dificuldade", value: input.difficulty },
    verdict: input.verdict, tone: input.tone, note: input.note,
  });
}

/** NdM terms and flat modifiers of a free expression, each already signed. */
export function expressionResult(terms: readonly { label: string; subtotal: number }[], total: number): TrayResult {
  const name = (label: string) => {
    if (/d\d+$/.test(label)) return label.replace(/^-/, "");
    const text = label.replace(/\s*[+-]\d+$/, "");
    return text ? text[0].toUpperCase() + text.slice(1) : "Fixo";
  };
  return build(terms.map((term) => ({ label: name(term.label), value: term.subtotal })), total);
}
