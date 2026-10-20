import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DicePanel } from "./DicePanel";

const prefs = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));

vi.mock("@/lib/nexus/prefs", () => ({ prefGet: prefs.get, prefSet: prefs.set }));

describe("DicePanel", () => {
  beforeEach(() => {
    prefs.get.mockReset().mockResolvedValue([]);
    prefs.set.mockReset().mockResolvedValue(undefined);
  });

  it("validates a dice expression and saves a successful local roll", async () => {
    render(<DicePanel />);
    await screen.findByText("Nenhuma rolagem neste aparelho.");

    fireEvent.change(screen.getByLabelText(/Expressão/), { target: { value: "2d6+" } });
    fireEvent.click(screen.getByRole("button", { name: "Rolar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use apenas termos NdM");
    expect(prefs.set).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Expressão/), { target: { value: "2d6" } });
    fireEvent.change(screen.getByLabelText(/Rótulo opcional/), { target: { value: "Ataque" } });
    fireEvent.click(screen.getByRole("button", { name: "Rolar" }));

    await waitFor(() => expect(prefs.set).toHaveBeenCalledWith("dice-roll-history-v1", expect.arrayContaining([
      expect.objectContaining({ label: "Ataque", expression: "2d6", terms: expect.any(Array), total: expect.any(Number) }),
    ])));
    expect(await screen.findByText(/Ataque/)).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Rolagem local registrada");
  });

  it("keeps V5 pools labeled local and rejects a hunger count above the pool", async () => {
    render(<DicePanel />);
    await screen.findByText("Nenhuma rolagem neste aparelho.");
    fireEvent.click(screen.getByRole("tab", { name: "Parada V5 local" }));
    fireEvent.change(screen.getByLabelText("Dados na parada"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Dados de fome"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Rolar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Dados de fome não podem exceder a parada");
    expect(prefs.set).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Dados de fome"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Rolar" }));
    await waitFor(() => expect(prefs.set).toHaveBeenCalled());
    const saved = prefs.set.mock.calls.at(-1)?.[1] as { label?: string; pool?: { successes: number } }[];
    expect(saved[0]).toMatchObject({ label: "V5 local", pool: { successes: expect.any(Number) } });
    expect(document.querySelector("ol")?.textContent).toContain("sucessos");
  });
});
