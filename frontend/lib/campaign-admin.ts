// Regras puras do painel de participantes (CAM-08/09/10), testáveis sem Supabase.

export type CampaignRole = "owner" | "master" | "player" | "guest";
export type InviteRole = Exclude<CampaignRole, "owner">;

export const inviteRoles: InviteRole[] = ["master", "player", "guest"];

export const roleLabels: Record<CampaignRole, string> = {
  owner: "Dono",
  master: "Mestre",
  player: "Jogador",
  guest: "Convidado",
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function isInviteRole(value: unknown): value is InviteRole {
  return typeof value === "string" && (inviteRoles as string[]).includes(value);
}

/** null = sem e-mail (convite só por código); false = e-mail inválido. */
export function normalizeInviteEmail(value: string): string | null | false {
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (email.length > 320 || !emailPattern.test(email)) return false;
  return email;
}

export function normalizeInviteCode(value: string): string | null {
  const code = value.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-F0-9]{12}$/.test(code) ? code : null;
}

/** Agrupa o código em blocos de 4 para leitura em voz alta ou cópia. */
export function formatInviteCode(code: string) {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** Espelha as regras das RPCs: só o dono lida com mestres; ninguém altera o dono nem a si mesmo. */
export function canAdministerMember(viewer: { id: string; isOwner: boolean; canManage: boolean }, member: { userId: string; role: CampaignRole }) {
  if (!viewer.canManage || member.role === "owner" || member.userId === viewer.id) return false;
  return viewer.isOwner || member.role !== "master";
}

export function assignableRoles(viewer: { isOwner: boolean }): InviteRole[] {
  return viewer.isOwner ? inviteRoles : inviteRoles.filter((role) => role !== "master");
}

export function deletionConfirmed(campaignName: string, typed: string) {
  return typed.length > 0 && typed === campaignName;
}

const messages: Array<[RegExp, string]> = [
  [/only the owner/i, "Só o dono da campanha pode fazer isso com mestres."],
  [/campaign owner required/i, "Só o dono da campanha pode fazer isso."],
  [/campaign manager required/i, "Só o dono ou um mestre da campanha pode fazer isso."],
  [/addressed to another account/i, "Este convite foi enviado para outro e-mail."],
  [/invite is not valid|no longer pending/i, "Convite inválido, expirado ou já usado."],
  [/already a campaign member|owner is already/i, "Você já participa desta campanha."],
  [/name confirmation/i, "O nome digitado não confere com o nome da campanha."],
  [/own role/i, "Você não pode alterar o próprio papel."],
  [/member not found/i, "Participante não encontrado."],
  [/too many pending/i, "Há convites pendentes demais. Revogue alguns antes de criar outros."],
  [/invalid invite email/i, "Informe um e-mail válido."],
  [/invalid display name/i, "O nome de exibição precisa ter entre 2 e 80 caracteres."],
  [/campaign access denied/i, "Você não tem acesso a esta campanha."],
];

export function campaignAdminErrorMessage(error: { code?: string; message?: string } | null | undefined, fallback: string) {
  const text = error?.message ?? "";
  for (const [pattern, message] of messages) if (pattern.test(text)) return message;
  if (error?.code === "42501") return "Você não tem permissão para esta ação.";
  return fallback;
}
