import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Porta de acesso ao banco usada pelos repositórios de `lib/data/`.
 * A tela passa o cliente do navegador (`lib/supabase/client.ts`) e as rotas
 * do servidor passam o cliente com cookies (`lib/supabase/server.ts`).
 * Os testes passam um cliente falso que grava a cadeia de chamadas.
 */
export type Db = Pick<SupabaseClient, "from" | "rpc">;

/** Liga o cancelamento da tela à consulta, quando a tela passa um sinal. */
export function cancellable<T extends { abortSignal(signal: AbortSignal): T }>(query: T, signal?: AbortSignal): T {
  return signal ? query.abortSignal(signal) : query;
}

/**
 * Colunas escolhidas pela tela. O tipo vira "*" para o TypeScript não tentar
 * interpretar uma lista que só é conhecida em tempo de execução; a tela
 * converte a linha para o próprio tipo, como já fazia.
 */
export function anyColumns(columns: string): "*" {
  return columns as "*";
}
