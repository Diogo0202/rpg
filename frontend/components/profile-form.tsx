"use client";

import { useActionState } from "react";

import { updateProfile, type AdminActionState } from "../app/app/campaign-admin-actions";
import styles from "./campaign-members-panel.module.css";

const initialState: AdminActionState = { error: null, message: null };

export function ProfileForm({ displayName, email }: { displayName: string; email: string | null }) {
  const [state, action, pending] = useActionState(updateProfile, initialState);
  return (
    <section className={styles.panel} aria-labelledby="profile-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>CONTA / PERFIL</p>
        <h2 id="profile-title">Seu perfil</h2>
        <p className={styles.intro}>O nome de exibição aparece para os participantes das suas campanhas. O e-mail só é visível para donos e mestres.</p>
      </header>
      <form action={action} className={styles.fields} style={{ marginTop: "1rem" }}>
        <label className={styles.wideField}>Nome de exibição
          <input name="displayName" required minLength={2} maxLength={80} defaultValue={displayName} autoComplete="nickname" />
        </label>
        <label className={styles.wideField}>E-mail da conta
          <input value={email ?? ""} readOnly aria-readonly="true" />
          <small>O e-mail é gerido pelo login e não muda aqui.</small>
        </label>
        <div className={styles.actions}><button className={styles.primaryButton} type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar perfil"}</button></div>
      </form>
      <p className={state.error ? styles.error : styles.message} role="status">{state.error ?? state.message ?? ""}</p>
    </section>
  );
}
