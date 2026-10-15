"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { createClient } from "../lib/supabase/client";
import styles from "./chronicle-diagnostic-panel.module.css";

type Trait = { id: string; name: string; category: "attribute" | "skill" };
type Goal = { id: string; statement: string; target_id: string; target_label: string; polarity: "pursues" | "prevents" };
type Note = { id: string; text: string };
type Supporter = { id: string; name: string };
type Character = {
  id: string; name: string; template_name: string; traits: Trait[];
  ambitions: Goal[]; desires: Goal[]; supporters: Supporter[]; defects: Note[];
  legacy_text_fields: { id: string; populated: boolean }[];
  unclassified_numeric_field_ids: string[];
};
type Evidence = { record_id: string; occurred_on: string };
type Snapshot = {
  report: {
    as_of: string;
    supporters_without_recent_threat: { character_id: string; supporter_id: string; supporter_name: string; status: string; last_threat: Evidence | null }[];
    conflicting_goals: { target_id: string; target_label: string; first_character_id: string; first_goal_statement: string; first_goal_type: string; second_character_id: string; second_goal_statement: string; second_goal_type: string }[];
    underused_traits: { category: string; trait_name: string; character_ids: string[]; observed_uses: number; total_trait_mentions: number; usage_share: number; evidence: Evidence[] }[];
    activity_record_count: number; reviewed_activity: Evidence[]; notes: string[];
  };
  characters: Character[];
  activity_records: { id: string; occurred_on: string; character_id: string; character_name: string; used_trait_ids: string[]; used_goal_ids: string[]; used_defect_ids: string[]; threatened_supporter_ids: string[] }[];
  limits: { characters_max: number; activities_max: number; character_count: number; activity_count: number; truncated: boolean };
};

const apiBase = process.env.NEXT_PUBLIC_API_URL;

