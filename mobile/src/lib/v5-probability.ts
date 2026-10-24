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

/** Same event model and reroll policy as backend/app/services/v5_probability.py. */
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

  for (const normal of ordinary) {
    const failedNormal = ordinaryCount - normal.successes - normal.tens;
    const rerolls = rerollDistributions[Math.min(willpowerDice, failedNormal)];
    for (const hungry of hungerStates) {
      const weight = normal.probability * hungry.probability;
      accumulate(withoutReroll, countEvents(normal, hungry, difficulty), weight);
      for (const extra of rerolls) {
        accumulate(
          withReroll,
          countEvents(
            {
              successes: normal.successes + extra.successes,
              tens: normal.tens + extra.tens,
              probability: 1,
            },
            hungry,
            difficulty,
          ),
          weight * extra.probability,
        );
      }
    }
  }

  return { without_reroll: withoutReroll, with_reroll: withReroll, reroll_limit: willpowerDice };
}
