import { createClient } from "./supabase/client";

export type InviteEmailResult = { emailSentCount: number | null; lastEmailSentAt: string | null };

/**
 * Pede à API que envie o e-mail de um convite. Só o id viaja: o destinatário,
 * o código e os nomes são lidos do banco com a sessão de quem pede.
 */
export async function sendCampaignInviteEmail(inviteId: string): Promise<InviteEmailResult> {
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (!api) throw new Error("A API não está configurada; compartilhe o código do convite.");
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error("Sua sessão expirou. Entre novamente para enviar o convite.");
  let response: Response;
  try {
    response = await fetch(`${api.replace(/\/$/, "")}/api/v1/campaign-invites/${encodeURIComponent(inviteId)}/email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
  } catch {
    throw new Error("Não foi possível alcançar a API; compartilhe o código do convite.");
  }
  const decoded: unknown = await response.json().catch(() => null);
  const body = decoded && typeof decoded === "object" ? (decoded as Record<string, unknown>) : {};
  if (!response.ok) {
    const detail = typeof body.detail === "string" ? body.detail.slice(0, 300) : "";
    throw new Error(detail || "Não foi possível enviar o e-mail do convite.");
  }
  return {
    emailSentCount: typeof body.email_sent_count === "number" ? body.email_sent_count : null,
    lastEmailSentAt: typeof body.last_email_sent_at === "string" ? body.last_email_sent_at : null,
  };
}
