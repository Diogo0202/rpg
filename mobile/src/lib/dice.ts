/**
 * Local dice roller. Resolves NdM terms and integer modifiers with
 * crypto.getRandomValues (rejection sampling). No eval/Function.
 */
export const DICE_LIMITS = {
  maxDice: 100,
  maxFaces: 1000,
  maxTerms: 10,
  maxModifier: 1000,
} as const;

export type DiceDiceTerm = { sign: 1 | -1; count: number; faces: number };
export type DiceConstantTerm = { sign: 1 | -1; constant: number };
export type DiceTerm = DiceDiceTerm | DiceConstantTerm;
export type DiceRoll = {
  id: string;
  expression: string;
  terms: { label: string; rolls: number[]; subtotal: number }[];
  total: number;
  createdAt: number;
  label?: string;
  pool?: { successes: number; tens: number; hungerDice: number[] };
  sotdl?: { target: number; success: boolean; critical: boolean };
};

export function parseDice(input: string): DiceTerm[] {
  if (typeof input !== "string") throw new Error("Informe uma expressão como 2d6+3.");
  const expr = input.replace(/\s+/g, "").toLowerCase();
  if (!expr || expr.length > 60) throw new Error("Informe uma expressão como 2d6+3.");
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(expr))
    throw new Error("Use apenas termos NdM e números, unidos por + ou -.");
  const parts = expr.match(/[+-]?(\d*d\d+|\d+)/g) ?? [];
  if (parts.length > DICE_LIMITS.maxTerms)
    throw new Error(`No máximo ${DICE_LIMITS.maxTerms} termos.`);
  let totalDice = 0;
  return parts.map((part) => {
    const sign: 1 | -1 = part.startsWith("-") ? -1 : 1;
    const body = part.replace(/^[+-]/, "");
    if (body.includes("d")) {
      const [countRaw, facesRaw] = body.split("d");
      const count = countRaw ? Number(countRaw) : 1;
      const faces = Number(facesRaw);
      if (!Number.isSafeInteger(count) || count < 1) throw new Error("Role ao menos 1 dado.");
      if (!Number.isSafeInteger(faces) || faces < 2 || faces > DICE_LIMITS.maxFaces)
        throw new Error(`Dados devem ter entre 2 e ${DICE_LIMITS.maxFaces} faces.`);
      totalDice += count;
      if (totalDice > DICE_LIMITS.maxDice)
        throw new Error(`No máximo ${DICE_LIMITS.maxDice} dados por rolagem.`);
      return { sign, count, faces };
    }
    const constant = Number(body);
    if (!Number.isSafeInteger(constant) || constant > DICE_LIMITS.maxModifier)
      throw new Error(`Modificador máximo: ${DICE_LIMITS.maxModifier}.`);
    return { sign, constant };
  });
}

export function randomInt(
  faces: number,
  source: (arr: Uint32Array) => unknown = (a) => crypto.getRandomValues(a),
): number {
  if (!Number.isInteger(faces) || faces < 2 || faces > DICE_LIMITS.maxFaces)
    throw new Error("Número de faces inválido.");
  const limit = Math.floor(0x100000000 / faces) * faces;
  const buf = new Uint32Array(1);
  // A broken or hostile injected random source must not hang the UI forever.
  for (let attempt = 0; attempt < 128; attempt++) {
    source(buf);
    const v = buf[0];
    if (v !== undefined && v < limit) return (v % faces) + 1;
  }
  throw new Error("Não foi possível obter um número aleatório válido.");
}

