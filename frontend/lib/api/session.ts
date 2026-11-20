import { createClient } from "../supabase/client";
import { apiJson, apiSend, ApiError, DEFAULT_MESSAGES, type ApiMessages, type ApiRequest, type ApiResponse } from "./http.ts";

/**
 * Chamadas do navegador com a sessão do Supabase. A URL vem de
 * NEXT_PUBLIC_API_URL e o token da sessão atual; o resto fica em `http.ts`.
 */

export type SessionMessages = ApiMessages & {
  /** Sem sessão no navegador. */
  signedOut?: string;
};

const SIGNED_OUT = "Sua sessão expirou. Entre novamente.";

export function apiBase(): string | null {
  return process.env.NEXT_PUBLIC_API_URL?.trim() || null;
}

/** Token da sessão atual; lança `ApiError` quando não há sessão. */
export async function sessionToken(signedOut = SIGNED_OUT): Promise<string> {
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new ApiError(signedOut, "config", 401);
  return data.session.access_token;
}

/** Token da sessão atual, ou `null` quando ninguém entrou. */
export async function optionalSessionToken(): Promise<string | null> {
  const { data } = await createClient().auth.getSession();
  return data.session?.access_token ?? null;
}

async function prepare(request: ApiRequest, messages: SessionMessages): Promise<{ base: string; request: ApiRequest }> {
  const base = apiBase();
  if (!base) throw new ApiError(messages.missingApi ?? DEFAULT_MESSAGES.missingApi, "config");
  const token = request.token ?? await sessionToken(messages.signedOut);
  return { base, request: { ...request, token } };
}

/** Chamada autenticada que devolve o corpo ou lança `ApiError` com a mensagem pronta. */
export async function sessionJson<T = unknown>(path: string, request: ApiRequest = {}, messages: SessionMessages = {}): Promise<T> {
  const ready = await prepare(request, messages);
  return apiJson<T>(ready.base, path, ready.request, messages);
}

/** Chamada autenticada que devolve status e corpo para a tela decidir. */
export async function sessionSend(path: string, request: ApiRequest = {}, messages: SessionMessages = {}): Promise<ApiResponse> {
  const ready = await prepare(request, messages);
  return apiSend(ready.base, path, ready.request, messages);
}

/** Chamada pública, sem token. */
export async function publicJson<T = unknown>(path: string, request: ApiRequest = {}, messages: ApiMessages = {}): Promise<T> {
  return apiJson<T>(apiBase(), path, { ...request, token: null }, messages);
}
