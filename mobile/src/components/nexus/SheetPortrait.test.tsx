import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePortrait } from "@/lib/nexus/portraits";
import { SheetPortrait } from "./SheetPortrait";

vi.mock("@/lib/nexus/portraits", () => ({ preparePortrait: vi.fn() }));

describe("SheetPortrait", () => {
  const portrait = "data:image/webp;base64,UklGRg==";

  beforeEach(() => {
    vi.mocked(preparePortrait).mockReset();
  });

  it("prepara o arquivo escolhido e apresenta a imagem salva", async () => {
    const file = new File(["jpeg"], "retrato.jpg", { type: "image/jpeg" });
    const changed = vi.fn();
    vi.mocked(preparePortrait).mockResolvedValue(portrait);
    const view = render(<SheetPortrait src={null} onChange={changed} />);
    fireEvent.change(screen.getByLabelText("Foto do personagem (opcional)"), { target: { files: [file] } });

    await waitFor(() => expect(changed).toHaveBeenCalledWith(portrait));
    expect(preparePortrait).toHaveBeenCalledWith(file);
    view.rerender(<SheetPortrait src={portrait} onChange={changed} />);
    expect(screen.getByRole("img", { name: "Retrato do personagem" })).toHaveAttribute("src", portrait);

    fireEvent.click(screen.getByRole("button", { name: "Remover retrato" }));
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith(null));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("exibe o erro e mantém o retrato atual quando a imagem é inválida", async () => {
    const file = new File(["inválido"], "retrato.png", { type: "image/png" });
    const changed = vi.fn();
    vi.mocked(preparePortrait).mockRejectedValue(new Error("Imagem inválida."));
    render(<SheetPortrait src={portrait} onChange={changed} />);
    fireEvent.change(screen.getByLabelText("Foto do personagem (opcional)"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Imagem inválida.");
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("img")).toHaveAttribute("src", portrait);
  });
});
