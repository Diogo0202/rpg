"use client";

import { useActionState } from "react";

import { acceptCampaignInvite, declineCampaignInvite, type AdminActionState } from "../app/app/campaign-admin-actions";
import { roleLabels, type InviteRole } from "../lib/campaign-admin";
import styles from "./campaign-members-panel.module.css";

export type PendingInvite = { id: string; campaign_id: string; campaign_name: string; role: InviteRole; expires_at: string };

const initialState: AdminActionState = { error: null, message: null };
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });

export function CampaignInvitesInbox({ invites }: { invites: PendingInvite[] }) {
  const [acceptState, acceptAction, accepting] = useActionState(acceptCampaignInvite, initialState);
  const [declineState, declineAction, declining] = useActionState(declineCampaignInvite, initialState);
  const feedback = acceptState.error ?? declineState.error ?? declineState.message;

  return (
    <section className={styles.panel} aria-labelledby="invites-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>CONVITES</p>
        <h2 id="invites-title">Entrar em uma campanha</h2>
        <p className={styles.intro}>Aceite um convite enviado ao seu e-mail ou digite o código recebido do mestre.</p>
      </header>
      {invites.length > 0 ? (
        <ul className={styles.list} aria-label="Convites recebidos">
          {invites.map((invite) => (
            <li className={styles.member} key={invite.id}>
              <div className={styles.memberInfo}>
                <strong>{invite.campaign_name}</strong>
                <small>Como {roleLabels[invite.role].toLowerCase()} · expira em {dateFormat.format(new Date(invite.expires_at))}</small>
              </div>
              <div className={styles.memberActions}>
                <form action={acceptAction}><input type="hidden" name="inviteId" value={invite.id} />
                  <button className={styles.primaryButton} type="submit" disabled={accepting || declining}>Aceitar</button></form>
                <form action={declineAction}><input type="hidden" name="inviteId" value={invite.id} />
                  <button className={styles.secondaryButton} type="submit" disabled={accepting || declining}>Recusar</button></form>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className={styles.empty}>Nenhum convite pendente para o seu e-mail.</p>}
      <form action={acceptAction} className={styles.fields} style={{ marginTop: "1rem" }}>
        <label>Código do convite
          <input name="code" required autoComplete="off" spellCheck={false} maxLength={20} placeholder="ABCD-1234-EF56" />
        </label>
        <div><button className={styles.primaryButton} type="submit" disabled={accepting}>{accepting ? "Entrando…" : "Entrar com código"}</button></div>
      </form>
      <p className={acceptState.error || declineState.error ? styles.error : styles.message} role="status">{feedback ?? ""}</p>
    </section>
  );
}