export function rollExpression(input: string, modifier = 0, label?: string): DiceRoll {
  if (!Number.isSafeInteger(modifier) || Math.abs(modifier) > DICE_LIMITS.maxModifier)
    throw new Error("Modificador inválido.");
  const terms = parseDice(input);
  const out: DiceRoll["terms"] = [];
  let total = 0;
  for (const term of terms) {
    if ("constant" in term) {
      out.push({
        label: `${term.sign < 0 ? "-" : "+"}${term.constant}`,
        rolls: [],
        subtotal: term.sign * term.constant,
      });
      total += term.sign * term.constant;
    } else {
      const rolls = Array.from({ length: term.count }, () => randomInt(term.faces));
      const subtotal = term.sign * rolls.reduce((a, b) => a + b, 0);
      out.push({
        label: `${term.sign < 0 ? "-" : ""}${term.count}d${term.faces}`,
        rolls,
        subtotal,
      });
      total += subtotal;
    }
  }
  if (modifier) {
    out.push({
      label: `modificador ${modifier > 0 ? "+" : ""}${modifier}`,
      rolls: [],
      subtotal: modifier,
    });
    total += modifier;
  }
  return {
    id: crypto.randomUUID(),
    expression: input.trim(),
    terms: out,
    total,
    createdAt: Date.now(),
    ...(label ? { label } : {}),
  };
}

/**
 * Shadow of the Demon Lord: d20 + (attribute - 10) against `target`. Boons and banes cancel
 * one for one; the rest roll d6 and only the highest counts. Mirrors backend roll_sotdl.
 */
export function rollSotdl(attribute: number, boons = 0, banes = 0, target = 10, label?: string): DiceRoll {
  if (!Number.isInteger(attribute) || attribute < 1 || attribute > 20) throw new Error("O atributo deve ficar entre 1 e 20.");
  if ([boons, banes].some((count) => !Number.isInteger(count) || count < 0 || count > 10)) throw new Error("Dádivas e perdições vão de 0 a 10.");
  if (!Number.isInteger(target) || target < 1 || target > 40) throw new Error("O alvo deve ficar entre 1 e 40.");
  const modifier = attribute - 10;
  const net = boons - banes;
  const d20 = randomInt(20);
  const boonDice = Array.from({ length: Math.abs(net) }, () => randomInt(6));
  const boonValue = (boonDice.length ? Math.max(...boonDice) : 0) * (net >= 0 ? 1 : -1);
  const total = d20 + modifier + boonValue;
  const success = total >= target;
  const terms: DiceRoll["terms"] = [{ label: "1d20", rolls: [d20], subtotal: d20 }, { label: `atributo ${modifier >= 0 ? "+" : ""}${modifier}`, rolls: [], subtotal: modifier }];
  if (net) terms.push({ label: `${Math.abs(net)} ${net > 0 ? "dádiva(s)" : "perdição(ões)"}`, rolls: boonDice, subtotal: boonValue });
  return {
    id: crypto.randomUUID(),
    expression: `d20 contra ${target}`,
    terms,
    total,
    createdAt: Date.now(),
    sotdl: { target, success, critical: success && total >= 20 && total - target >= 5 },
    ...(label ? { label } : {}),
  };
}

/** Local d10 pool: counts faces >= 6 as successes and each pair of 10s as two extra. */
export function rollPool(size: number, hunger = 0, label?: string): DiceRoll {
  if (!Number.isInteger(size) || size < 1 || size > 30)
    throw new Error("A parada deve ter de 1 a 30 dados.");
  if (!Number.isInteger(hunger) || hunger < 0 || hunger > Math.min(size, 5))
    throw new Error("Dados de fome inválidos.");
  const h = hunger;
  const rolls = Array.from({ length: size }, () => randomInt(10));
  const base = rolls.filter((r) => r >= 6).length;
  const tens = rolls.filter((r) => r === 10).length;
  const successes = base + Math.floor(tens / 2) * 2;
  return {
    id: crypto.randomUUID(),
    expression: `parada ${size}d10${h ? `, ${h} de fome` : ""}`,
    terms: [{ label: `${size}d10`, rolls, subtotal: successes }],
    total: successes,
    createdAt: Date.now(),
    pool: { successes, tens, hungerDice: rolls.slice(0, h) },
    ...(label ? { label } : {}),
  };
}
