import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AccessTokenProvider } from "@/lib/mobile-sync/transport.ts";

export type SupabaseEnv = { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string };

let configurationProblem: string | null = null;

function validateSupabaseConfig(urlValue: string, key: string): string | null {
  let url: URL;
  try { url = new URL(urlValue); } catch { return "A URL do Supabase precisa ser absoluta."; }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) return "A URL do Supabase precisa usar HTTPS (HTTP só vale em localhost), sem credenciais, query ou fragmento.";
  if (key.startsWith("sb_secret_") || key.length > 5000) return "Configure uma chave publishable/anon do Supabase, nunca uma chave secreta.";
  if (key.split(".").length === 3) {
    try {
      const payload = JSON.parse(atob(key.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: unknown };
      if (payload.role === "service_role") return "A chave service_role não pode ficar no navegador.";
    } catch { /* publishable keys are not JWTs */ }
  }
  return null;
}

export function accessTokenProvider(client: Pick<SupabaseClient, "auth">): AccessTokenProvider {
  return async (refresh = false) => {
    const response = refresh ? await client.auth.refreshSession() : await client.auth.getSession();
    if (response.error) throw response.error;
    return response.data.session?.access_token ?? null;
  };
}

let singleton: SupabaseClient | null | undefined;
export function getSupabaseAuth(env = import.meta.env as SupabaseEnv): SupabaseClient | null {
  if (singleton !== undefined) return singleton;
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) { configurationProblem = "Informe VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY para habilitar entrada."; return singleton = null; }
  configurationProblem = validateSupabaseConfig(url, key);
  if (configurationProblem) return singleton = null;
  try {
    singleton = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  } catch { configurationProblem = "A configuração do Supabase é inválida."; singleton = null; }
  return singleton;
}

export function getSupabaseConfigProblem(): string | null { return configurationProblem; }
export function resetSupabaseAuthForTests(): void { singleton = undefined; configurationProblem = null; }
