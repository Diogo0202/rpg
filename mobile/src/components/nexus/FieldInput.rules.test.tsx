import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldInput } from "./FieldInput";
import { SYSTEM_STARTERS } from "@/lib/system-starters.ts";
import type { FieldValue } from "@/lib/sheet-template.ts";

const v3 = SYSTEM_STARTERS.find((item) => item.id === "vampire-v3")!;
const v5 = SYSTEM_STARTERS.find((item) => item.id === "vampire-v5")!;

function One({ id, starter = v3, initial = {} }: { id: string; starter?: typeof v3; initial?: Record<string, FieldValue> }) {
  const [values, setValues] = useState<Record<string, FieldValue>>({ ...starter.values, ...initial });
  const field = starter.template.fields.find((item) => item.id === id)!;
  return <FieldInput template={starter.template} field={field} values={values} idPrefix="r"
    onChange={(key, value) => setValues((current) => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; })} />;
}

describe("FieldInput com regras de criação (V3, V5)", () => {
  it("Qualidades V3 oferecem o catálogo com pontos e contam os pontos escolhidos", () => {
    render(<One id="meritos" />);
    const catalog = screen.getByLabelText("Catálogo de Qualidades") as HTMLSelectElement;
    const option = [...catalog.options].find((item) => item.value.includes("•"))!;
    fireEvent.change(catalog, { target: { value: option.value } });
    expect(screen.getByText(option.value)).toBeInTheDocument();
    const dots = [...option.value].filter((char) => char === "•").length;
    expect(screen.getByText(new RegExp(`^${dots} de \\d+ pontos`))).toBeInTheDocument();
  });

  it("Especializações V3 explicam o formato e a contagem", () => {
    render(<One id="especialidades" />);
    expect(screen.getByText(/especializações gratuitas/)).toBeInTheDocument();
  });

  it("Fraqueza acompanha o clã escolhido", () => {
    const clan = v3.template.fields.find((item) => item.id === "cla")!.options[0]!;
    render(<One id="fraqueza" initial={{ cla: clan }} />);
    const select = screen.getByLabelText(/Fraqueza do clã/) as HTMLSelectElement;
    expect(select.options.length).toBe(2);
  });

  it("Segredos aparecem como privados e o XP do Mestre fica somente leitura", () => {
    render(<One id="segredos" starter={v5} />);
    expect(screen.getByText(/privado: só você e o Mestre/)).toBeInTheDocument();
    const field = v5.template.fields.find((item) => item.id === "experiencia")!;
    render(<FieldInput template={v5.template} field={field} values={{}} onChange={() => {}} fixed={0} fixedNote="Concedido pelo Mestre durante a crônica" />);
    expect(screen.getByText("Concedido pelo Mestre durante a crônica")).toBeInTheDocument();
  });
});
