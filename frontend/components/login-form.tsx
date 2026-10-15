"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "../lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function sendLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
        },
      });
      if (error) throw error;
      setMessage("Se o e-mail tiver convite ativo, o link chegará em instantes.");
    } catch {
      setMessage("Não foi possível enviar o link. Confira os dados e tente de novo.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={sendLink}>
      <label htmlFor="email">E-mail do convite</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
      <button className="primary" type="submit" disabled={sending}>{sending ? "Enviando link…" : "Enviar link de acesso"}</button>
      {message && <p className="auth-message" role="status">{message}</p>}
    </form>
  );
}
