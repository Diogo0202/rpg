/** Regras da tela "Mais", sem React: links de música e lista de modelos da biblioteca. */

import type { JsonValue } from "@/lib/mobile-sync";
import { SYSTEM_STARTERS } from "../../../../../shared/rules/system-starters";

export type MusicLink = { title: string; url: string };
export type LibraryTemplate = { id: string; name: string; version: number; system: string };

const SPOTIFY_HOSTS = new Set(["open.spotify.com", "spotify.link"]);
export const MUSIC_TITLE_LIMIT = 120;

/** Aceita só links HTTPS do Spotify, sem usuário ou senha na URL. */
export function spotifyUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const safe = url.protocol === "https:" && SPOTIFY_HOSTS.has(url.hostname.toLowerCase()) && !url.username && !url.password;
    return safe ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Valida título e link; devolve o erro para o jogador ou os dados prontos para salvar. */
export function musicLinkInput(title: string, url: string): { error: string } | { data: MusicLink } {
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > MUSIC_TITLE_LIMIT) return { error: `Informe um título de até ${MUSIC_TITLE_LIMIT} caracteres.` };
  const safeUrl = spotifyUrl(url);
  if (!safeUrl) return { error: "Use um link HTTPS de open.spotify.com ou spotify.link." };
  return { data: { title: cleanTitle, url: safeUrl } };
}

export function localLibrary(): LibraryTemplate[] {
  return SYSTEM_STARTERS.map((starter) => ({ id: starter.id, name: starter.label, version: starter.template.version, system: starter.label }));
}

type TemplateRow = { id: string; data: Record<string, JsonValue> };

function isApproved(row: TemplateRow): boolean {
  const { status, name, version } = row.data;
  return status === "approved" && typeof name === "string" && name.trim().length > 0
    && typeof version === "number" && Number.isSafeInteger(version) && version >= 1;
}

function systemLabel(schema: JsonValue | undefined): string {
  const systemKey = schema && typeof schema === "object" && !Array.isArray(schema) ? schema.system_key : undefined;
  if (typeof systemKey !== "string") return "Sistema não informado";
  return SYSTEM_STARTERS.find((starter) => starter.id === systemKey)?.label ?? (systemKey.trim() ? systemKey : "Sistema não informado");
}

/** Modelos aprovados da campanha, com o nome do sistema quando ele é conhecido. */
export function campaignLibrary(rows: TemplateRow[]): LibraryTemplate[] {
  return rows.filter(isApproved).map((row) => ({
    id: row.id,
    name: row.data.name as string,
    version: row.data.version as number,
    system: systemLabel(row.data.schema),
  }));
}
