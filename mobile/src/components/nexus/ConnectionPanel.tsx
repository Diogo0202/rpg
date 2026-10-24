import { useEffect, useState, type FormEvent } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Cloud, LogIn, LogOut, RefreshCw } from "lucide-react";
import { useNexus } from "@/lib/nexus/store";
import { getSupabaseConfigProblem } from "@/lib/nexus/auth";
import { Btn, Panel } from "./ui";

export function ConnectionPanel() {
  const {
    mode, accountId, campaignId, campaignName, user, campaigns, connectionMessage, connectionConfigured,
    signIn, signOut, refreshCampaigns, connectCampaign, syncNow, setLocalMode, state, engine,
  } = useNexus();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState("");
  const [available, setAvailable] = useState(campaigns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const pendingCount = state?.outbox.length ?? 0;

  useEffect(() => { setAvailable(campaigns); }, [campaigns]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "A operação não foi concluída."); }
    finally { setBusy(false); }
  };

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await run(async () => { await signIn(email, password); setPassword(""); });
  };

  const exportDrafts = async () => run(async () => {
    if (!engine) throw new Error("O armazenamento ainda está abrindo.");
    const payload = await engine.exportPendingDrafts();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `rpg-nexus-rascunhos-${campaignId}.json`; anchor.click();
    URL.revokeObjectURL(url);
  });

  const signOutConfirmed = () => {
    setConfirmSignOut(false);
    void run(signOut);
  };

  const loadCampaigns = async () => run(async () => {
    const rows = await refreshCampaigns();
    setAvailable(rows); setSelected(rows[0]?.id ?? "");
  });

  return <AlertDialog.Root open={confirmSignOut} onOpenChange={setConfirmSignOut}>
    <Panel title="Conta e campanha" actions={<span className="rounded-full bg-secondary px-2 py-1 text-xs font-semibold text-secondary-foreground">{mode === "connected" ? "Campanha selecionada" : "Modo local"}</span>}>
    {mode === "connected" ? <div className="space-y-3">
      <p className="text-sm text-ink">Campanha: <strong>{campaignName}</strong></p>
      <p className="break-all text-xs text-ink-muted">Conta {accountId} · {campaignId}</p>
      <p className="text-sm text-ink-muted">{connectionMessage || "Dados de campanha isolados por conta, campanha e aparelho."}</p>
      <div className="flex flex-wrap gap-2">
        <Btn type="button" onClick={() => void run(syncNow)} disabled={busy}><RefreshCw className="size-4" aria-hidden />{busy ? "Sincronizando…" : "Sincronizar agora"}</Btn>
        {pendingCount > 0 && <Btn type="button" variant="outline" onClick={() => void exportDrafts()} disabled={busy}>Exportar {pendingCount} pendente(s)</Btn>}
        <Btn type="button" variant="outline" disabled={busy} onClick={() => void run(setLocalMode)}><Cloud className="size-4" aria-hidden />Voltar ao modo local</Btn>
        <AlertDialog.Trigger asChild><Btn type="button" variant="ghost" disabled={busy}><LogOut className="size-4" aria-hidden />Sair</Btn></AlertDialog.Trigger>
      </div>
    </div> : !user ? <form className="space-y-3" onSubmit={submitLogin}>
      <p className="text-sm text-ink-muted">Entre com uma conta já existente. Esta tela não cria contas.</p>
      <label className="block text-sm font-semibold text-ink">E-mail<input className="field-input mt-1" type="email" autoComplete="username" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="block text-sm font-semibold text-ink">Senha<input className="field-input mt-1" type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {!connectionConfigured && <p className="text-sm text-warning-foreground">{getSupabaseConfigProblem() ?? "Configure a API Nexus e o Supabase Auth para entrar."}</p>}
      <Btn type="submit" disabled={busy || !connectionConfigured}><LogIn className="size-4" aria-hidden />{busy ? "Entrando…" : "Entrar"}</Btn>
    </form> : <div className="space-y-3">
      <p className="text-sm text-ink">Conta: <strong>{user.email ?? user.id}</strong></p>
      <p className="text-sm text-ink-muted">A prévia demonstrativa continua separada. Escolha uma campanha para abrir seu cache local dessa conta.</p>
      <div className="flex flex-wrap gap-2">
        <Btn type="button" variant="outline" onClick={() => void loadCampaigns()} disabled={busy || !connectionConfigured}><RefreshCw className="size-4" aria-hidden />Carregar campanhas</Btn>
        <AlertDialog.Trigger asChild><Btn type="button" variant="ghost" disabled={busy}><LogOut className="size-4" aria-hidden />Sair</Btn></AlertDialog.Trigger>
      </div>
      {available.length > 0 && <div className="space-y-2">
        <label className="block text-sm font-semibold text-ink">Campanha<select className="field-input mt-1" value={selected || campaignId} onChange={(event) => setSelected(event.target.value)}>
          {available.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
        </select></label>
        <Btn type="button" onClick={() => void run(() => connectCampaign(selected || available[0]!.id))} disabled={busy}><Cloud className="size-4" aria-hidden />Abrir campanha</Btn>
      </div>}
      {connectionMessage && <p role="status" className="text-sm text-ink-muted">{connectionMessage}</p>}
    </div>}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
    </Panel>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl focus:outline-none">
          <AlertDialog.Title className="text-lg font-semibold">Sair e apagar os dados locais?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-ink-muted">
            Esta ação remove todas as cópias locais desta conta, incluindo todas as campanhas e operações pendentes. O contador desta tela cobre apenas a campanha aberta. Exporte antes os rascunhos de cada campanha que deseja preservar.
          </AlertDialog.Description>
          {pendingCount > 0 && <p className="mt-2 text-sm font-semibold">Campanha aberta: {pendingCount} operação(ões) pendentes.</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild><Btn type="button" variant="outline" disabled={busy}>Cancelar</Btn></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Btn type="button" variant="danger" disabled={busy} onClick={signOutConfirmed}>Sair e apagar cópias locais</Btn></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
  </AlertDialog.Root>;
}
