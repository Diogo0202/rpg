import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryEditor } from "./InventoryEditor";

const fixture = vi.hoisted(() => ({
  update: vi.fn(),
  hasTemplate: true,
  custom: { peso: 2, material: "Ferro" },
}));

vi.mock("@/lib/nexus/store", () => ({
  useNexus: () => ({
    get: (type: string) => type === "character_sheets"
      ? { data: { template_id: "template" } }
      : fixture.hasTemplate ? { data: { schema: { inventory_schema: [
        { id: "peso", label: "Peso", kind: "number", min: 0, max: 10 },
        { id: "material", label: "Material", kind: "select", options: ["Ferro", "Madeira"] },
      ] } } } : undefined,
    list: () => [{ id: "item", data: {
      sheet_id: "sheet", name: "Corda", category: "equipment", quantity: 1,
      resource_cost: 0, damage_bonus: 0, protection: 0, notes: "", acquired: true,
      equipped: false, sort_order: 0, custom_values: fixture.custom,
    } }],
    update: fixture.update,
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));

describe("InventoryEditor custom fields", () => {
  beforeEach(() => {
    fixture.hasTemplate = true;
    fixture.update.mockReset().mockResolvedValue(undefined);
  });

  it("preserves declared item attributes when editing and queues their changed values", async () => {
    render(<InventoryEditor sheetId="sheet" />);
    fireEvent.click(screen.getByRole("button", { name: "Editar Corda" }));
    const weight = screen.getByLabelText("Peso");
    expect(weight).toHaveValue(2);
    expect(weight).toHaveAttribute("min", "0");
    expect(weight).toHaveAttribute("max", "10");
    fireEvent.change(weight, { target: { value: "3.5" } });
    fireEvent.change(screen.getByLabelText(/Material/), { target: { value: "Madeira" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar item" }));
    await waitFor(() => expect(fixture.update).toHaveBeenCalledWith(
      "character_inventory", "item", expect.arrayContaining([
        { path: ["custom_values"], value: { peso: 3.5, material: "Madeira" } },
      ]),
    ));
  });

  it("keeps imported item attributes visible and intact when its template is unavailable", async () => {
    fixture.hasTemplate = false;
    render(<InventoryEditor sheetId="sheet" />);
    expect(screen.getByText("peso: 2")).toBeInTheDocument();
    expect(screen.getByText("material: Ferro")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar Corda" }));
    fireEvent.change(screen.getByLabelText("Nome do item"), { target: { value: "Corda longa" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar item" }));
    await waitFor(() => expect(fixture.update).toHaveBeenCalledWith(
      "character_inventory", "item", expect.arrayContaining([
        { path: ["custom_values"], value: { peso: 2, material: "Ferro" } },
      ]),
    ));
  });
});
