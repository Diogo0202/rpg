import type { Metadata } from "next";
import { LoginForm } from "../../components/login-form";
import { isSupabaseConfigured } from "../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Entrar | RPG-Atlas",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  const configured = isSupabaseConfigured();
  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">RPG-ATLAS / ACESSO PRIVADO</p>
        <h1>Entre na sua crônica.</h1>
        <p className="auth-copy">Informe o e-mail que recebeu o convite. Enviaremos um link de acesso.</p>
        {configured ? <LoginForm /> : <p className="auth-message" role="status">Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para ativar o acesso.</p>}
        <a className="created-by" href="https://deerflow.tech" target="_blank" rel="noreferrer">Created By Deerflow</a>
      </section>
    </main>
  );
}
