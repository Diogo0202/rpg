import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionPanel } from "./ConnectionPanel";

const nexus = vi.hoisted(() => ({
  mode: "connected" as "local" | "connected",
  accountId: "account-1",
  campaignId: "campaign-1",
  campaignName: "Crônica",
  user: { id: "account-1", email: "player@example.test" },
  campaigns: [],
  connectionMessage: "",
  connectionConfigured: true,
  state: { outbox: [{}, {}] },
  engine: null,
  signIn: vi.fn(), signOut: vi.fn(), refreshCampaigns: vi.fn(), connectCampaign: vi.fn(), syncNow: vi.fn(), setLocalMode: vi.fn(),
}));

vi.mock("@/lib/nexus/store", () => ({ useNexus: () => nexus }));
vi.mock("@/lib/nexus/auth", () => ({ getSupabaseConfigProblem: () => null }));

describe("ConnectionPanel sign-out confirmation", () => {
  beforeEach(() => { nexus.signOut.mockReset().mockResolvedValue(undefined); });

  it("cancels without signing out and confirms once after focusable alert dialog", async () => {
    render(<ConnectionPanel />);
    const trigger = screen.getByRole("button", { name: "Sair" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("alertdialog", { name: "Sair e apagar os dados locais?" });
    expect(dialog).toHaveTextContent("todas as campanhas e operações pendentes");
    expect(dialog).toHaveTextContent("2 operação(ões) pendentes");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(nexus.signOut).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(nexus.signOut).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Sair e apagar cópias locais" }));
    await waitFor(() => expect(nexus.signOut).toHaveBeenCalledTimes(1));
  });
});
