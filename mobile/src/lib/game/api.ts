import { checkedBaseUrl, type AccessTokenProvider } from "@/lib/mobile-sync/transport.ts";

/**
 * HTTP client for the table screens (V3, Caçador, V5, XP). Same routes as the web app; the
 * server rolls the dice and writes the sheet. Errors carry the HTTP status (0 = no network),
 * which the offline queue uses to decide between "keep for later" and "refused".
 */
export class GameApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GameApiError";
    this.status = status;
  }
}

export type GameApiOptions = {
  baseUrl: string;
  getAccessToken: AccessTokenProvider;
  fetcher?: typeof fetch;
};

export type GameRequest = (method: "GET" | "POST" | "PATCH", path: string, body?: unknown, signal?: AbortSignal) => Promise<unknown>;

const MAX_BODY = 512 * 1024;

/** Readable message from a FastAPI error body ({detail: string | [{msg}]}). */
export function errorDetail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const parts = detail.map((item) => (item && typeof item === "object" && "msg" in item ? String((item as { msg: unknown }).msg) : "")).filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
  }
  return fallback;
}

function statusMessage(status: number): string {
  if (status === 401) return "Sessão expirada. Entre novamente.";
  if (status === 403) return "Operação não permitida para esta conta.";
  if (status === 404) return "Ficha ou registro indisponível para esta conta.";
  if (status === 409) return "Esta ação conflita com outra já aplicada.";
  if (status === 422) return "Pedido inválido para esta ficha.";
  if (status === 429 || status >= 500) return "Servidor indisponível no momento. Tente de novo.";
  return "A API recusou o pedido.";
}

/** Only paths of this API; no absolute URLs, no traversal. */
export function safeApiPath(path: string): string {
  if (!/^\/api\/v1\/[A-Za-z0-9/_\-.?=&%]+$/.test(path) || path.includes("..") || path.includes("//")) throw new GameApiError("Caminho de API inválido.", 422);
  return path;
}

export function createGameRequest(options: GameApiOptions): GameRequest {
  const base = checkedBaseUrl(options.baseUrl);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  return async (method, path, body, signal) => {
    const url = `${base}${safeApiPath(path)}`;
    let refreshed = false;
    for (;;) {
      const token = await options.getAccessToken(refreshed);
      if (!token) throw new GameApiError("Entre na campanha para continuar.", 401);
      let response: Response;
      try {
        response = await fetcher(url, {
          method,
          headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), Authorization: `Bearer ${token}` },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
          redirect: "error",
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new GameApiError("Sem conexão com o servidor.", 0);
      }
      if (response.status === 401 && !refreshed) { refreshed = true; continue; }
      const text = await response.text();
      if (text.length > MAX_BODY) throw new GameApiError("Resposta do servidor excede o limite.", 502);
      let parsed: unknown = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch { parsed = null; }
      }
      if (!response.ok) throw new GameApiError(errorDetail(parsed, statusMessage(response.status)), response.status);
      return parsed;
    }
  };
}

/** True when the failure means "try later" (offline, server busy, session to refresh). */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof GameApiError)) return !(error instanceof DOMException && error.name === "AbortError");
  return error.status === 0 || error.status === 401 || error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504;
}

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
