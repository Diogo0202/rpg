import { anyColumns, type Db } from "./db.ts";

/**
 * Campanha, membros, convites, perfil, presença e chat. As páginas e ações do
 * servidor passam o cliente com cookies; as telas passam o do navegador.
 */

export function listMemberIds(db: Db, campaignId: string) {
  return db.from("campaign_members").select("user_id").eq("campaign_id", campaignId);
}

export function listMemberRoles(db: Db, campaignId: string) {
  return db.from("campaign_members").select("user_id,role").eq("campaign_id", campaignId);
}

export function memberRole(db: Db, campaignId: string, userId: string) {
  return db.from("campaign_members").select("role").eq("campaign_id", campaignId).eq("user_id", userId).maybeSingle();
}

export function listMyCampaigns(db: Db) {
  return db.from("campaigns").select("id, name, description, owner_id, updated_at").order("updated_at", { ascending: false });
}

export function findCampaign(db: Db, campaignId: string) {
  return db.from("campaigns").select("id, name, owner_id").eq("id", campaignId).maybeSingle();
}

export function campaignOwner(db: Db, campaignId: string) {
  return db.from("campaigns").select("owner_id").eq("id", campaignId).maybeSingle();
}

export function campaignDetails(db: Db, campaignId: string) {
  return db.from("campaigns").select("name, description").eq("id", campaignId).maybeSingle();
}

export function createCampaign(db: Db, ownerId: string, name: string, description: string) {
  return db.from("campaigns").insert({ owner_id: ownerId, name, description }).select("id").single();
}

export function updateCampaignDetails(db: Db, campaignId: string, name: string, description: string) {
  return db.rpc("update_campaign_details", { p_campaign_id: campaignId, p_name: name, p_description: description });
}

/** A RPC exige o nome exato da campanha para excluir. */
export function deleteCampaign(db: Db, campaignId: string, confirmName: string) {
  return db.rpc("delete_campaign", { p_campaign_id: campaignId, p_confirm_name: confirmName });
}

export function listCampaignMembers(db: Db, campaignId: string) {
  return db.rpc("list_campaign_members", { p_campaign_id: campaignId });
}

export function setMemberRole(db: Db, campaignId: string, userId: string, role: string) {
  return db.rpc("set_campaign_member_role", { p_campaign_id: campaignId, p_user_id: userId, p_role: role });
}

export function removeMember(db: Db, campaignId: string, userId: string) {
  return db.rpc("remove_campaign_member", { p_campaign_id: campaignId, p_user_id: userId });
}

/** Convites ainda válidos, do mais novo para o mais antigo. */
export function listPendingInvites(db: Db, campaignId: string, now = new Date()) {
  return db.from("campaign_invites").select("id, email, code, role, expires_at, email_sent_count, last_email_sent_at").eq("campaign_id", campaignId)
    .eq("status", "pending").gt("expires_at", now.toISOString()).order("created_at", { ascending: false });
}

export function createInvite(db: Db, campaignId: string, role: string, email: string | null) {
  return db.rpc("create_campaign_invite", { p_campaign_id: campaignId, p_role: role, p_email: email }).single<{ code: string; email: string | null }>();
}

/** Aceita pelo id (convite para o e-mail da conta) ou pelo código de 12 caracteres. */
export function acceptInvite(db: Db, invite: { inviteId: string } | { code: string }) {
  return db.rpc("accept_campaign_invite", "inviteId" in invite ? { p_code: null, p_invite_id: invite.inviteId } : { p_code: invite.code, p_invite_id: null });
}

export function revokeInvite(db: Db, inviteId: string) {
  return db.rpc("revoke_campaign_invite", { p_invite_id: inviteId });
}

export function listMyInvites(db: Db) {
  return db.rpc("list_my_campaign_invites");
}

export function declineInvite(db: Db, inviteId: string) {
  return db.rpc("decline_campaign_invite", { p_invite_id: inviteId });
}

export function profileName(db: Db, userId: string) {
  return db.from("profiles").select("display_name").eq("id", userId).maybeSingle();
}

export function saveMyProfile(db: Db, displayName: string) {
  return db.rpc("upsert_my_profile", { p_display_name: displayName });
}

export function chatParticipants(db: Db, campaignId: string) {
  return db.rpc("campaign_chat_participants", { p_campaign: campaignId });
}

export function listChatMessages(db: Db, campaignId: string, columns: string, limit: number) {
  return db.from("campaign_chat_messages").select(anyColumns(columns))
    .eq("campaign_id", campaignId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
}

/** O id vem do navegador para a mensagem aparecer antes da confirmação do banco. */
export function sendChatMessage(db: Db, message: { id: string; campaign_id: string; recipient_id: string | null; body: string }, columns: string) {
  return db.from("campaign_chat_messages")
    .insert({ id: message.id, campaign_id: message.campaign_id, recipient_id: message.recipient_id, body: message.body })
    .select(anyColumns(columns)).single();
}

export function editChatMessage(db: Db, messageId: string, body: string, columns: string) {
  return db.from("campaign_chat_messages").update({ body }).eq("id", messageId).select(anyColumns(columns)).single();
}

export function deleteChatMessage(db: Db, messageId: string) {
  return db.from("campaign_chat_messages").delete().eq("id", messageId);
}
