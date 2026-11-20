import { objectBody } from "./api/http.ts";
import { sessionJson } from "./api/session.ts";

export type InviteEmailResult = { emailSentCount: number | null; lastEmailSentAt: string | null };

/**
 * Pede à API que envie o e-mail de um convite. Só o id viaja: o destinatário,
 * o código e os nomes são lidos do banco com a sessão de quem pede.
 */
export async function sendCampaignInviteEmail(inviteId: string): Promise<InviteEmailResult> {
  const body = objectBody(await sessionJson(`/api/v1/campaign-invites/${encodeURIComponent(inviteId)}/email`, { method: "POST" }, {
    missingApi: "A API não está configurada; compartilhe o código do convite.",
    signedOut: "Sua sessão expirou. Entre novamente para enviar o convite.",
    network: "Não foi possível alcançar a API; compartilhe o código do convite.",
    rejected: "Não foi possível enviar o e-mail do convite.",
  }));
  return {
    emailSentCount: typeof body.email_sent_count === "number" ? body.email_sent_count : null,
    lastEmailSentAt: typeof body.last_email_sent_at === "string" ? body.last_email_sent_at : null,
  };
}
