import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GameRequest } from "@/lib/game/api";
import type { TableApi } from "./useTableApi";
import { V3TablePanel } from "./V3TablePanel";
import { HunterTablePanel } from "./HunterTablePanel";
import { V5RollPanel } from "./V5RollPanel";
import { V5BloodPanel } from "./V5BloodPanel";
import { ExperienceTablePanel } from "./ExperienceTablePanel";

const SHEET = "22222222-2222-4222-8222-222222222222";
const ROLL = "33333333-3333-4333-8333-333333333333";

function fakeApi(request: GameRequest | null, overrides: Partial<TableApi> = {}): TableApi {
  return {
    request, unavailable: "Conecte uma campanha.", online: true, queued: [],
    adjust: vi.fn(async () => ({ status: "queued" as const })), flush: vi.fn(async () => null), discard: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined), refreshSheet: vi.fn(), narrator: false, viewerId: "me", ...overrides,
  };
}

describe("V3 table panel", () => {
  const sheet = { id: SHEET, name: "Lucita", values: { sistema: "Vampiro V3", ant_geracao: 1, forca: 3, briga: 2, pontos_sangue: 5, forca_vontade: 4 } };

  it("rolls on the server with the health penalty and shows 2D dice", async () => {
    const request = vi.fn(async () => ({ dice: [7, 1, 9], difficulty: 6, successes: 1, botch: false, success: true, penalty: 0, rolled: 3, willpower_spent: false }));
    render(<V3TablePanel sheet={sheet} api={fakeApi(request as unknown as GameRequest)} />);
    fireEvent.click(screen.getByRole("button", { name: /^Rolar$/ }));
    await waitFor(() => expect(screen.getByLabelText("Dados da rolagem V3")).toBeInTheDocument());
    expect(request).toHaveBeenCalledWith("POST", "/api/v1/system-rolls/vampire-v3", expect.objectContaining({ pool: 3, difficulty: 6, damage_levels: 0 }));
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("queues blood spending offline and blocks server tests", async () => {
    const api = fakeApi(vi.fn() as unknown as GameRequest, { online: false });
    render(<V3TablePanel sheet={sheet} api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /Gastar sangue/ }));
    await waitFor(() => expect(screen.getByText(/na fila, será enviado ao reconectar/)).toBeInTheDocument());
    expect(api.adjust).toHaveBeenCalledWith(expect.objectContaining({ sheetId: SHEET, body: { action: "sangue", amount: 1 }, path: `/api/v1/system-rolls/vampire-v3/sheets/${SHEET}/actions` }));
    expect(screen.getByRole("button", { name: /Rötschreck/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /precisa de conexão/ })).toBeDisabled();
    expect(screen.getByText(/Sem conexão: ajustes ficam na fila/)).toBeInTheDocument();
  });
});