export function ChronicleDiagnosticPanel({ campaignId, canManage }: { campaignId: string; canManage: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const requestVersion = useRef(0);
  const latestCampaign = useRef(campaignId);
  latestCampaign.current = campaignId;
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [usedTraits, setUsedTraits] = useState<string[]>([]);
  const [usedGoals, setUsedGoals] = useState<string[]>([]);
  const [usedDefects, setUsedDefects] = useState<string[]>([]);
  const [threatenedSupporters, setThreatenedSupporters] = useState<string[]>([]);
  const [goalType, setGoalType] = useState<"ambition" | "desire">("ambition");
  const [goalStatement, setGoalStatement] = useState("");
  const [targetId, setTargetId] = useState("");
  const [targetLabel, setTargetLabel] = useState("");
  const [polarity, setPolarity] = useState<"pursues" | "prevents">("pursues");
  const [supporterName, setSupporterName] = useState("");
  const [defectStatement, setDefectStatement] = useState("");

  const selected = snapshot?.characters.find((character) => character.id === selectedId) ?? snapshot?.characters[0];
  const nameById = useMemo(() => new Map((snapshot?.characters ?? []).map((character) => [character.id, character.name])), [snapshot]);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    const requestedCampaign = campaignId;
    if (!apiBase || !canManage) return;
    const { data, error } = await createClient().auth.getSession();
    if (error || !data.session) throw new Error("Entre com uma conta de narrador para abrir o diagnóstico.");
    const response = await fetch(`${apiBase}/api/v1/campaigns/${campaignId}/chronicle`, {
      headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store",
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: string } | null;
      throw new Error(payload?.detail ?? "Não foi possível consultar o diagnóstico desta campanha.");
    }
    const result = await response.json() as Snapshot;
    if (version !== requestVersion.current || requestedCampaign !== latestCampaign.current) return;
    setSnapshot(result);
    setSelectedId((current) => result.characters.some((character) => character.id === current) ? current : result.characters[0]?.id ?? "");
  }, [campaignId, canManage]);

  useEffect(() => {
    setSnapshot(null);
    setSelectedId("");
    setMessage("");
    setBusy(false);
    setUsedTraits([]); setUsedGoals([]); setUsedDefects([]); setThreatenedSupporters([]);
    setGoalStatement(""); setTargetId(""); setTargetLabel("");
    setSupporterName(""); setDefectStatement("");
    let active = true;
    void load().then(() => { if (active) setMessage(""); }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Falha ao carregar o diagnostico."); });
    return () => { active = false; requestVersion.current += 1; };
  }, [load]);

  async function post(path: string, payload: unknown, success: string) {
    if (!apiBase) throw new Error("Configure NEXT_PUBLIC_API_URL para conectar à API.");
    const { data, error } = await createClient().auth.getSession();
    if (error || !data.session) throw new Error("Entre na sua conta para registrar atividade.");
    const response = await fetch(`${apiBase}/api/v1/campaigns/${campaignId}/chronicle${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { detail?: string } | null;
      throw new Error(result?.detail ?? "A API recusou o registro.");
    }
    if (campaignId !== latestCampaign.current) throw new DOMException("Campanha alterada", "AbortError");
    await load();
    if (campaignId !== latestCampaign.current) throw new DOMException("Campanha alterada", "AbortError");
    if (campaignId === latestCampaign.current) setMessage(success);
  }

  async function submit(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault();
    if (busy) return;
    const requestedCampaign = campaignId;
    setBusy(true); setMessage("");
    try { await action(); }
    catch (error) { if (requestedCampaign === latestCampaign.current) setMessage(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { if (requestedCampaign === latestCampaign.current) setBusy(false); }
  }

  function flip(setter: (next: string[]) => void, values: string[], id: string, checked: boolean) {
    setter(checked ? [...values, id] : values.filter((value) => value !== id));
  }

  const goals = selected ? [...selected.ambitions, ...selected.desires] : [];
  const allNarrativeRefs = [...goals.map((goal) => ({ id: goal.id, label: goal.statement })), ...(selected?.defects ?? []).map((defect) => ({ id: defect.id, label: defect.text }))];

  if (!canManage) return <section className={styles.panel} aria-label="Diagnóstico da crônica"><p className={styles.notice}>Este relatório e seus registros ficam disponíveis somente para quem narra a campanha.</p></section>;

  return <section className={styles.panel} aria-labelledby="chronicle-diagnostic-title" aria-busy={busy}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>MESA DO NARRADOR</p><h2 id="chronicle-diagnostic-title">Diagnóstico da crônica</h2><p>Leitura por evidências estruturadas, sem interpretação de texto livre.</p></div>
      <button type="button" className={styles.button} disabled={busy} onClick={() => { const requestedCampaign = campaignId; setBusy(true); void load().then(() => { if (requestedCampaign === latestCampaign.current) setMessage("Dados atualizados."); }).catch((error) => { if (requestedCampaign === latestCampaign.current) setMessage(error instanceof Error ? error.message : "Falha ao atualizar."); }).finally(() => { if (requestedCampaign === latestCampaign.current) setBusy(false); }); }}>Atualizar</button>
    </header>
    {message && <p className={styles.notice} role="status">{message}</p>}
    {!apiBase && <p className={styles.notice}>Configure NEXT_PUBLIC_API_URL para abrir o diagnóstico.</p>}
    {snapshot && <>
      <p className={styles.scope}>Analisadas {snapshot.limits.character_count}/{snapshot.limits.characters_max} fichas e {snapshot.limits.activity_count}/{snapshot.limits.activities_max} atividades. Nenhum registro foi truncado.</p>
      <div className={styles.summaryGrid}>
        <article><span>Apoiadores sem ameaça recente</span><strong>{snapshot.report.supporters_without_recent_threat.length}</strong></article>
        <article><span>Metas em conflito explícito</span><strong>{snapshot.report.conflicting_goals.length}</strong></article>
        <article><span>Atributos e habilidades pouco usados</span><strong>{snapshot.report.underused_traits.length}</strong></article>
      </div>
      {snapshot.report.notes.map((note, index) => <p className={styles.notice} key={`${index}-${note}`}>{note}</p>)}
      <div className={styles.reportGrid}>
        <article className={styles.reportCard}><h3>Apoiadores</h3>{snapshot.report.supporters_without_recent_threat.length ? snapshot.report.supporters_without_recent_threat.map((item) => <p key={`${item.character_id}-${item.supporter_id}`}><b>{nameById.get(item.character_id) ?? "Ficha"}</b>, {item.supporter_name}: {item.status === "never_threatened" ? "sem ameaça registrada" : `última ameaça em ${item.last_threat?.occurred_on ?? "data ausente"}`}</p>) : <p>Nenhum apoiador estruturado precisa de atenção.</p>}</article>
        <article className={styles.reportCard}><h3>Uso de traços</h3>{snapshot.report.underused_traits.length ? snapshot.report.underused_traits.map((item) => <p key={`${item.category}-${item.trait_name}`}>{item.category === "attribute" ? "Atributo" : "Habilidade"} <b>{item.trait_name}</b>, {item.observed_uses}/{item.total_trait_mentions} menções. {item.evidence.map((evidence) => `${evidence.occurred_on} · ${evidence.record_id}`).join("; ")}</p>) : <p>Sem achados com o histórico e o limite configurados.</p>}</article>
        <article className={styles.reportCard}><h3>Metas opostas</h3>{snapshot.report.conflicting_goals.length ? snapshot.report.conflicting_goals.map((item) => <p key={`${item.target_id}-${item.first_character_id}-${item.second_character_id}`}><b>{item.target_label}</b>, {nameById.get(item.first_character_id)} ({item.first_goal_type}: {item.first_goal_statement}) contra {nameById.get(item.second_character_id)} ({item.second_goal_type}: {item.second_goal_statement}).</p>) : <p>Nenhuma oposição estruturada com alvo e polaridades contrárias.</p>}</article>
      </div>
      <details className={styles.evidence}><summary>Atividades revisadas ({snapshot.report.activity_record_count})</summary>{snapshot.activity_records.map((entry) => <p key={entry.id}>{entry.occurred_on} · {entry.character_name} · registro {entry.id}<br /><small>Traços: {entry.used_trait_ids.join(", ") || "nenhum"}. Metas: {entry.used_goal_ids.join(", ") || "nenhuma"}. Complicações: {entry.used_defect_ids.join(", ") || "nenhuma"}. Apoiadores ameaçados: {entry.threatened_supporter_ids.join(", ") || "nenhum"}.</small></p>)}</details>

      <div className={styles.workspace}>
        <article className={styles.formCard}>
          <h3>Estruturar dados narrativos</h3>
          <label>Ficha<select value={selected?.id ?? ""} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); setUsedTraits([]); setUsedGoals([]); setUsedDefects([]); setThreatenedSupporters([]); }}><option value="">Selecione</option>{snapshot.characters.map((character) => <option key={character.id} value={character.id}>{character.name} · {character.template_name}</option>)}</select></label>
          {selected?.legacy_text_fields.length ? <p className={styles.notice}>A ficha tem campos de texto legado: {selected.legacy_text_fields.map((field) => field.id).join(", ")}. O relatório não interpreta o conteúdo; cadastre abaixo as entradas que deseja acompanhar.</p> : null}
          {selected?.unclassified_numeric_field_ids.length ? <p className={styles.notice}>Campos numéricos sem categoria conhecida: {selected.unclassified_numeric_field_ids.join(", ")}.</p> : null}
          <form onSubmit={(event) => void submit(event, async () => {
            if (!selected || !goalStatement.trim() || !targetId.trim() || !targetLabel.trim()) throw new Error("Preencha a meta e o alvo.");
            await post(`/characters/${selected.id}/goals`, { goal_type: goalType, statement: goalStatement.trim(), target_id: targetId.trim(), target_label: targetLabel.trim(), polarity }, "Meta estruturada salva.");
            setGoalStatement("");
          })}>
            <div className={styles.twoColumns}><label>Tipo<select value={goalType} disabled={busy} onChange={(event) => setGoalType(event.target.value as "ambition" | "desire")}><option value="ambition">Ambição</option><option value="desire">Desejo</option></select></label><label>Polaridade<select value={polarity} disabled={busy} onChange={(event) => setPolarity(event.target.value as "pursues" | "prevents")}><option value="pursues">Busca o alvo</option><option value="prevents">Impede o alvo</option></select></label></div>
            <label>Objetivo<input disabled={busy} maxLength={500} value={goalStatement} onChange={(event) => setGoalStatement(event.target.value)} required /></label>
            <div className={styles.twoColumns}><label>ID estável do alvo<input disabled={busy} maxLength={80} value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="ex.: relicquia-da-familia" required /></label><label>Nome do alvo<input disabled={busy} maxLength={120} value={targetLabel} onChange={(event) => setTargetLabel(event.target.value)} required /></label></div>
            <button className={styles.button} disabled={busy || !selected}>Salvar meta</button>
          </form>
          <form onSubmit={(event) => void submit(event, async () => { if (!selected || !supporterName.trim()) throw new Error("Informe o nome do apoiador."); await post(`/characters/${selected.id}/supporters`, { name: supporterName.trim() }, "Apoiador estruturado salvo."); setSupporterName(""); })}>
            <label>Nome de apoiador<input disabled={busy} maxLength={120} value={supporterName} onChange={(event) => setSupporterName(event.target.value)} required /></label><button className={styles.button} disabled={busy || !selected}>Adicionar apoiador</button>
          </form>
          <form onSubmit={(event) => void submit(event, async () => { if (!selected || !defectStatement.trim()) throw new Error("Descreva a complicação."); await post(`/characters/${selected.id}/defects`, { statement: defectStatement.trim() }, "Complicação estruturada salva."); setDefectStatement(""); })}>
            <label>Complicação observável<input disabled={busy} maxLength={500} value={defectStatement} onChange={(event) => setDefectStatement(event.target.value)} required /></label><button className={styles.button} disabled={busy || !selected}>Adicionar complicação</button>
          </form>
        </article>

        <article className={styles.formCard}>
          <h3>Registrar atividade da sessão</h3>
          <form onSubmit={(event) => void submit(event, async () => {
            if (!selected) throw new Error("Selecione uma ficha.");
            await post("/activity", {
              occurred_on: occurredOn, character_id: selected.id,
              used_trait_ids: usedTraits, used_ambition_ids: usedGoals.filter((id) => selected.ambitions.some((goal) => goal.id === id)),
              used_desire_ids: usedGoals.filter((id) => selected.desires.some((goal) => goal.id === id)),
              used_defect_ids: usedDefects, threatened_supporter_ids: threatenedSupporters,
            }, "Atividade registrada com referências e data.");
            setUsedTraits([]); setUsedGoals([]); setUsedDefects([]); setThreatenedSupporters([]);
          })}>
            <label>Personagem<select value={selected?.id ?? ""} disabled={busy} onChange={(event) => { setSelectedId(event.target.value); setUsedTraits([]); setUsedGoals([]); setUsedDefects([]); setThreatenedSupporters([]); }}><option value="">Selecione</option>{snapshot.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
            <label>Data da atividade<input type="date" disabled={busy} value={occurredOn} onChange={(event) => setOccurredOn(event.target.value)} required /></label>
            <fieldset><legend>Atributos e habilidades utilizados</legend>{selected?.traits.map((trait) => <label className={styles.check} key={trait.id}><input type="checkbox" disabled={busy} checked={usedTraits.includes(trait.id)} onChange={(event) => flip(setUsedTraits, usedTraits, trait.id, event.target.checked)} />{trait.name} <small>{trait.category === "attribute" ? "atributo" : "habilidade"} · {trait.id}</small></label>)}</fieldset>
            <fieldset><legend>Metas e complicações relacionadas</legend>{allNarrativeRefs.length ? allNarrativeRefs.map((item) => <label className={styles.check} key={item.id}><input type="checkbox" disabled={busy} checked={usedGoals.includes(item.id) || usedDefects.includes(item.id)} onChange={(event) => {
              if (goals.some((goal) => goal.id === item.id)) flip(setUsedGoals, usedGoals, item.id, event.target.checked);
              else flip(setUsedDefects, usedDefects, item.id, event.target.checked);
            }} />{item.label}</label>) : <p>Cadastre metas e complicações estruturadas para registrar referências.</p>}</fieldset>
            <fieldset><legend>Apoiadores ameaçados</legend>{selected?.supporters.length ? selected.supporters.map((supporter) => <label className={styles.check} key={supporter.id}><input type="checkbox" disabled={busy} checked={threatenedSupporters.includes(supporter.id)} onChange={(event) => flip(setThreatenedSupporters, threatenedSupporters, supporter.id, event.target.checked)} />{supporter.name}</label>) : <p>Cadastre apoiadores para acompanhar ameaças no relatório.</p>}</fieldset>
            <button className={styles.button} disabled={busy || !selected}>Salvar atividade</button>
          </form>
        </article>
      </div>
    </>}
  </section>;
}
