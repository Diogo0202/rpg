"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OneRingCompanyPanel } from "../../../components/one-ring-company-panel";
import { OneRingCharacterBuilder } from "../../../components/one-ring-character-builder";
import { createClient } from "../../../lib/supabase/client";
import { CompanyOfflineStore, getOfflineContext, type CompanyOfflineContext } from "../../../lib/one-ring-offline";

function OfflineContent() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") ?? "";
  const [context, setContext] = useState<CompanyOfflineContext | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState("Abrindo dados preparados neste aparelho…");
  useEffect(() => {
    let active = true;
    setContext(null); setTemplates([]); setTemplateId("");
    void (async () => {
      const account = localStorage.getItem("one-ring-company-active-account");
      const device = account && localStorage.getItem(`one-ring-company-device:${account}`);
      if (!account || !device || !campaignId) throw new Error("Abra o modo offline pela campanha autenticada para preparar este aparelho.");
      if(navigator.onLine){const {data}=await createClient().auth.getSession();if(data.session?.user.id!==account)throw new Error("Entre na conta que preparou este aparelho.");}
      const store = new CompanyOfflineStore();
      const saved = await getOfflineContext(account, campaignId, device, store);
      if (!saved) throw new Error("Entre na conta que preparou esta campanha para abrir os dados locais.");
      const state = await store.read({ accountId: account, campaignId, deviceId: device });
      if (active) { setContext(saved); setTemplates(state.approved_templates ?? []); setTemplateId(state.approved_templates?.[0]?.id ?? ""); setMessage(""); }
    })().catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Dados locais indisponíveis."); });
    return () => { active = false; };
  }, [campaignId]);
  return <main style={{ maxWidth: 860, margin: "0 auto", padding: "1rem" }}>
    <h1>O Um Anel offline</h1>
    {message && <p role="status">{message}</p>}
    {context && <>
      <OneRingCompanyPanel campaignId={campaignId} viewerId={context.viewerId} canManage={false} offlineOnly />
      <section aria-label="Rascunho de aventureiro" style={{ marginTop: "2rem" }}>
        <h2>Rascunho de aventureiro</h2>
        <p>O rascunho fica neste aparelho. A ativação exige conexão e validação do modelo aprovado no servidor. Abra a criação de ficha na campanha ao reconectar.</p>
        {templates.length > 1 && <label>Modelo<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>}
        {templateId ? <OneRingCharacterBuilder key={templateId} accountId={context.accountId} campaignId={campaignId} templateId={templateId} title="Rascunho local" canSave={false} onSave={() => { throw new Error("A ativação exige conexão e validação no servidor."); }} /> : <p>Prepare o modo offline com internet para guardar um modelo aprovado.</p>}
      </section>
    </>}
  </main>;
}
export default function OneRingOfflinePage() { return <Suspense fallback={<p>Carregando modo offline…</p>}><OfflineContent /></Suspense>; }
