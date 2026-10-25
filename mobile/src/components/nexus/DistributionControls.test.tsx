import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_STARTERS } from "@/lib/system-starters";
import { DistributionControls, distributionProblems } from "./DistributionControls";

const template = SYSTEM_STARTERS.find((starter) => starter.id === "hunter")!.template;
const rule = template.creation_rules!.find((item) => item.type === "group_distribution" && item.id === "habilidades")!;
const ids = rule.fields;

describe("Hunter skill distributions", () => {
  it("requires a mode, sends the choice and shows remaining slots", () => {
    const choose = vi.fn();
    const view = render(<DistributionControls template={template} values={{}} ids={ids} choices={{}} onChoose={choose} />);
    expect(distributionProblems(template, {}, ids, {})).toEqual(["Escolha um modo de Habilidades."]);
    fireEvent.click(screen.getByRole("radio", { name: /Especialista/ }));
    expect(choose).toHaveBeenCalledWith("habilidades", 0);
    view.rerender(<DistributionControls template={template} values={{}} ids={ids} choices={{ habilidades: 0 }} onChoose={choose} />);
    expect(screen.getByText("0/1 com 4 pontos (faltam 1)")).toBeInTheDocument();
    expect(screen.getByText("27/17 sem pontos (excesso)")).toBeInTheDocument();
  });

  it("rejects a complete alternative mode when the player selected specialist", () => {
    const balanced = Object.fromEntries(ids.map((id, index) => [id, [3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1][index] ?? 0]));
    expect(distributionProblems(template, balanced, ids, {})).toEqual([]);
    expect(distributionProblems(template, balanced, ids, { habilidades: 0 })).toEqual(["Habilidades: complete a distribuição Especialista."]);
    expect(distributionProblems(template, balanced, ids, { habilidades: 2 })).toEqual([]);
  });
});
