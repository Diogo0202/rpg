"use client";

import { useActionState } from "react";

import { createCampaign, type CreateCampaignState } from "../app/app/actions";

const initialState: CreateCampaignState = { error: null };

export function CreateCampaignForm() {
  const [state, action, pending] = useActionState(createCampaign, initialState);
  return (
    <section className="hub-create" aria-labelledby="create-campaign-title">
      <p className="eyebrow">NOVA MESA</p>
      <h2 id="create-campaign-title">Crie uma campanha.</h2>
      <p>O espaço começa privado. Convites serão geridos pelo mestre.</p>
      <form action={action} className="auth-form">
        <label htmlFor="campaign-name">Nome da campanha</label>
        <input id="campaign-name" name="name" minLength={3} maxLength={120} required placeholder="Ex.: Crônicas de Cinza" />
        <label htmlFor="campaign-description">Descrição</label>
        <textarea id="campaign-description" name="description" maxLength={2000} rows={4} placeholder="Uma frase sobre a mesa" />
        {state.error ? <p className="hub-error" role="alert">{state.error}</p> : null}
        <button className="primary" type="submit" disabled={pending}>{pending ? "Criando…" : "Criar campanha"}</button>
      </form>
    </section>
  );
}
