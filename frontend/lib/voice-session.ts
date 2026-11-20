import { browserDb } from "./data/browser";
import { voiceSession } from "./data/campaign";
import { objectBody } from "./api/http.ts";
import { sessionJson, sessionSend } from "./api/session.ts";

export type VoiceStatus = "pending" | "ready" | "failed";
export type VoiceSession = { status: VoiceStatus; inviteUrl: string | null; expiresAt: string | null; error: string | null; updatedAt: string | null };

const INVITE_URL = /^https:\/\/discord\.gg\/[A-Za-z0-9-]{2,32}$/;

/** Only discord.gg invites are ever rendered as a link (the database enforces the same pattern). */
export function safeInviteUrl(value: unknown): string | null {
  return typeof value === "string" && INVITE_URL.test(value) ? value : null;
}

/** A ready invite that has not expired (null expiry = permanent). */
export function hasValidInvite(session: VoiceSession | null, now = Date.now()): boolean {
  if (!session || session.status !== "ready" || !session.inviteUrl) return false;
  if (!session.expiresAt) return true;
  const expires = Date.parse(session.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

export function parseVoiceSession(row: unknown): VoiceSession | null {
  if (!row || typeof row !== "object") return null;
  const data = row as Record<string, unknown>;
  const status = data.status === "pending" || data.status === "ready" || data.status === "failed" ? data.status : null;
  if (!status) return null;
  return {
    status,
    inviteUrl: safeInviteUrl(data.invite_url),
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
    error: typeof data.error === "string" ? data.error.slice(0, 200) : null,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
  };
}

/** Reads the campaign voice session through RLS (members only). */
export async function loadVoiceSession(campaignId: string): Promise<VoiceSession | null> {
  const { data, error } = await voiceSession(browserDb(), campaignId);
  if (error) throw new Error("Não foi possível ler a sala de voz.");
  return parseVoiceSession(data);
}

/** Whether the server has Discord configured; any failure hides the button. */
export async function voiceEnabled(): Promise<boolean> {
  try {
    const result = await sessionSend("/api/v1/voice-sessions/config");
    return result.ok && objectBody(result.body).enabled === true;
  } catch {
    return false;
  }
}

/** Asks the API to create (or reuse) the voice room. The server checks owner/master in the database. */
export async function requestVoiceRoom(campaignId: string): Promise<{ status: VoiceStatus; inviteUrl: string | null }> {
  const body = objectBody(await sessionJson(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/voice-session`, { method: "POST" }, {
    rejected: "Não foi possível criar a sala de voz.",
    missingApi: "Não foi possível criar a sala de voz.",
  }));
  const status = body.status === "ready" || body.status === "failed" ? body.status : "pending";
  return { status, inviteUrl: safeInviteUrl(body.invite_url) };
}
