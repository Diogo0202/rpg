import { describe, expect, it } from "vitest";
import { evaluateFormula } from "./formula";

describe("evaluateFormula", () => {
  it("respects precedence, parentheses, and unary minus", () => {
    expect(evaluateFormula("-(strength + 2) * 3 / 2", { strength: 4 })).toEqual({
      ok: true,
      value: -9,
    });
    expect(evaluateFormula("-2 ** 2", {})).toEqual({ ok: true, value: -4 });
    expect(evaluateFormula("2 ** -2", {})).toEqual({ ok: true, value: 0.25 });
    expect(evaluateFormula("2 ** 3 ** 2", {})).toEqual({ ok: true, value: 512 });
    expect(evaluateFormula("-5 // 2", {})).toEqual({ ok: true, value: -3 });
    expect(evaluateFormula("-5 % 2", {})).toEqual({ ok: true, value: 1 });
  });

  it("rejects absent values and unknown fields", () => {
    expect(
      evaluateFormula("strength + dexterity", { strength: 2, dexterity: undefined }),
    ).toMatchObject({ ok: false });
    expect(evaluateFormula("missing + 1", {})).toMatchObject({ ok: false });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite field value %s",
    (value) => {
      expect(evaluateFormula("strength", { strength: value })).toMatchObject({ ok: false });
    },
  );

  it("rejects division by zero, malformed input, and non-string expressions", () => {
    expect(evaluateFormula("4 / (2 - 2)", {})).toMatchObject({
      ok: false,
      error: "Divisão por zero.",
    });
    expect(evaluateFormula("1 + window.alert(1)", {})).toMatchObject({ ok: false });
    expect(evaluateFormula(42 as unknown as string, {})).toMatchObject({ ok: false });
  });

  it("enforces numeric result and exponent limits", () => {
    expect(evaluateFormula("value * 2", { value: Number.MAX_VALUE })).toMatchObject({
      ok: false,
      error: "Resultado numérico fora do limite permitido.",
    });
    expect(evaluateFormula("value * 100", { value: 1_000_000_000_000 })).toMatchObject({
      ok: false,
      error: "Resultado numérico fora do limite permitido.",
    });
    expect(evaluateFormula("2 ** 13", {})).toMatchObject({
      ok: false,
      error: "Expoente acima do limite de 12.",
    });
    expect(evaluateFormula("(-2) ** 0.5", {})).toMatchObject({ ok: false });
  });

  it("enforces parser depth and expression length limits", () => {
    expect(evaluateFormula("(".repeat(21) + "1" + ")".repeat(21), {})).toMatchObject({
      ok: false,
      error: "Expressão aninhada demais.",
    });
    expect(evaluateFormula("1+".repeat(60) + "1", {})).toMatchObject({
      ok: false,
      error: "Expressão longa demais.",
    });
  });

  it("does not read inherited object properties", () => {
    const values = Object.create({ strength: 5 }) as Record<string, number>;
    expect(evaluateFormula("strength", values)).toMatchObject({
      ok: false,
      error: "Campo desconhecido: strength",
    });
  });
});
