import { createClient } from "../supabase/client";
import type { Db } from "./db.ts";

/** Cliente do navegador para os repositórios; o @supabase/ssr reaproveita a mesma instância. */
export function browserDb(): Db {
  return createClient();
}

/** Id do usuário com sessão no navegador, ou `null` quando ninguém entrou. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await createClient().auth.getUser();
  return data.user?.id ?? null;
}
