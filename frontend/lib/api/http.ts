/**
 * Cliente único da API FastAPI. Junta num só lugar a URL base, o token,
 * o tempo limite, a leitura do JSON e a tradução de status em mensagem.
 * Não depende do Supabase nem do React, para ser testado com `node --test`.
 */

export type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type ApiRequest = {
  method?: ApiMethod;
  /** Corpo enviado como JSON; `undefined` não manda corpo nem Content-Type. */
  body?: unknown;
  /** Token de acesso do Supabase; sem token, a chamada vai sem Authorization. */
  token?: string | null;
  signal?: AbortSignal;
  /** Cancela a chamada depois deste prazo; sem valor, não há prazo. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  cache?: RequestCache;
  credentials?: RequestCredentials;
};

/** Mensagens que a tela mostra. Cada cliente troca só as que precisa. */
export type ApiMessages = {
  /** Mensagem fixa por status; vence o `detail` do servidor. */
  status?: Partial<Record<number, string>>;
  /** Status 5xx sem mensagem fixa. */
  unavailable?: string;
  /** Recusa sem mensagem fixa e sem `detail` legível. */
  rejected?: string;
  /** Usa o `detail` do servidor quando não há mensagem fixa (padrão: sim). */
  useDetail?: boolean;
  /** Texto posto antes do `detail`. */
  detailPrefix?: string;
  /** Mostra também a lista de erros de validação do Pydantic. */
  validationDetail?: boolean;
  network?: string;
  timeout?: string;
  missingApi?: string;
};

export type ApiResponse = {
  ok: boolean;
  status: number;
  /** JSON decodificado, ou `null` quando não há corpo ou ele não é JSON. */
  body: unknown;
  /** Se o corpo foi lido como JSON. */
  parsed: boolean;
  headers: Headers;
};

export type ApiErrorKind = "config" | "network" | "timeout" | "http";

/** Erro com mensagem já pronta para a tela; `status` é 0 quando não houve resposta. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly detail: string | null;

  constructor(message: string, kind: ApiErrorKind, status = 0, detail: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

export const DEFAULT_MESSAGES = {
  unavailable: "A API está indisponível. Tente novamente em instantes.",
  rejected: "A API recusou o pedido.",
  network: "Não foi possível alcançar a API.",
  timeout: "A API demorou além do esperado. Tente novamente.",
  missingApi: "A API não está configurada.",
  tooManyRequests: "Limite de solicitações atingido. Aguarde antes de tentar novamente.",
} as const;

const DETAIL_LIMIT = 300;

export function apiUrl(base: string, path: string): string {
  return `${base.trim().replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Texto `detail` de uma resposta de erro do FastAPI, cortado para caber na tela.
 * Com `validation`, a lista de erros do Pydantic (422) vira uma frase só.
 */
export function detailOf(body: unknown, limit = DETAIL_LIMIT, validation = false): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === "string") return detail.trim() ? detail.slice(0, limit) : null;
  if (!validation || !Array.isArray(detail) || !detail.length) return null;
  return detail
    .map((item) => item && typeof item === "object" && "msg" in item ? String(item.msg) : "Confira os campos enviados.")
    .join(" ")
    .slice(0, limit);
}

/** Corpo JSON tratado como objeto; listas, nulos e textos viram `{}`. */
export function objectBody(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

/** Aviso de limite de pedidos com o prazo do header Retry-After, quando ele vier. */
export function retryAfterMessage(headers: Headers): string {
  const seconds = Number(headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0
    ? `Limite de solicitações atingido. Tente em ${seconds} segundos.`
    : DEFAULT_MESSAGES.tooManyRequests;
}

/** Mensagem que a tela mostra para uma resposta recusada. */
export function errorMessage(response: Pick<ApiResponse, "status" | "body">, messages: ApiMessages = {}): string {
  const fixed = messages.status?.[response.status];
  if (fixed) return fixed;
  if (response.status >= 500 && messages.unavailable) return messages.unavailable;
  const detail = messages.useDetail === false ? null : detailOf(response.body, DETAIL_LIMIT, messages.validationDetail);
  if (detail) return `${messages.detailPrefix ?? ""}${detail}`;
  if (response.status >= 500) return DEFAULT_MESSAGES.unavailable;
  return messages.rejected ?? DEFAULT_MESSAGES.rejected;
}

/**
 * Faz a chamada e devolve status e corpo sem julgar o resultado.
 * Lança `ApiError` só quando não há resposta: API sem URL, rede, prazo ou cancelamento.
 */
export async function apiSend(
  base: string | null | undefined,
  path: string,
  request: ApiRequest = {},
  messages: ApiMessages = {},
  fetchImpl?: typeof fetch,
): Promise<ApiResponse> {
  if (!base?.trim()) throw new ApiError(messages.missingApi ?? DEFAULT_MESSAGES.missingApi, "config");
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (request.signal?.aborted) controller.abort();
  request.signal?.addEventListener("abort", forwardAbort, { once: true });
  let timedOut = false;
  const timer = request.timeoutMs ? setTimeout(() => { timedOut = true; controller.abort(); }, request.timeoutMs) : null;
  const headers: Record<string, string> = { ...request.headers };
  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  if (request.token) headers.Authorization = `Bearer ${request.token}`;
  try {
    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(apiUrl(base, path), {
        method: request.method ?? "GET",
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
        ...(request.cache ? { cache: request.cache } : {}),
        ...(request.credentials ? { credentials: request.credentials } : {}),
      });
    } catch (error) {
      if (timedOut) throw new ApiError(messages.timeout ?? DEFAULT_MESSAGES.timeout, "timeout");
      // O cancelamento pedido pela tela segue como AbortError, igual ao fetch.
      if (controller.signal.aborted) throw new DOMException("Pedido cancelado.", "AbortError");
      throw new ApiError(messages.network ?? DEFAULT_MESSAGES.network, "network", 0, error instanceof Error ? error.message : null);
    }
    let body: unknown = null;
    let parsed = false;
    if (response.status !== 204) {
      try {
        body = await response.json();
        parsed = true;
      } catch {
        if (timedOut) throw new ApiError(messages.timeout ?? DEFAULT_MESSAGES.timeout, "timeout");
        body = null;
      }
    }
    return { ok: response.ok, status: response.status, body, parsed, headers: response.headers };
  } finally {
    if (timer) clearTimeout(timer);
    request.signal?.removeEventListener("abort", forwardAbort);
  }
}

/** Devolve a resposta aceita; uma recusa vira `ApiError` com a mensagem traduzida. */
export function ensureOk(response: ApiResponse, messages: ApiMessages = {}): ApiResponse {
  if (!response.ok) throw new ApiError(errorMessage(response, messages), "http", response.status, detailOf(response.body));
  return response;
}

/** Faz a chamada e devolve o corpo; uma recusa vira `ApiError` com a mensagem traduzida. */
export async function apiJson<T = unknown>(base: string | null | undefined, path: string, request: ApiRequest = {}, messages: ApiMessages = {}): Promise<T> {
  return ensureOk(await apiSend(base, path, request, messages), messages).body as T;
}

/** Cancelamento pedido pela própria tela, que não deve virar aviso de erro. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
