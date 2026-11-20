export type RollProbabilities = {
  success: number;
  messy_critical: number;
  bestial_failure: number;
};

export type V5ProbabilityComparison = {
  without_reroll: RollProbabilities;
  with_reroll: RollProbabilities;
  reroll_limit: number;
};

type OrdinaryState = { successes: number; tens: number; probability: number };
type HungerState = { successes: number; tens: number; ones: number; probability: number };

function add(map: Map<string, number>, key: string, probability: number) {
  map.set(key, (map.get(key) ?? 0) + probability);
}

function ordinaryDistribution(count: number): OrdinaryState[] {
  let states = new Map<string, number>([["0,0", 1]]);
  for (let die = 0; die < count; die++) {
    const next = new Map<string, number>();
    for (const [key, probability] of states) {
      const [successes, tens] = key.split(",").map(Number);
      add(next, key, probability * 0.5);
      add(next, `${successes + 1},${tens}`, probability * 0.4);
      add(next, `${successes},${tens + 1}`, probability * 0.1);
    }
    states = next;
  }
  return Array.from(states, ([key, probability]) => {
    const [successes, tens] = key.split(",").map(Number);
    return { successes, tens, probability };
  });
}

function hungerDistribution(count: number): HungerState[] {
  let states = new Map<string, number>([["0,0,0", 1]]);
  for (let die = 0; die < count; die++) {
    const next = new Map<string, number>();
    for (const [key, probability] of states) {
      const [successes, tens, ones] = key.split(",").map(Number);
      add(next, key, probability * 0.4);
      add(next, `${successes + 1},${tens},${ones}`, probability * 0.4);
      add(next, `${successes},${tens + 1},${ones}`, probability * 0.1);
      add(next, `${successes},${tens},${ones + 1}`, probability * 0.1);
    }
    states = next;
  }
  return Array.from(states, ([key, probability]) => {
    const [successes, tens, ones] = key.split(",").map(Number);
    return { successes, tens, ones, probability };
  });
}

function countEvents(ordinary: OrdinaryState, hunger: HungerState, difficulty: number) {
  const tens = ordinary.tens + hunger.tens;
  const successes = ordinary.successes + hunger.successes + tens + 2 * Math.floor(tens / 2);
  const success = successes >= difficulty;
  return {
    success: Number(success),
    messy_critical: Number(success && tens >= 2 && hunger.tens > 0),
    bestial_failure: Number(!success && hunger.ones > 0),
  };
}

function accumulate(target: RollProbabilities, events: RollProbabilities, probability: number) {
  target.success += events.success * probability;
  target.messy_critical += events.messy_critical * probability;
  target.bestial_failure += events.bestial_failure * probability;
}

/** Same event model and reroll policy as backend/app/domain/v5_probability.py. */
export function estimateV5Probabilities(
  pool: number,
  hunger: number,
  difficulty: number,
  willpowerDice = 3,
): V5ProbabilityComparison {
  if (
    ![pool, hunger, difficulty, willpowerDice].every(Number.isInteger) ||
    pool < 0 ||
    pool > 30 ||
    hunger < 0 ||
    hunger > Math.min(pool, 5) ||
    difficulty < 1 ||
    difficulty > 100 ||
    willpowerDice < 0 ||
    willpowerDice > 3
  ) {
    throw new Error("Parada, Fome, dificuldade ou Vontade fora dos limites V5.");
  }

  const ordinaryCount = pool - hunger;
  const ordinary = ordinaryDistribution(ordinaryCount);
  const hungerStates = hungerDistribution(hunger);
  const rerollDistributions = Array.from({ length: willpowerDice + 1 }, (_, count) =>
    ordinaryDistribution(count),
  );
  const withoutReroll = { success: 0, messy_critical: 0, bestial_failure: 0 };
  const withReroll = { success: 0, messy_critical: 0, bestial_failure: 0 };
  const scale = 10 ** willpowerDice;
  const choices = new Map<string, { success: number; messy: number }>();

  // Integer numerators keep ties exact when comparing different reroll sizes.
  const entries = rerollDistributions.map((states, count) => states.map((state) => ({
    ...state, ways: Math.round(state.probability * 10 ** count),
  })));

  function bestChoice(failures: number, singles: number, tens: number, hungry: HungerState) {
    const key = `${failures},${singles},${tens},${hungry.successes},${hungry.tens}`;
    const cached = choices.get(key);
    if (cached) return cached;
    let best = { success: -1, messy: scale + 1, total: willpowerDice + 1 };
    for (let total = 0; total <= willpowerDice; total++) {
      for (let a = 0; a <= Math.min(failures, total); a++) {
        for (let b = 0; b <= Math.min(singles, total - a); b++) {
          const c = total - a - b;
          if (c > tens) continue;
          let success = 0;
          let messy = 0;
          for (const extra of entries[total]) {
            const allTens = tens - c + hungry.tens + extra.tens;
            const successes = singles - b + hungry.successes + extra.successes + allTens + 2 * Math.floor(allTens / 2);
            if (successes < difficulty) continue;
            success += extra.ways;
            if (allTens >= 2 && hungry.tens > 0) messy += extra.ways;
          }
          const factor = 10 ** (willpowerDice - total);
          success *= factor;
          messy *= factor;
          if (success > best.success || (success === best.success && (messy < best.messy || (messy === best.messy && total < best.total))))
            best = { success, messy, total };
        }
      }
    }
    choices.set(key, best);
    return best;
  }

  for (const normal of ordinary) {
    const failedNormal = ordinaryCount - normal.successes - normal.tens;
    for (const hungry of hungerStates) {
      const weight = normal.probability * hungry.probability;
      accumulate(withoutReroll, countEvents(normal, hungry, difficulty), weight);
      const best = bestChoice(failedNormal, normal.successes, normal.tens, hungry);
      accumulate(withReroll, {
        success: best.success / scale,
        messy_critical: best.messy / scale,
        bestial_failure: hungry.ones > 0 ? (scale - best.success) / scale : 0,
      }, weight);
    }
  }

  return { without_reroll: withoutReroll, with_reroll: withReroll, reroll_limit: willpowerDice };
}
