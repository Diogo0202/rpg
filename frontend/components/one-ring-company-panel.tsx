"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { apiBase } from "../lib/api/session";
import { CompanyOfflineStore, CompanySyncEngine, createCompanyHttpTransport, getOfflineContext, saveOfflineContext, clearOfflineAccount } from "../lib/one-ring-offline";
import type { CompanyMember, CompanySnapshot } from "../../shared/one-ring/company-sync";
import { ONE_RING_CATALOG as C } from "../../shared/one-ring/catalog.ts";
import styles from "./one-ring-company-panel.module.css";

type Candidate = { id: string; name: string; owner_id: string };
type Props = { campaignId: string; viewerId: string; canManage: boolean; viewerRole?: "narrator" | "player" | "guest"; offlineOnly?: boolean };
const EMPTY: CompanySnapshot = { company: null, members: [], focuses: [], events: [] };

export function OneRingCompanyPanel({ campaignId, viewerId, canManage, viewerRole, offlineOnly = false }: Props) {
  const [snapshot, setSnapshot] = useState<CompanySnapshot | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? false : navigator.onLine);
  const [message, setMessage] = useState("");
  const [pendingDetail,setPendingDetail]=useState("");
  const [conflictState,setConflictState]=useState("");
  const [conflictId, setConflictId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [formName, setFormName] = useState("");
  const [patron, setPatron] = useState<string|null>(null);
  const [havens, setHavens] = useState<string|null>(null);
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState(1);
  const [reason, setReason] = useState("");
  const [resetSessionId, setResetSessionId] = useState("");
  const [endedSessions, setEndedSessions] = useState<{ id: string; sequence: number; title: string }[]>([]);
  const [engine, setEngine] = useState<CompanySyncEngine | null>(null);
  const [accountId, setAccountId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [activeRole, setActiveRole] = useState<"narrator" | "player" | "guest">(viewerRole ?? (canManage ? "narrator" : "player"));
  const canManageEffective = offlineOnly ? activeRole === "narrator" : canManage;

  const load = useCallback(async (eng: CompanySyncEngine) => {
    const state = await eng.state();
    setCandidates(state.candidates ?? []); setEndedSessions(state.ended_sessions ?? []);
    setSnapshot(state.snapshot ? (await eng.snapshot()) ?? state.snapshot : null);
    setQueueCount(state.queue.length);
    const paused = state.queue.find((item) => item.state === "conflict" || item.state === "invalid");
    setConflictId(paused?.command.operation_id ?? null);setConflictState(paused?.state??"");setPendingDetail(paused ? `${paused.command.kind}, versão esperada ${paused.command.expected_version}: ${JSON.stringify(paused.command.payload)}. ${paused.reason??""}` : "");
  }, []);

  useEffect(() => {
    const on = () => setOnline(navigator.onLine); window.addEventListener("online", on); window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    setEngine(null); setSnapshot(null); setQueueCount(0);
    (async () => {
      try {
        const client = createClient(), { data } = await client.auth.getSession();
        const user = data.session?.user;
        const account = user?.id ?? (offlineOnly ? localStorage.getItem("one-ring-company-active-account") : null) ?? "";
        const campaign = campaignId;
        const actor = user?.id ?? "";
        if (!active) return;
        setAccountId(account);
        if (!account || !campaign) { setMessage("Entre na campanha para carregar a Companhia."); return; }
        const store = new CompanyOfflineStore();
        let device = localStorage.getItem(`one-ring-company-device:${account}`);
        if (!device) { device = crypto.randomUUID(); localStorage.setItem(`one-ring-company-device:${account}`, device); }
        if (offlineOnly) {
          const context = await getOfflineContext(account, campaign, device, store);
          if (!context) { setMessage("Entre na conta que preparou este modo offline para abrir os dados salvos."); return; }
          setSessionId(context.viewerId); setActiveRole(context.role);
        } else {
          if (!user || user.id !== account || user.id !== viewerId) { setMessage("A conta ativa não corresponde a este cache."); return; }
          setSessionId(actor); setActiveRole(viewerRole ?? (canManage ? "narrator" : "player"));
          await saveOfflineContext({ accountId: account, campaignId: campaign, viewerId: actor, role: viewerRole ?? (canManage ? "narrator" : "player"), deviceId: device }, store);
        }
        const transport = createCompanyHttpTransport(campaign, async () => { const session = (await createClient().auth.getSession()).data.session; return session?.user.id === account ? session.access_token : null; }, apiBase() ?? "");
        const eng = new CompanySyncEngine({ accountId: account, campaignId: campaign, deviceId: device }, store, transport);
        setEngine(eng); await load(eng);
        if (navigator.onLine && user) { try { await eng.flush(); await eng.refresh(); } catch(error) { if(active)setMessage(error instanceof Error ? error.message : "Falha ao confirmar o acesso."); } if(active)await load(eng); }
        const { data: listener } = client.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_OUT" || (session && session.user.id !== account)) { setEngine(null); setSnapshot(null); setQueueCount(0); setMessage("Sessão encerrada. Entre novamente para abrir a Companhia."); void clearOfflineAccount(account, store); } });
        unsubscribe = () => listener.subscription.unsubscribe();
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : "Não foi possível abrir os dados locais."); }
    })();
    return () => { active = false; unsubscribe?.(); };
  }, [campaignId, viewerId, canManage, viewerRole, offlineOnly, load]);

  useEffect(() => {
    if (!engine || offlineOnly || !canManageEffective || !online) return;
    let active = true;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: sessions } = await supabase.from("campaign_sessions").select("id,sequence,title,status").eq("campaign_id", campaignId).in("status", ["played"]).order("sequence", { ascending: false });
        if (active && sessions) { const ended=sessions.map((item) => ({ id: item.id, sequence: item.sequence, title: item.title })); setEndedSessions(ended);await new CompanyOfflineStore().write(engine.partition,(state)=>({...state,ended_sessions:ended})); }
        const { data, error } = await supabase.from("character_sheets").select("id,name,owner_id,template_id").eq("campaign_id", campaignId).order("name");
        if (error) throw error;
        const rows = data ?? [];
        if (rows.length) {
          const templateIds = [...new Set(rows.map((row) => row.template_id))];
          const { data: templates, error: templateError } = await supabase.from("system_templates").select("id,schema").in("id", templateIds);
          if (templateError) throw templateError;
          const eligible = new Set((templates ?? []).filter((row) => { const schema = row.schema as { system_key?: string } | null; return schema?.system_key === "one-ring"; }).map((row) => row.id));
          if (active) { const found=rows.filter((row) => eligible.has(row.template_id)).map((row) => ({ id: row.id, name: row.name, owner_id: row.owner_id }));setCandidates(found);await new CompanyOfflineStore().write(engine.partition,(state)=>({...state,candidates:found})); }
        }
      } catch { if (active) setMessage("A busca de fichas aprovadas não está disponível agora."); }
    })();
    return () => { active = false; };
  }, [engine, campaignId, canManageEffective, online, offlineOnly]);

  useEffect(() => {
    if (!engine || !online || offlineOnly) return;
    void engine.flush().then(()=>engine.refresh()).then(() => load(engine)).catch(() => load(engine));
  }, [engine, online, offlineOnly, load]);

  useEffect(()=>{
    if(!engine || offlineOnly || !online)return;
    const client=createClient();const channel=client.channel(`one-ring-company:${campaignId}`).on("postgres_changes",{event:"*",schema:"public",table:"one_ring_company_notifications",filter:`campaign_id=eq.${campaignId}`},()=>{void engine.flush().then(()=>engine.refresh()).then(()=>load(engine)).catch(()=>load(engine));}).subscribe();
    return ()=>{void client.removeChannel(channel);};
  },[engine,campaignId,offlineOnly,online,load]);

  const shown = useMemo(() => snapshot ? (snapshot.company ? snapshot : EMPTY) : null, [snapshot]);
  const availableTargets = shown?.members ?? [];
  const members = shown?.members ?? [];
  const defaultPatron=shown?.company?.patron_id ?? "none";
  const defaultHavens=shown?.company?.safe_havens.join(", ") ?? "";
  const offlineHref = `/offline/one-ring?campaignId=${encodeURIComponent(campaignId)}`;
  async function prepareOffline() {
    try {
      if (!("serviceWorker" in navigator)) throw new Error("Este navegador não oferece modo offline.");
      const registration = await navigator.serviceWorker.register("/one-ring-sw.js", { scope: "/offline/" });
      await new Promise<void>((resolve,reject)=>{ const worker=registration.installing; if(registration.active){resolve();return;} if(!worker){reject(new Error("Worker offline indisponível."));return;} worker.addEventListener("statechange",()=>{if(worker.state==="activated")resolve();if(worker.state==="redundant")reject(new Error("Falha ao preparar shell offline."));}); });
      const worker = registration.active ?? registration.waiting ?? registration.installing;
      worker?.postMessage({ type: "PREWARM_ONE_RING" });
      if (engine && online) {
        await engine.refresh(); await load(engine);
        const { data, error } = await createClient().from("system_templates").select("id,name").eq("campaign_id", campaignId).eq("status", "approved").eq("version",3).contains("schema", { system_key: "one-ring", rules_profile_version:3 });
        if (error) throw error;
        await new CompanyOfflineStore().write(engine.partition, (state) => ({ ...state, approved_templates: data ?? [] }));
      }
      setMessage("Modo offline preparado neste aparelho.");return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível preparar o modo offline.");return false; }
  }

  async function act(kind: Parameters<CompanySyncEngine["accept"]>[2], payload: Record<string, unknown>) {
    if (!engine) return;
    setPending(true); setMessage("");
    try { await engine.accept(activeRole, sessionId, kind, payload); await load(engine); if (online && !offlineOnly) { const result = await engine.flush(); await load(engine); if (result.reason) setMessage(result.reason); } }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operação não registrada."); }
    finally { setPending(false); }
  }

  async function resolve(reapply: boolean) {
    if (!engine || !conflictId) return;
    setPending(true);
    try { if (reapply) await engine.reapplyConflict(conflictId); else await engine.discard(conflictId); await load(engine); setMessage(reapply ? "Operação recriada sobre a versão atual. Sincronize para confirmar." : "Operação descartada."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível resolver o conflito."); }
    finally { setPending(false); }
  }

  async function closeSession() {
    try {
      if (!online || offlineOnly) { if (!endedSessions.some((s)=>s.id===resetSessionId)) throw new Error("Sessão encerrada não preparada neste aparelho."); await act("reset_session",{session_id:resetSessionId}); return; }
      const client = createClient();
      const { data, error } = await client.from("campaign_sessions").select("id,status").eq("campaign_id", campaignId).eq("id", resetSessionId).maybeSingle();
      if (error || !data || data.status!=="played") throw new Error("Escolha uma sessão jogada no Diário da campanha.");
      await act("reset_session", { session_id: data.id });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sessão encerrada não encontrada."); }
  }

  if (!shown) return <section className={styles.panel}><header><div><p className={styles.kicker}>COMPANHIA DE VIAGEM</p><h2>Companhia</h2></div><span className={online ? styles.live : styles.offline}>{online ? "Conectado" : "Offline"}</span></header><p>{message || "Carregando a projeção pública da Companhia…"}</p>{queueCount > 0 && <p>{queueCount} operação(ões) aguardam sincronização.</p>}</section>;

  return <section className={styles.panel} aria-labelledby="one-ring-company-title">
    <header><div><p className={styles.kicker}>O UM ANEL · COMPANHIA</p><h2 id="one-ring-company-title">{shown.company?.name ?? "Forme a Companhia"}</h2><p className={styles.sub}>{members.length} companheiro(s) · versão {shown.company?.version ?? 0}</p></div><span className={online ? styles.live : styles.offline}>{online ? "Conectado" : "Offline"}</span></header>
    {shown.company ? <>
      <div className={styles.stats}><div><span>Sociedade</span><strong>{shown.company.society_current} / {shown.company.society_max}</strong></div><div><span>Patrono</span><strong>{C.patrons.find((p)=>p.id===shown.company?.patron_id)?.name ?? "Sem patrono"}</strong></div></div>
      {shown.company.safe_havens.length > 0 && <p className={styles.havens}>Refúgios seguros: {shown.company.safe_havens.join(" · ")}</p>}
      <h3>Companheiros</h3>
      {members.length ? <ul className={styles.roster}>{members.map((member: CompanyMember) => <li key={member.sheet_id}><span>{member.name}</span>{canManageEffective && <button disabled={pending} onClick={() => void act("remove_member", { sheet_id: member.sheet_id })}>Remover</button>}<label>Foco<select aria-label={`Foco de ${member.name}`} value={shown.focuses.find((f) => f.source_sheet_id === member.sheet_id)?.target_sheet_id ?? ""} disabled={pending || activeRole === "guest" || !(canManageEffective || member.owner_id === sessionId)} onChange={(event) => void act("set_focus", { source_sheet_id: member.sheet_id, target_sheet_id: event.target.value || null })}><option value="">Sem foco</option>{availableTargets.filter((targetMember) => targetMember.sheet_id !== member.sheet_id).map((targetMember) => <option key={targetMember.sheet_id} value={targetMember.sheet_id}>{targetMember.name}</option>)}</select></label></li>)}</ul> : <p className={styles.empty}>Ainda não há fichas na Companhia.</p>}
      {canManageEffective && <div className={styles.controls}><label>Ficha aprovada<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Escolha uma ficha</option>{candidates.filter((candidate) => !members.some((member) => member.sheet_id === candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><button disabled={pending || !selected} onClick={() => { const picked = candidates.find((candidate) => candidate.id === selected); if (picked) void act("add_member", { sheet_id: picked.id }); }}>Adicionar ficha</button></div>}
      {canManageEffective && <div className={styles.controls}><label>Gastar/restaurar<input value={amount} type="number" min="1" max={shown.company.society_max} onChange={(event) => setAmount(Math.max(1, Number(event.target.value) || 1))}/></label><label>Motivo<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Motivo da mudança"/></label><button disabled={pending || !reason.trim()} onClick={() => void act("spend", { amount, reason: reason.trim() })}>Gastar</button><button disabled={pending || !reason.trim()} onClick={() => void act("restore", { amount, reason: reason.trim() })}>Restaurar</button></div>}
      {canManageEffective && <div className={styles.controls}><label>Sessão jogada<select value={resetSessionId} onChange={(event) => setResetSessionId(event.target.value)}><option value="">Selecione uma sessão</option>{endedSessions.map((session) => <option key={session.id} value={session.id}>#{session.sequence} · {session.title}</option>)}</select></label><button disabled={pending || !resetSessionId} onClick={() => void closeSession()}>Encerrar sessão da Companhia</button></div>}
      <details className={styles.configure}><summary>Editar nome, patrono e refúgios</summary><div className={styles.controls}><label>Nome<input value={formName || shown.company.name} onChange={(event) => setFormName(event.target.value)} maxLength={120}/></label><label>Patrono<select value={patron ?? defaultPatron} onChange={(event)=>setPatron(event.target.value)}>{C.patrons.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Refúgios, separados por vírgula<input value={havens ?? defaultHavens} onChange={(event) => setHavens(event.target.value)}/></label><button disabled={pending || !canManageEffective} onClick={() => void act("configure", { name: formName || shown.company!.name, patron_id: patron ?? defaultPatron, safe_havens: (havens ?? defaultHavens).split(",").map((value) => value.trim()).filter(Boolean) })}>Salvar</button></div></details>
    </> : canManageEffective ? <div className={styles.controls}><label>Nome da Companhia<input value={formName} maxLength={120} onChange={(event) => setFormName(event.target.value)} placeholder="Ex.: Companhia do Norte"/></label><label>Patrono<select value={patron ?? defaultPatron} onChange={(event)=>setPatron(event.target.value)}>{C.patrons.map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Refúgios seguros<input value={havens ?? ""} onChange={(event) => setHavens(event.target.value)} placeholder="Valfenda, Edoras"/></label><button disabled={pending || !formName.trim()} onClick={() => void act("create", { name: formName.trim(), patron_id: patron ?? defaultPatron, safe_havens: (havens ?? defaultHavens).split(",").map((value) => value.trim()).filter(Boolean) })}>Criar Companhia</button></div> : <p className={styles.empty}>O narrador ainda não criou uma Companhia.</p>}
    <footer><a href={offlineHref} onClick={(event) => { event.preventDefault(); void prepareOffline().then((ready) => { if(ready)location.href = offlineHref; }); }}>Abrir modo offline</a><span>{queueCount ? `${queueCount} operação(ões) pendentes` : "Tudo sincronizado"}</span>{online && queueCount > 0 && <button disabled={pending} onClick={() => void engine?.flush().then(() => load(engine))}>Sincronizar</button>}</footer>
    {conflictId && <div className={styles.conflict} role="alert"><strong>{conflictState==="invalid" ? "Há uma operação recusada." : "Há uma alteração em conflito."}</strong><p>{pendingDetail}</p><p>{conflictState==="invalid" ? "Descarte esta operação e corrija os dados antes de registrar outro comando." : "Compare o pedido com a Sociedade e a versão confirmadas acima. Reaplicar cria outro identificador; descartar remove o pedido local."}</p><button disabled={pending || conflictState!=="conflict"} onClick={() => void resolve(true)}>Reaplicar</button><button disabled={pending} onClick={() => void resolve(false)}>Descartar</button></div>}
    {message && <p className={styles.message} role="status">{message}</p>}
    {shown.events.length > 0 && <details className={styles.events}><summary>Histórico da Companhia</summary><ol>{shown.events.slice(0, 12).map((event) => <li key={event.id}>{event.kind}{event.amount ? ` · ${event.amount}` : ""}{event.reason ? ` · ${event.reason}` : ""}</li>)}</ol></details>}
  </section>;
}

export default OneRingCompanyPanel;
