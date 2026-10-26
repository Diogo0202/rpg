"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server";
import {
  campaignAdminErrorMessage,
  isInviteRole,
  isUuid,
  normalizeInviteCode,
  normalizeInviteEmail,
  type InviteRole,
} from "../../lib/campaign-admin";

export type AdminActionState = { error: string | null; message: string | null; code?: string | null };

async function authenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return { supabase, user: data.user };
}

function failure(error: { code?: string; message?: string } | null, fallback: string): AdminActionState {
  return { error: campaignAdminErrorMessage(error, fallback), message: null };
}

export async function createCampaignInvite(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const role = String(formData.get("role") ?? "player");
  const rawEmail = String(formData.get("email") ?? "");
  if (!isUuid(campaignId)) return { error: "Campanha inválida.", message: null };
  if (!isInviteRole(role)) return { error: "Escolha um papel válido.", message: null };
  const email = normalizeInviteEmail(rawEmail);
  if (email === false) return { error: "Informe um e-mail válido ou deixe o campo vazio para gerar só o código.", message: null };

  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase
    .rpc("create_campaign_invite", { p_campaign_id: campaignId, p_role: role, p_email: email })
    .single<{ code: string; email: string | null }>();
  if (error || !data) return failure(error, "Não foi possível criar o convite.");
  revalidatePath(`/app/campaign/${campaignId}`);
  return {
    error: null,
    code: data.code,
    message: data.email
      ? `Convite criado para ${data.email}. A pessoa verá o convite ao entrar com esse e-mail; use “Enviar por e-mail” na lista de pendentes ou compartilhe o código.`
      : "Código criado. Envie-o à pessoa convidada; ele vale uma única vez por 14 dias.",
  };
}

export async function revokeCampaignInvite(campaignId: string, inviteId: string): Promise<AdminActionState> {
  if (!isUuid(campaignId) || !isUuid(inviteId)) return { error: "Convite inválido.", message: null };
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("revoke_campaign_invite", { p_invite_id: inviteId });
  if (error) return failure(error, "Não foi possível revogar o convite.");
  revalidatePath(`/app/campaign/${campaignId}`);
  return { error: null, message: "Convite revogado." };
}

export async function setCampaignMemberRole(campaignId: string, userId: string, role: InviteRole): Promise<AdminActionState> {
  if (!isUuid(campaignId) || !isUuid(userId) || !isInviteRole(role)) return { error: "Alteração inválida.", message: null };
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("set_campaign_member_role", { p_campaign_id: campaignId, p_user_id: userId, p_role: role });
  if (error) return failure(error, "Não foi possível alterar o papel.");
  revalidatePath(`/app/campaign/${campaignId}`);
  return { error: null, message: "Papel atualizado." };
}

export async function removeCampaignMember(campaignId: string, userId: string): Promise<AdminActionState> {
  if (!isUuid(campaignId) || !isUuid(userId)) return { error: "Participante inválido.", message: null };
  const { supabase, user } = await authenticatedClient();
  const { error } = await supabase.rpc("remove_campaign_member", { p_campaign_id: campaignId, p_user_id: userId });
  if (error) return failure(error, "Não foi possível remover o participante.");
  if (userId === user.id) {
    revalidatePath("/app");
    redirect("/app");
  }
  revalidatePath(`/app/campaign/${campaignId}`);
  return { error: null, message: "Participante removido." };
}

export async function updateCampaignDetails(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!isUuid(campaignId)) return { error: "Campanha inválida.", message: null };
  if (name.length < 3 || name.length > 120) return { error: "O nome precisa ter entre 3 e 120 caracteres.", message: null };
  if (description.length > 2000) return { error: "A descrição aceita até 2.000 caracteres.", message: null };
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("update_campaign_details", { p_campaign_id: campaignId, p_name: name, p_description: description });
  if (error) return failure(error, "Não foi possível salvar a campanha.");
  revalidatePath("/app");
  revalidatePath(`/app/campaign/${campaignId}`);
  return { error: null, message: "Dados da campanha salvos." };
}

export async function deleteCampaign(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "");
  if (!isUuid(campaignId)) return { error: "Campanha inválida.", message: null };
  if (!confirmName) return { error: "Digite o nome da campanha para confirmar.", message: null };
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("delete_campaign", { p_campaign_id: campaignId, p_confirm_name: confirmName });
  if (error) return failure(error, "Não foi possível excluir a campanha.");
  revalidatePath("/app");
  redirect("/app");
}

export async function acceptCampaignInvite(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const inviteId = String(formData.get("inviteId") ?? "");
  const code = normalizeInviteCode(String(formData.get("code") ?? ""));
  if (inviteId && !isUuid(inviteId)) return { error: "Convite inválido.", message: null };
  if (!inviteId && !code) return { error: "O código tem 12 caracteres (letras A-F e números).", message: null };
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc(
    "accept_campaign_invite",
    inviteId ? { p_code: null, p_invite_id: inviteId } : { p_code: code, p_invite_id: null },
  );
  if (error || typeof data !== "string" || !isUuid(data)) return failure(error, "Não foi possível aceitar o convite.");
  revalidatePath("/app");
  redirect(`/app/campaign/${data}`);
}

export async function declineCampaignInvite(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!isUuid(inviteId)) return { error: "Convite inválido.", message: null };
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("decline_campaign_invite", { p_invite_id: inviteId });
  if (error) return failure(error, "Não foi possível recusar o convite.");
  revalidatePath("/app");
  return { error: null, message: "Convite recusado." };
}

export async function updateProfile(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const displayName = String(formData.get("displayName") ?? "").replace(/\s+/g, " ").trim();
  if (displayName.length < 2 || displayName.length > 80) return { error: "O nome de exibição precisa ter entre 2 e 80 caracteres.", message: null };
  const { supabase } = await authenticatedClient();
  const { error } = await supabase.rpc("upsert_my_profile", { p_display_name: displayName });
  if (error) return failure(error, "Não foi possível salvar o perfil.");
  revalidatePath("/app/perfil");
  return { error: null, message: "Perfil salvo." };
}
