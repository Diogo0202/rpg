import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DicePanel } from "./DicePanel";
import { NexusContext, type NexusContextValue } from "@/lib/nexus/context";

const prefs = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
const api = vi.hoisted(() => ({ fetch: vi.fn(), auth: vi.fn(), token: vi.fn() }));

vi.mock("@/lib/nexus/prefs", () => ({ prefGet: prefs.get, prefSet: prefs.set }));
vi.mock("@/lib/nexus/auth", () => ({ getSupabaseAuth: api.auth, accessTokenProvider: api.token }));
vi.mock("@/lib/nexus/v5-sheet-probability", () => ({ fetchSheetProbabilities: api.fetch }));

describe("DicePanel", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    prefs.get.mockReset().mockResolvedValue([]);
    prefs.set.mockReset().mockResolvedValue(undefined);
    api.fetch.mockReset();
    api.auth.mockReset().mockReturnValue({});
    api.token.mockReset().mockReturnValue(vi.fn().mockResolvedValue("jwt"));
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

    await waitFor(() =>
      expect(prefs.set).toHaveBeenCalledWith(
        "dice-roll-history-v1",
        expect.arrayContaining([
          expect.objectContaining({
            label: "Ataque",
            expression: "2d6",
            terms: expect.any(Array),
            total: expect.any(Number),
          }),
        ]),
      ),
    );
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
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Dados de fome não podem exceder a parada",
    );
    expect(prefs.set).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Dados de fome"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Rolar" }));
    await waitFor(() => expect(prefs.set).toHaveBeenCalled());
    const saved = prefs.set.mock.calls.at(-1)?.[1] as {
      label?: string;
      pool?: { successes: number };
    }[];
    expect(saved[0]).toMatchObject({ label: "V5 local", pool: { successes: expect.any(Number) } });
    expect(document.querySelector("ol")?.textContent).toContain("sucessos");
  });

  it("shows V5 chances before rolling and updates them with the pool", async () => {
    render(<DicePanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Parada V5 local" }));
    const probability = screen.getByLabelText("Probabilidades V5 locais");
    expect(probability).toHaveTextContent("Risco antes da rolagem");
    expect(probability).toHaveTextContent("Sem Vontade");
    expect(probability).toHaveTextContent("Com Vontade, até 3 dados");

    fireEvent.change(screen.getByLabelText("Dados na parada"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Dados de fome"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Dificuldade da ação"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Dados comuns para Vontade"), {
      target: { value: "1" },
    });
    expect(probability).toHaveTextContent("75.0%");
    expect(probability).toHaveTextContent("87.5%");
    expect(prefs.set).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Dados de fome"), { target: { value: "3" } });
    expect(probability).toHaveTextContent("Informe parada de 0 a 30");
    expect(probability).not.toHaveTextContent("75.0%");
  });

  it("shows server conditions for a selected connected sheet", async () => {
    vi.stubEnv("VITE_NEXUS_API_URL", "http://localhost:8000");
    api.fetch.mockResolvedValue({
      without_reroll: { success: 0.4, messy_critical: 0.05, bestial_failure: 0.2 },
      with_reroll: { success: 0.6, messy_critical: 0.08, bestial_failure: 0.1 },
      reroll_limit: 3,
      hunger_dice: 2,
      modifier_preview: {
        base_pool: 5,
        adjusted_pool: 3,
        total_delta: -2,
        applied: [{ id: "condition", label: "Paranoia", delta: -2 }],
      },
    });
    const sheet = {
      type: "character_sheets",
      id: "10000000-0000-4000-8000-000000000001",
      version: 1,
      data: {
        name: "Mara",
        system_key: "vampire-v5",
        template_name: "V5",
        template_version: 1,
        values: { fome: 2 },
        effects: [],
      },
      pending: true,
      conflict: false,
    };
    const context = {
      mode: "connected",
      user: { id: "user-1", email: null },
      list: () => [sheet],
    } as unknown as NexusContextValue;
    const view = render(
      <NexusContext.Provider value={context}>
        <DicePanel />
      </NexusContext.Provider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Parada V5 local" }));
    fireEvent.change(screen.getByLabelText("Ficha V5 conectada"), { target: { value: sheet.id } });
    expect(screen.getByLabelText("Dados de fome")).toHaveValue(2);
    expect(screen.getByText(/última versão confirmada/)).toBeInTheDocument();
    await waitFor(() =>
      expect(api.fetch).toHaveBeenCalledWith(
        expect.objectContaining({
          sheetId: sheet.id,
          pool: 5,
          difficulty: 3,
          willpowerDice: 3,
          contextTags: [],
        }),
      ),
    );
    expect(await screen.findByText("Paranoia: -2 dado(s)")).toBeInTheDocument();
    expect(screen.getByLabelText("Probabilidades da ficha no servidor")).toHaveTextContent("40.0%");
    expect(screen.getByRole("button", { name: "Rolar sem condições (local)" })).toBeInTheDocument();
    expect(
      screen.getByText(/não aplica as condições calculadas pelo servidor/),
    ).toBeInTheDocument();

    view.rerender(
      <NexusContext.Provider
        value={
          {
            ...context,
            list: () => [{ ...sheet, version: 2, pending: false }],
          } as NexusContextValue
        }
      >
        <DicePanel />
      </NexusContext.Provider>,
    );
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/última versão confirmada/)).not.toBeInTheDocument();
  });
});
