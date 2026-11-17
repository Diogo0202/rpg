import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MapInteractionsPanel } from "../../../../frontend/components/map-interactions-panel";
import { createEmptyDocument } from "../../../../frontend/lib/map-document";
import type { MapRpc } from "../../../../frontend/lib/map-interactions";

const object = { id: "clue", element_id: "letter", kind: "clue", label: "Carta", reach_cells: 1 };
const props = { mapId: "map-a", campaignId: "camp-a", viewerId: "player-a", canManage: false,
  document: createEmptyDocument("hunter"), sheets: [{ id: "ana", name: "Ana" }] };

describe("map interaction approvals", () => {
  it("requests examination without disclosing a clue or applying a game effect", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "get_map_objects" ? [object] : name === "list_map_actions" ? [] : { status: "pending" }, error: null }));
    render(<MapInteractionsPanel {...props} rpc={rpc as MapRpc} />);
    await screen.findByRole("option", { name: "Carta" });
    fireEvent.change(screen.getByLabelText("Objeto revelado"), { target: { value: "clue" } });
    fireEvent.click(screen.getByRole("button", { name: "Pedir exame" }));
    await screen.findByText("Pedido recebido. Aguarde a decisão do narrador.");
    expect(rpc).toHaveBeenCalledWith("request_map_action", expect.objectContaining({ p_map_id: "map-a", p_object_id: "clue", p_sheet_id: "ana", p_action: "examine", p_operation_id: expect.any(String) }));
    expect(rpc.mock.calls.some(([name]) => name === "decide_map_action")).toBe(false);
    expect(screen.queryByRole("button", { name: "Aprovar" })).toBeNull();
  });

  it("retries a lost acknowledgement with the same operation ID", async () => {
    const ids: string[] = [];
    const rpc: MapRpc = vi.fn(async (name, args) => {
      if (name === "get_map_objects") return { data: [object], error: null };
      if (name === "list_map_actions") return { data: [], error: null };
      ids.push(String(args.p_operation_id));
      return ids.length === 1 ? { data: null, error: { message: "Conexão interrompida" } } : { data: { status: "pending" }, error: null };
    });
    render(<MapInteractionsPanel {...props} rpc={rpc} />);
    await screen.findByRole("option", { name: "Carta" });
    fireEvent.change(screen.getByLabelText("Objeto revelado"), { target: { value: "clue" } });
    fireEvent.click(screen.getByRole("button", { name: "Pedir exame" }));
    await screen.findByText("Conexão interrompida");
    fireEvent.click(screen.getByRole("button", { name: "Pedir exame" }));
    await screen.findByText("Pedido recebido. Aguarde a decisão do narrador.");
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  });

  it("displays approved clue content and never exposes it for pending results", async () => {
    const rpc: MapRpc = vi.fn(async (name) => ({ data: name === "get_map_objects" ? [object] : [
      { id: "pending", object_id: "clue", sheet_id: "ana", action: "examine", status: "pending", result: { clue_text: "Segredo pendente" } },
      { id: "approved", object_id: "clue", sheet_id: "ana", action: "examine", status: "approved", result: { clue_text: "Encontre a chave" } },
    ], error: null }));
    render(<MapInteractionsPanel {...props} rpc={rpc} />);
    await screen.findByText("Encontre a chave");
    expect(screen.queryByText("Segredo pendente")).toBeNull();
  });

  it("clears prior campaign content when the next scope is denied", async () => {
    const rpc: MapRpc = vi.fn(async (name, args) => args.p_map_id === "map-a" ? { data: name === "get_map_objects" ? [object] : [], error: null } : { data: null, error: { message: "Sem acesso" } });
    const view = render(<MapInteractionsPanel {...props} rpc={rpc} />);
    await screen.findByRole("option", { name: "Carta" });
    view.rerender(<MapInteractionsPanel {...props} mapId="map-b" campaignId="camp-b" rpc={rpc} />);
    await screen.findByText("Sem acesso");
    await waitFor(() => expect(screen.queryByRole("option", { name: "Carta" })).toBeNull());
  });
});
