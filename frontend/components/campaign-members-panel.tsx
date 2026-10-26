"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";

import {
  createCampaignInvite,
  deleteCampaign,
  removeCampaignMember,
  revokeCampaignInvite,
  setCampaignMemberRole,
  updateCampaignDetails,
  type AdminActionState,
} from "../app/app/campaign-admin-actions";
import {
  assignableRoles,
  canAdministerMember,
  deletionConfirmed,
  formatInviteCode,
  roleLabels,
  type CampaignRole,
  type InviteRole,
} from "../lib/campaign-admin";
import { sendCampaignInviteEmail } from "../lib/campaign-invite-email";
import { createClient } from "../lib/supabase/client";
import styles from "./campaign-members-panel.module.css";

type Member = { user_id: string; role: CampaignRole; display_name: string | null; email: string | null; joined_at: string };
type Invite = {
  id: string; email: string | null; code: string; role: InviteRole; expires_at: string;
  email_sent_count?: number | null; last_email_sent_at?: string | null;
};
type EmailSendState = { pending: boolean; error: string | null; message: string | null };
type Props = { campaignId: string; viewerId: string; isOwner: boolean; canManage: boolean };

const emptyState: AdminActionState = { error: null, message: null };
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function CampaignMembersPanel({ campaignId, viewerId, isOwner, canManage }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [details, setDetails] = useState<{ name: string; description: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AdminActionState>(emptyState);
  const [busy, startTransition] = useTransition();

  const load = useCallback(async () => {
    const client = createClient();
    const [memberResult, inviteResult, campaignResult] = await Promise.all([
      client.rpc("list_campaign_members", { p_campaign_id: campaignId }),
      canManage
        ? client.from("campaign_invites").select("id, email, code, role, expires_at, email_sent_count, last_email_sent_at").eq("campaign_id", campaignId)
          .eq("status", "pending").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      client.from("campaigns").select("name, description").eq("id", campaignId).maybeSingle(),
    ]);
    if (memberResult.error || inviteResult.error) {
      setLoadError("Não foi possível carregar os participantes. Confira a conexão e as migrações do Supabase.");
      return;
    }
    setLoadError(null);
    setMembers((memberResult.data ?? []) as Member[]);
    setInvites((inviteResult.data ?? []) as Invite[]);
    if (campaignResult.data) setDetails({ name: campaignResult.data.name, description: campaignResult.data.description ?? "" });
  }, [campaignId, canManage]);

  useEffect(() => { void load(); }, [load]);

  function run(task: () => Promise<AdminActionState>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    startTransition(async () => {
      const result = await task();
      setFeedback(result);
      if (!result.error) await load();
    });
  }

  const viewer = { id: viewerId, isOwner, canManage };
  const roles = assignableRoles(viewer);

  return (
    <section className={styles.panel} aria-labelledby="members-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>CAMPANHA / PARTICIPANTES</p>
          <h2 id="members-title">Quem está na mesa</h2>
          <p className={styles.intro}>
            {canManage
              ? "Convide por e-mail ou código, ajuste papéis e remova participantes. Mestres administram jogadores e convidados; só o dono lida com mestres."
              : "Veja quem participa desta campanha. Convites e papéis são geridos pelo dono e pelos mestres."}
          </p>
        </div>
      </header>

      {loadError ? <p className={styles.error} role="alert">{loadError}</p> : null}
      <p className={feedback.error ? styles.error : styles.message} role="status" aria-live="polite">{feedback.error ?? feedback.message ?? ""}</p>

      <ul className={styles.list} aria-label="Participantes">
        {members.map((member) => {
          const administrable = canAdministerMember(viewer, { userId: member.user_id, role: member.role });
          const self = member.user_id === viewerId;
          const name = member.display_name ?? (self ? "Você (sem nome de exibição)" : "Participante sem nome de exibição");
          return (
            <li className={styles.member} key={member.user_id}>
              <div className={styles.memberInfo}>
                <strong>{name}{self ? <span className={styles.selfTag}> · você</span> : null}</strong>
                <small>{member.email ?? `Desde ${dateFormat.format(new Date(member.joined_at))}`}</small>
              </div>
              {administrable ? (
                <div className={styles.memberActions}>
                  <label className={styles.inline}>
                    <span className={styles.visuallyHidden}>Papel de {name}</span>
                    <select value={member.role} disabled={busy} onChange={(event) => {
                      const next = event.target.value as InviteRole;
                      run(() => setCampaignMemberRole(campaignId, member.user_id, next));
                    }}>
                      {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                    </select>
                  </label>
                  <button type="button" className={styles.dangerButton} disabled={busy}
                    onClick={() => run(() => removeCampaignMember(campaignId, member.user_id), `Remover ${name} da campanha?`)}>Remover</button>
                </div>
              ) : (
                <div className={styles.memberActions}>
                  <span className={styles.role}>{roleLabels[member.role]}</span>
                  {self && member.role !== "owner" ? (
                    <button type="button" className={styles.secondaryButton} disabled={busy}
                      onClick={() => run(() => removeCampaignMember(campaignId, member.user_id), "Sair desta campanha? Você precisará de um novo convite para voltar.")}>Sair da campanha</button>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canManage ? <InviteSection campaignId={campaignId} roles={roles} invites={invites} busy={busy} isOwner={isOwner}
        onCreated={load} onRevoke={(invite) => run(() => revokeCampaignInvite(campaignId, invite.id), "Revogar este convite?")} /> : null}

      {isOwner && details ? <OwnerSection campaignId={campaignId} details={details} onSaved={load} /> : null}
    </section>
  );
}

function InviteSection({ campaignId, roles, invites, busy, isOwner, onCreated, onRevoke }: {
  campaignId: string; roles: InviteRole[]; invites: Invite[]; busy: boolean; isOwner: boolean;
  onCreated: () => Promise<void>; onRevoke: (invite: Invite) => void;
}) {
  const [state, action, pending] = useActionState(async (previous: AdminActionState, formData: FormData) => {
    const result = await createCampaignInvite(previous, formData);
    if (!result.error) await onCreated();
    return result;
  }, emptyState);
  const [emailStates, setEmailStates] = useState<Record<string, EmailSendState>>({});

  async function sendEmail(invite: Invite) {
    setEmailStates((current) => ({ ...current, [invite.id]: { pending: true, error: null, message: null } }));
    try {
      await sendCampaignInviteEmail(invite.id);
      setEmailStates((current) => ({ ...current, [invite.id]: { pending: false, error: null, message: `E-mail enviado para ${invite.email}.` } }));
      await onCreated();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível enviar o e-mail do convite.";
      setEmailStates((current) => ({ ...current, [invite.id]: { pending: false, error: message, message: null } }));
    }
  }

  return (
    <div className={styles.block}>
      <h3>Convidar</h3>
      <form action={action} className={styles.fields}>
        <input type="hidden" name="campaignId" value={campaignId} />
        <label>E-mail (opcional)
          <input name="email" type="email" maxLength={320} autoComplete="off" placeholder="pessoa@exemplo.com" />
          <small>Sem e-mail, o convite vale para quem tiver o código.</small>
        </label>
        <label>Papel
          <select name="role" defaultValue="player">
            {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
          </select>
        </label>
        <div className={styles.actions}><button className={styles.primaryButton} type="submit" disabled={pending}>{pending ? "Criando…" : "Criar convite"}</button></div>
      </form>
      {state.error ? <p className={styles.error} role="alert">{state.error}</p> : null}
      {state.code ? (
        <p className={styles.codeBox} role="status">
          <span>Código do convite</span>
          <strong>{formatInviteCode(state.code)}</strong>
          <small>{state.message}</small>
        </p>
      ) : null}
      <p className={styles.note}>Convites com e-mail podem ser enviados pelo botão “Enviar por e-mail” (até 5 envios, um a cada 5 minutos). Se o envio não estiver configurado, compartilhe o código.</p>

      <h3>Convites pendentes</h3>
      {invites.length === 0 ? <p className={styles.empty}>Nenhum convite pendente.</p> : (
        <ul className={styles.list}>
          {invites.map((invite) => {
            const manageable = invite.role !== "master" || isOwner;
            const send = emailStates[invite.id];
            const sentCount = invite.email_sent_count ?? 0;
            return (
              <li className={styles.member} key={invite.id}>
                <div className={styles.memberInfo}>
                  <strong>{invite.email ?? "Convite por código"} · {roleLabels[invite.role]}</strong>
                  <small><code>{formatInviteCode(invite.code)}</code> · expira em {dateFormat.format(new Date(invite.expires_at))}
                    {invite.email && sentCount > 0 && invite.last_email_sent_at
                      ? ` · e-mail enviado ${sentCount}/5, último em ${dateTimeFormat.format(new Date(invite.last_email_sent_at))}`
                      : null}</small>
                  {send?.error ? <small className={styles.error} role="alert">{send.error}</small> : null}
                  {send?.message ? <small className={styles.message} role="status">{send.message}</small> : null}
                </div>
                {manageable ? (
                  <div className={styles.memberActions}>
                    {invite.email ? (
                      <button type="button" className={styles.secondaryButton} disabled={busy || send?.pending || sentCount >= 5}
                        onClick={() => void sendEmail(invite)}>
                        {send?.pending ? "Enviando…" : sentCount > 0 ? "Reenviar" : "Enviar por e-mail"}
                      </button>
                    ) : null}
                    <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => onRevoke(invite)}>Revogar</button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OwnerSection({ campaignId, details, onSaved }: { campaignId: string; details: { name: string; description: string }; onSaved: () => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [saveState, saveAction, saving] = useActionState(async (previous: AdminActionState, formData: FormData) => {
    const result = await updateCampaignDetails(previous, formData);
    if (!result.error) await onSaved();
    return result;
  }, emptyState);
  const [deleteState, deleteAction, deleting] = useActionState(deleteCampaign, emptyState);

  return (
    <>
      <div className={styles.block}>
        <h3>Dados da campanha</h3>
        <form action={saveAction} className={styles.fields} key={`${details.name}\u0000${details.description}`}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <label>Nome
            <input name="name" required minLength={3} maxLength={120} defaultValue={details.name} />
          </label>
          <label className={styles.wideField}>Descrição
            <textarea name="description" rows={3} maxLength={2000} defaultValue={details.description} />
          </label>
          <div className={styles.actions}><button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar dados"}</button></div>
        </form>
        <p className={saveState.error ? styles.error : styles.message} role="status">{saveState.error ?? saveState.message ?? ""}</p>
      </div>

      <div className={`${styles.block} ${styles.danger}`}>
        <h3>Excluir campanha</h3>
        <p className={styles.note}>A exclusão apaga fichas, modelos, diário, mapas, convites e todo o conteúdo da campanha. Não há como desfazer.</p>
        <form action={deleteAction} className={styles.fields}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <label className={styles.wideField}>Digite <b>{details.name}</b> para confirmar
            <input name="confirmName" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} />
          </label>
          <div className={styles.actions}>
            <button className={styles.dangerButton} type="submit" disabled={deleting || !deletionConfirmed(details.name, typed)}>
              {deleting ? "Excluindo…" : "Excluir definitivamente"}
            </button>
          </div>
        </form>
        {deleteState.error ? <p className={styles.error} role="alert">{deleteState.error}</p> : null}
      </div>
    </>
  );
}
