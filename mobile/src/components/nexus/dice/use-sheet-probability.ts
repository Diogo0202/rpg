import { useEffect, useState } from "react";
import { accessTokenProvider, getSupabaseAuth } from "@/lib/nexus/auth";
import { fetchSheetProbabilities, type SheetProbabilityResult } from "@/lib/nexus/v5-sheet-probability";
import { readIntegers } from "./dice-model";

/** Espera depois da última digitação antes de consultar a API. */
const DEBOUNCE_MS = 250;

type Request = {
  enabled: boolean;
  sheetId: string;
  sheetVersion: number | undefined;
  sheetPending: boolean | undefined;
  accountId: string | undefined;
  pool: string;
  difficulty: string;
  willpowerDice: string;
  contextTag: string;
};

/**
 * Chances da ficha V5 calculadas pelo servidor, com as condições da ficha.
 * Refaz a consulta quando a ficha muda de versão ou de estado pendente.
 */
export function useSheetProbability({ enabled, sheetId, sheetVersion, sheetPending, accountId, pool, difficulty, willpowerDice, contextTag }: Request) {
  const [result, setResult] = useState<SheetProbabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const apiBase = import.meta.env.VITE_NEXUS_API_URL?.trim();

  useEffect(() => {
    const controller = new AbortController();
    const stop = () => controller.abort();
    setResult(null);
    setError("");
    setLoading(false);
    if (!enabled || !sheetId || !accountId) return stop;
    const numbers = readIntegers([pool, difficulty, willpowerDice]);
    if (!numbers) return stop;
    if (!apiBase) {
      setError("Configure a URL da API para calcular as condições da ficha.");
      return stop;
    }
    const auth = getSupabaseAuth();
    if (!auth) {
      setError("Entre na campanha para calcular as condições da ficha.");
      return stop;
    }
    setLoading(true);
    const live = () => !controller.signal.aborted;
    const timer = window.setTimeout(() => {
      void fetchSheetProbabilities({
        baseUrl: apiBase,
        sheetId,
        pool: numbers[0]!,
        difficulty: numbers[1]!,
        willpowerDice: numbers[2]!,
        contextTags: contextTag ? [contextTag] : [],
        getAccessToken: accessTokenProvider(auth, accountId),
        signal: controller.signal,
      })
        .then((next) => { if (live()) setResult(next); })
        .catch((caught) => { if (live()) setError(caught instanceof Error ? caught.message : "Não foi possível calcular a ficha."); })
        .finally(() => { if (live()) setLoading(false); });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      stop();
    };
  }, [enabled, sheetId, sheetVersion, sheetPending, accountId, apiBase, pool, difficulty, willpowerDice, contextTag]);

  return { result, loading, error };
}
