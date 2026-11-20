import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiceRoll } from "@/lib/dice";
import { ROLL_ANIMATION_MS } from "@/lib/dice-roller";
import { DiceRollStage } from "./DiceRollStage";

const v5Roll: DiceRoll = {
  id: "v5-1",
  expression: "parada 4d10, 1 de fome",
  terms: [{ label: "4d10", rolls: [10, 10, 3, 2], subtotal: 6 }],
  total: 6,
  createdAt: 0,
  label: "Morder",
  pool: { successes: 6, tens: 2, hungerDice: [10] },
};

function mockReducedMotion(matches: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: matches && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe("DiceRollStage", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
    vi.useRealTimers();
  });

  it("anuncia o resultado em aria-live logo na rolagem", () => {
    render(<DiceRollStage roll={v5Roll} context={{ mode: "v5", hunger: 1, difficulty: 3 }} />);
    expect(screen.getByTestId("dice-stage-live")).toHaveTextContent("Morder: Crítico sujo. 4 sucessos contra dificuldade 3.");
    expect(screen.getByTestId("dice-stage-live")).toHaveAttribute("aria-live", "polite");
    // Destaques presentes já durante a animação.
    expect(screen.getByLabelText(/Dado de fome d10: 10, dez de fome/)).toHaveAttribute("data-tone", "messy");
  });

  it("mostra o resultado ao fim da animação e permite pular com um toque", () => {
    vi.useFakeTimers();
    restore = mockReducedMotion(false);
    const { rerender } = render(<DiceRollStage roll={v5Roll} context={{ mode: "v5", hunger: 1, difficulty: 3 }} />);
    const skip = screen.getByRole("button", { name: /Pular animação/ });
    expect(screen.queryByTestId("dice-stage-result")).not.toBeInTheDocument();
    fireEvent.click(skip);
    expect(screen.getByTestId("dice-stage-result")).toHaveTextContent("Crítico sujo");
    expect(screen.queryByRole("button", { name: /Pular animação/ })).not.toBeInTheDocument();

    rerender(<DiceRollStage roll={{ ...v5Roll, id: "v5-2" }} context={{ mode: "v5", hunger: 1, difficulty: 3 }} />);
    expect(screen.queryByTestId("dice-stage-result")).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(ROLL_ANIMATION_MS + 200);
    });
    expect(screen.getByTestId("dice-stage-result")).toHaveAttribute("data-tone", "messy");
    expect(document.querySelector("[style*='will-change']")).toBeNull();
  });

  it("com prefers-reduced-motion mostra o resultado imediatamente, sem animação", () => {
    restore = mockReducedMotion(true);
    render(<DiceRollStage roll={v5Roll} context={{ mode: "v5", hunger: 1, difficulty: 3 }} />);
    expect(screen.getByTestId("dice-stage-result")).toHaveTextContent("Crítico sujo");
    expect(screen.queryByRole("button", { name: /Pular animação/ })).not.toBeInTheDocument();
    expect(document.querySelector("[style*='will-change']")).toBeNull();
  });

  it("agrupa paradas grandes", () => {
    const rolls = Array.from({ length: 25 }, (_, i) => (i % 10) + 1);
    render(
      <DiceRollStage
        reducedMotion
        roll={{ ...v5Roll, id: "big", terms: [{ label: "25d10", rolls, subtotal: 0 }], pool: { successes: 0, tens: 0, hungerDice: rolls.slice(0, 2) } }}
        context={{ mode: "v5", hunger: 2 }}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/25 dados agrupados/)).toBeInTheDocument();
  });
});