describe("Hunter table panel", () => {
  const roll = { roll_id: ROLL, normal_dice: [2, 3, 4, 5], desperation_dice: [1], desperation_ones: 1, successes: 0, difficulty: 2, success: false,
    critical_pairs: 0, critical: false, desperation_consequence: "despair", resolution: null, choices: ["despair"], can_reroll: true, verdict: "Falha" };

  it("rolls, limits the Willpower reroll to three dice and resolves Despair", async () => {
    const request = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return { cell: { id: SHEET, name: "Alfa", danger: 1, desperation: 2 }, in_despair: false, edges_blocked: false, pending_redemption: null };
      if (path.endsWith("/rolls")) return roll;
      if (path.endsWith("/reroll")) return { ...roll, normal_dice: [6, 7, 8, 5], can_reroll: false };
      return { ...roll, resolution: "despair", choices: [] };
    });
    render(<HunterTablePanel sheet={{ id: SHEET, name: "Ana", values: { forca: 3, destreza: 2, triunfos: ["Arsenal"] } }} api={fakeApi(request as unknown as GameRequest)} />);
    await screen.findByText(/Célula/, { selector: "p" });
    fireEvent.click(screen.getByLabelText(/Somar 2 dado/));
    fireEvent.click(screen.getByRole("button", { name: /^Rolar$/ }));
    await screen.findByRole("group", { name: "Escolha da mesa" });
    expect(request).toHaveBeenCalledWith("POST", `/api/v1/hunter/sheets/${SHEET}/rolls`, { base_pool: 3, difficulty: 3, use_desperation: true });
    const dice = screen.getAllByRole("button", { name: /^Dado comum/ });
    for (const die of dice) fireEvent.click(die);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Rerrolar 3 dado/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", `/api/v1/hunter/rolls/${ROLL}/reroll`, { indices: [0, 1, 2] }));
    fireEvent.click(await screen.findByRole("button", { name: /Despair: o teste falha/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", `/api/v1/hunter/rolls/${ROLL}/resolve`, { choice: "despair" }));
  });

  it("blocks Desperation dice and Edges in Despair and shows the narrator's cell controls", async () => {
    const request = vi.fn(async () => ({ cell: { id: SHEET, name: "Alfa", danger: 0, desperation: 3 }, in_despair: true, edges_blocked: true, pending_redemption: null }));
    const api = fakeApi(request as unknown as GameRequest, { narrator: true });
    render(<HunterTablePanel sheet={{ id: SHEET, name: "Ana", values: { forca: 3, triunfos: ["Arsenal"], em_desespero: true } }} api={api} />);
    await screen.findByText("Alfa");
    await waitFor(() => expect(screen.getByLabelText(/Somar 3 dado/)).toBeDisabled());
    expect(screen.getByLabelText(/Triunfo usado/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Perigo −1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Desesperação +1" }));
    await waitFor(() => expect(api.adjust).toHaveBeenCalledWith(expect.objectContaining({ path: `/api/v1/hunter/cells/${SHEET}/adjust`, body: { danger_delta: 0, desperation_delta: 1 } })));
    expect(screen.getByRole("button", { name: "Registrar Redenção" })).toBeInTheDocument();
  });
});

describe("V5 panels", () => {
  const stored = { id: ROLL, pool: 5, hunger: 1, difficulty: 3, normal_dice: [2, 9, 4, 6], hunger_dice: [10],
    outcome: { successes: 3, success: true, messy_critical: false, clean_critical: false, bestial_failure: false }, created_at: "2026-10-27T10:00:00Z", rerolled_at: null, recommended_reroll: [0, 2] };

  it("stores a roll, lists the remote history and rerolls with Willpower", async () => {
    const request = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return [stored];
      if (path.endsWith("/willpower-reroll")) return { roll: { ...stored, rerolled_at: "now" }, willpower_spent: true };
      return stored;
    });
    const api = fakeApi(request as unknown as GameRequest);
    render(<V5RollPanel sheetId={SHEET} api={api} />);
    await screen.findByText(/5 dados · Fome 1/);
    fireEvent.click(screen.getByRole("button", { name: /Rolar e guardar/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Sugestão: dados 1, 3/ }));
    fireEvent.click(screen.getByRole("button", { name: /Rerrolar 2 com Vontade/ }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", `/api/v1/v5/rolls/${ROLL}/willpower-reroll`, { normal_indices: [0, 2] }));
    expect(api.refreshSheet).toHaveBeenCalled();
  });

  it("rouses with a stable operation id after a lost reply and queues torpor", async () => {
    const state = { potency: { potency: 2, surge: 1, mend: 2, power_bonus: 1, rouse_reroll_level: 1, bane_severity: 2 }, hunger: 2, humanity: 7, stains: 0, remorse_pool: 0, remorse_success: null,
      willpower_current: 4, frenzy_pool: { fury: 6, hunger: 6, terror: 6 }, rouse_success: 0.75, in_torpor: false, torpor_duration: "um mês", compulsion: null, compulsion_detail: null, clan_compulsion: null };
    let attempts = 0;
    const bodies: unknown[] = [];
    const request = vi.fn(async (method: string, path: string, body?: unknown) => {
      if (method === "GET") return path.endsWith("/blood") ? state : [];
      bodies.push(body);
      attempts += 1;
      if (attempts === 1) throw new Error("Sem conexão com o servidor.");
      return { replayed: false, outcome: { success: true, hunger_before: 2, hunger_after: 2 }, dice: [8], event_id: 1, sheet: null, state };
    });
    const api = fakeApi(request as unknown as GameRequest);
    render(<V5BloodPanel sheet={{ id: SHEET, name: "Vlad", values: { fome: 2, potencia_sangue: 2 } }} api={api} />);
    await screen.findByText(/Surto/);
    fireEvent.click(screen.getByRole("button", { name: /Rouse Check/ }));
    await screen.findByText("Sem conexão com o servidor.");
    fireEvent.click(screen.getByRole("button", { name: /Rouse Check/ }));
    await screen.findByText(/Rouse: sem aumento/);
    const ids = bodies.map((body) => (body as { operation_id: string }).operation_id);
    expect(ids[0]).toBe(ids[1]);
    fireEvent.click(screen.getByRole("button", { name: "Entrar em Torpor" }));
    await waitFor(() => expect(api.adjust).toHaveBeenCalledWith(expect.objectContaining({ path: `/api/v1/v5/sheets/${SHEET}/torpor`, body: { in_torpor: true } })));
  });
});

describe("XP panel", () => {
  const template = { name: "V5", version: 1, system_key: "vampire-v5", fields: [
    { id: "experiencia", label: "Experiência", kind: "number" as const, required: false, options: [], expression: null },
    { id: "forca", label: "Força", kind: "number" as const, required: false, options: [], expression: null, max: 5 },
  ] };

  it("quotes on the server, buys with expected_version and lets the narrator refund", async () => {
    const request = vi.fn(async (method: string, path: string) => {
      if (method === "GET") return [{ id: ROLL, actor_id: "me", trait: "forca", item_name: null, item_value: null, from_level: 1, to_level: 2, cost: 10, status: "applied", xp_before: 30, xp_after: 20, reason: null, review_note: null, created_at: "2026-10-27T10:00:00Z" }];
      if (path.endsWith("/quote")) return { category: "attribute", label: "Atributo", from_level: 2, to_level: 3, cost: 15, xp_available: 20, sheet_version: 4, requires_approval: false };
      return { advance: { status: "applied", cost: 15, trait: "forca" }, sheet: {}, replayed: false };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = fakeApi(request as unknown as GameRequest, { narrator: true });
    render(<ExperienceTablePanel sheet={{ id: SHEET, name: "Vlad", version: 4, values: { experiencia: 20, forca: 2 }, template }} api={api} />);
    await screen.findByText("Força 1 → 2");
    fireEvent.click(screen.getByRole("button", { name: "Ver custo no servidor" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar compra" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", `/api/v1/sheets/${SHEET}/advances`, expect.objectContaining({ trait: "forca", target_level: 3, expected_version: 4, operation_id: expect.any(String) })));
    fireEvent.click(screen.getByRole("button", { name: "Estornar" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("POST", `/api/v1/advances/${ROLL}/refund`, { note: null }));
    expect(screen.getByRole("button", { name: /Conceder 1 XP/ })).toBeInTheDocument();
  });
});
