import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateCampaignForm } from "../../components/create-campaign-form";
import { createClient, isSupabaseConfigured } from "../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Minhas campanhas | RPG Nexus",
  robots: { index: false, follow: false },
};

export default async function CampaignPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">RPG NEXUS / CONFIGURAÇÃO</p>
          <h1>Conecte sua mesa.</h1>
          <p className="auth-copy">Configure o Supabase em frontend/.env.local para abrir a área privada.</p>
          <Link className="primary auth-link" href="/login">Ir para acesso</Link>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/login");

  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, name, description, owner_id, updated_at")
    .order("updated_at", { ascending: false });

  return (
    <main className="campaign-hub">
      <header className="hub-header">
        <Link className="brand hub-brand" href="/"><span>R</span><strong>RPG<br />NEXUS</strong></Link>
        <form action="/auth/signout" method="post"><button className="quiet" type="submit">Sair</button></form>
      </header>
      <div className="hub-intro">
        <p className="eyebrow">ÁREA PRIVADA / CAMPANHAS</p>
        <h1>Suas mesas começam aqui.</h1>
        <p>Abra uma campanha autorizada ou crie um espaço para sua próxima crônica.</p>
      </div>
      <div className="hub-layout">
        <section aria-labelledby="campaign-list-title">
          <div className="panel-title"><h2 id="campaign-list-title">Campanhas</h2><small>{campaigns?.length ?? 0} disponíveis</small></div>
          {error ? <p className="hub-error" role="alert">Não foi possível carregar as campanhas. Confira a conexão e as migrações do Supabase.</p> : null}
          {!error && campaigns?.length === 0 ? <p className="hub-empty">Nenhuma campanha nesta conta. Crie a primeira ao lado.</p> : null}
          <div className="campaign-list">
            {campaigns?.map((campaign) => (
              <Link className="campaign-card" key={campaign.id} href={`/app/campaign/${campaign.id}`}>
                <span className="eyebrow">{campaign.owner_id === userData.user.id ? "MESTRE" : "MEMBRO"}</span>
                <h3>{campaign.name}</h3>
                <p>{campaign.description || "Campanha privada"}</p>
                <span className="campaign-open">Abrir campanha →</span>
              </Link>
            ))}
          </div>
        </section>
        <CreateCampaignForm />
      </div>
    </main>
  );
}
