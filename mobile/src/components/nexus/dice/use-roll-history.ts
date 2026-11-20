import { useCallback, useEffect, useState } from "react";
import type { DiceRoll } from "@/lib/dice";
import { prefGet, prefSet } from "@/lib/nexus/prefs";
import { HISTORY_KEY, HISTORY_LIMIT, validHistory } from "./dice-model";

/** Histórico de rolagens deste aparelho, guardado nas preferências locais. */
export function useRollHistory() {
  const [history, setHistory] = useState<DiceRoll[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    void prefGet<unknown>(HISTORY_KEY)
      .then((saved) => { if (active) setHistory(validHistory(saved)); })
      .catch(() => { if (active) setError("Não foi possível abrir o histórico local."); })
      .finally(() => { if (active) setReady(true); });
    return () => {
      active = false;
    };
  }, []);

  const save = useCallback(async (roll: DiceRoll) => {
    const next = [roll, ...history].slice(0, HISTORY_LIMIT);
    try {
      await prefSet(HISTORY_KEY, next);
      setHistory(next);
      setError("");
      setStatus(`Rolagem local registrada. Resultado ${roll.total}.`);
    } catch {
      setError("A rolagem saiu, mas o histórico local não foi salvo.");
      setStatus(`Resultado local: ${roll.total}.`);
    }
  }, [history]);

  const clear = useCallback(async () => {
    try {
      await prefSet(HISTORY_KEY, []);
      setHistory([]);
      setError("");
      setStatus("Histórico local apagado.");
    } catch {
      setError("Não foi possível apagar o histórico local.");
    }
  }, []);

  return { history, ready, error, status, setError, setStatus, save, clear };
}
