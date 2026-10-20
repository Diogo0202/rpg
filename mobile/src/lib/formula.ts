/**
 * Bounded arithmetic parser for read-only sheet formulas. Syntax and numeric
 * limits match backend/app/services/sheet_calculations.py; no eval/Function.
 */
export type FormulaResult = { ok: true; value: number } | { ok: false; error: string };

type Token =
  { type: "num"; value: number } | { type: "id"; value: string } | { type: "op"; value: string };

const MAX_LENGTH = 120;
const MAX_DEPTH = 20;
const MAX_TOKENS = 80;
const MAX_ABS_RESULT = 1_000_000_000_000;
const MAX_POWER = 12;

function tokenize(expr: string): Token[] {
  if (expr.length > MAX_LENGTH) throw new Error("Expressão longa demais.");
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j]!)) j++;
      const raw = expr.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error(`Número inválido: ${raw}`);
      const value = Number(raw);
      if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_RESULT)
        throw new Error("Valor numérico fora do limite permitido.");
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    if (/[a-z_]/i.test(ch)) {
      let j = i;
      while (j < expr.length && /[a-z0-9_]/i.test(expr[j]!)) j++;
      tokens.push({ type: "id", value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/()%".includes(ch)) {
      const pair = expr.slice(i, i + 2);
      const value = pair === "**" || pair === "//" ? pair : ch;
      tokens.push({ type: "op", value });
      i += value.length;
      continue;
    }
    throw new Error(`Caractere não permitido: ${ch}`);
  }
  if (tokens.length > MAX_TOKENS) throw new Error("Expressão complexa demais.");
  return tokens;
}

function bounded(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_ABS_RESULT)
    throw new Error("Resultado numérico fora do limite permitido.");
  return value;
}

const PRECEDENCE: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "//": 2,
  "%": 2,
  "**": 4,
};

export function evaluateFormula(
  expr: string,
  vars: Record<string, number | undefined>,
): FormulaResult {
  try {
    if (typeof expr !== "string") throw new Error("Expressão inválida.");
    if (vars === null || typeof vars !== "object") throw new Error("Campos inválidos.");
    const tokens = tokenize(expr.trim());
    if (!tokens.length) return { ok: false, error: "Expressão vazia." };
    let pos = 0;
    const peek = () => tokens[pos];

    const parseExpression = (minPrecedence: number, depth: number): number => {
      if (depth > MAX_DEPTH) throw new Error("Expressão aninhada demais.");
      let left = parsePrefix(depth);
      while (peek()?.type === "op") {
        const op = peek()!.value;
        const precedence = PRECEDENCE[op];
        if (precedence === undefined || precedence < minPrecedence) break;
        pos++;
        // Exponentiation is right-associative, as in Python.
        const right = parseExpression(op === "**" ? precedence : precedence + 1, depth);
        if ((op === "/" || op === "//" || op === "%") && right === 0)
          throw new Error("Divisão por zero.");
        if (op === "**" && Math.abs(right) > MAX_POWER)
          throw new Error(`Expoente acima do limite de ${MAX_POWER}.`);
        if (op === "**" && left < 0 && !Number.isInteger(right))
          throw new Error("Expoente fracionário de base negativa não é permitido.");
        if (op === "+") left = bounded(left + right);
        else if (op === "-") left = bounded(left - right);
        else if (op === "*") left = bounded(left * right);
        else if (op === "/") left = bounded(left / right);
        else if (op === "//") left = bounded(Math.floor(left / right));
        else if (op === "%") left = bounded(left - Math.floor(left / right) * right);
        else left = bounded(left ** right);
      }
      return left;
    };

    const parsePrefix = (depth: number): number => {
      const token = tokens[pos++];
      if (!token) throw new Error("Expressão incompleta.");
      if (token.type === "num") return token.value;
      if (token.type === "id") {
        if (!Object.prototype.hasOwnProperty.call(vars, token.value))
          throw new Error(`Campo desconhecido: ${token.value}`);
        const value = vars[token.value];
        if (typeof value !== "number")
          throw new Error(`Campo ${token.value} precisa de um valor numérico.`);
        return bounded(value);
      }
      if (token.value === "+") return parseExpression(3, depth + 1);
      if (token.value === "-") return bounded(-parseExpression(3, depth + 1));
      if (token.value === "(") {
        const value = parseExpression(0, depth + 1);
        const close = tokens[pos++];
        if (!close || close.value !== ")") throw new Error("Parêntese não fechado.");
        return value;
      }
      throw new Error(`Símbolo inesperado: ${token.value}`);
    };

    const value = parseExpression(0, 0);
    if (pos !== tokens.length) throw new Error("Símbolos sobrando na expressão.");
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Expressão inválida." };
  }
}
