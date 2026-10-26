"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import styles from "./system-roll-panel.module.css";

/** ATL-04: Hunter cells persisted per campaign (migration 20261026190000). Members read; owner and masters edit. */
type Cell = { id: string; name: string; danger: number; desperation: number; notes: string; version: number };
type Member = { cell_id: string; sheet_id: string; role: string };
type Target = { id: string; cell_id: string; name: string; kind: "antagonista" | "alvo"; status: string; threat: number; notes: string };
type Bond = { id: string; cell_id: string; from_sheet_id: string; to_sheet_id: string | null; to_target_id: string | null; kind: string; description: string };
type Sheet = { id: string; name: string };

const STATUSES: Record<string, string> = { ativo: "Ativo", vigiado: "Vigiado", neutralizado: "Neutralizado", fugitivo: "Fugitivo" };
const BOND_KINDS: Record<string, string> = { confianca: "Confiança", divida: "Dívida", rivalidade: "Rivalidade", juramento: "Juramento", suspeita: "Suspeita", protecao: "Proteção" };

export function HunterCellsPanel({ campaignId, canManage }: { campaignId: string; canManage: boolean }) {
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const [cells, setCells] = useState<Cell[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newCell, setNewCell] = useState("");
  const [cellDraft, setCellDraft] = useState({ danger: 0, desperation: 0, notes: "" });
  const [memberDraft, setMemberDraft] = useState({ sheetId: "", role: "" });
  const [targetDraft, setTargetDraft] = useState({ name: "", kind: "antagonista" as Target["kind"], threat: 1, notes: "" });
  const [bondDraft, setBondDraft] = useState({ from: "", to: "", kind: "confianca", description: "" });

  useEffect(() => {
    const requestCampaign = campaignId;
    let active = true;
    async function load() {
      try {
        const client = createClient();
        const [cellResult, memberResult, targetResult, bondResult, sheetResult] = await Promise.all([
          client.from("hunter_cells").select("id,name,danger,desperation,notes,version").eq("campaign_id", requestCampaign).order("name"),
          client.from("hunter_cell_members").select("cell_id,sheet_id,role").eq("campaign_id", requestCampaign),
          client.from("hunter_cell_targets").select("id,cell_id,name,kind,status,threat,notes").eq("campaign_id", requestCampaign).order("threat", { ascending: false }),
          client.from("hunter_cell_bonds").select("id,cell_id,from_sheet_id,to_sheet_id,to_target_id,kind,description").eq("campaign_id", requestCampaign),
          client.from("party_status_public").select("id,name").eq("campaign_id", requestCampaign).order("name"),
        ]);
        if (!active || campaignRef.current !== requestCampaign) return;
        const failed = [cellResult, memberResult, targetResult, bondResult, sheetResult].find((result) => result.error);
        if (failed?.error) throw failed.error;
        setCells((cellResult.data ?? []) as Cell[]);
        setMembers((memberResult.data ?? []) as Member[]);
        setTargets((targetResult.data ?? []) as Target[]);
        setBonds((bondResult.data ?? []) as Bond[]);
        setSheets((sheetResult.data ?? []) as Sheet[]);
      } catch {
        if (active) setMessage("Não foi possível carregar as células de caçadores.");
      }
    }
    void load();
    return () => { active = false; };
  }, [campaignId, revision]);

  const cell = cells.find((item) => item.id === selectedId) ?? cells[0];
  useEffect(() => {
    if (cell) setCellDraft({ danger: cell.danger, desperation: cell.desperation, notes: cell.notes });
  }, [cell?.id, cell?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetName = (id: string | null) => sheets.find((sheet) => sheet.id === id)?.name ?? "Ficha sem acesso";
  const cellMembers = members.filter((member) => member.cell_id === cell?.id);
  const cellTargets = targets.filter((target) => target.cell_id === cell?.id);
  const cellBonds = bonds.filter((bond) => bond.cell_id === cell?.id);

  async function write(action: () => PromiseLike<{ error: unknown }>, done: string) {
    if (!canManage || busy) return;
    setBusy(true); setMessage("");
    try {
      const { error } = await action();
      if (error) throw error;
      setMessage(done);
      setRevision((value) => value + 1);
    } catch {
      setMessage("A gravação falhou. Confira os limites e se você é mestre da campanha.");
    } finally { setBusy(false); }
  }
  const table = (name: string) => createClient().from(name);

  function createCell(event: FormEvent) {
    event.preventDefault();
    const name = newCell.trim();
    if (name.length < 2 || name.length > 120) { setMessage("O nome da célula precisa ter de 2 a 120 caracteres."); return; }
    void write(() => table("hunter_cells").insert({ campaign_id: campaignId, name }), "Célula criada.").then(() => setNewCell(""));
  }
  function saveCell(event: FormEvent) {
    event.preventDefault();
    if (!cell) return;
    const { danger, desperation, notes } = cellDraft;
    if ([danger, desperation].some((value) => !Number.isInteger(value) || value < 0 || value > 5) || notes.length > 4000) { setMessage("Perigo e Desespero vão de 0 a 5; notas até 4000 caracteres."); return; }
    void write(() => table("hunter_cells").update({ danger, desperation, notes }).eq("id", cell.id).eq("version", cell.version), "Célula atualizada.");
  }
  function addMember(event: FormEvent) {
    event.preventDefault();
    if (!cell || !memberDraft.sheetId) return;
    void write(() => table("hunter_cell_members").insert({ cell_id: cell.id, campaign_id: campaignId, sheet_id: memberDraft.sheetId, role: memberDraft.role.trim().slice(0, 80) }), "Membro incluído.")
      .then(() => setMemberDraft({ sheetId: "", role: "" }));
  }
  function addTarget(event: FormEvent) {
    event.preventDefault();
    const name = targetDraft.name.trim();
    if (!cell || name.length < 2 || name.length > 120) { setMessage("O alvo precisa de um nome de 2 a 120 caracteres."); return; }
    void write(() => table("hunter_cell_targets").insert({ cell_id: cell.id, campaign_id: campaignId, name, kind: targetDraft.kind, threat: targetDraft.threat, notes: targetDraft.notes.slice(0, 2000) }), "Alvo registrado.")
      .then(() => setTargetDraft({ name: "", kind: "antagonista", threat: 1, notes: "" }));
  }
  function addBond(event: FormEvent) {
    event.preventDefault();
    if (!cell || !bondDraft.from || !bondDraft.to) return;
    const [kind, id] = bondDraft.to.split(":");
    if (kind === "sheet" && id === bondDraft.from) { setMessage("Um vínculo liga duas fichas diferentes."); return; }
    void write(() => table("hunter_cell_bonds").insert({
      cell_id: cell.id, campaign_id: campaignId, from_sheet_id: bondDraft.from, kind: bondDraft.kind, description: bondDraft.description.slice(0, 500),
      to_sheet_id: kind === "sheet" ? id : null, to_target_id: kind === "target" ? id : null,
    }), "Vínculo registrado.").then(() => setBondDraft({ from: "", to: "", kind: "confianca", description: "" }));
  }

  return <section className={`content ${styles.panel}`} aria-label="Células de caçadores">
    <header className={styles.header}><div><p className={styles.eyebrow}>CAÇADOR · CÉLULAS</p><h2>Células da campanha</h2></div><p>{canManage ? "Você edita as células como mestre." : "Leitura para os membros da campanha; o mestre edita."}</p></header>
    {message && <p className={styles.message} role="status">{message}</p>}
    <div className={styles.layout}>
      <article className={styles.card}>
        <h3>Células</h3>
        {cells.length ? <ul className={styles.cellList}>{cells.map((item) => <li key={item.id}><button type="button" aria-pressed={item.id === cell?.id} onClick={() => setSelectedId(item.id)}>{item.name} · Perigo {item.danger} · Desespero {item.desperation}</button></li>)}</ul> : <p>Nenhuma célula registrada.</p>}
        {canManage && <form className={styles.inline} onSubmit={createCell}><label>Nova célula<input value={newCell} maxLength={120} onChange={(event) => setNewCell(event.target.value)} /></label><button className={styles.rollButton} type="submit" disabled={busy}>Criar</button></form>}
      </article>
      {cell && <article className={styles.card}>
        <h3>{cell.name}</h3>
        {canManage ? <form onSubmit={saveCell}>
          <div className={styles.inline}>
            <label>Perigo<input type="number" min={0} max={5} value={cellDraft.danger} onChange={(event) => setCellDraft({ ...cellDraft, danger: Number(event.target.value) })} /></label>
            <label>Desespero<input type="number" min={0} max={5} value={cellDraft.desperation} onChange={(event) => setCellDraft({ ...cellDraft, desperation: Number(event.target.value) })} /></label>
          </div>
          <label>Notas<textarea maxLength={4000} value={cellDraft.notes} onChange={(event) => setCellDraft({ ...cellDraft, notes: event.target.value })} /></label>
          <button className={styles.rollButton} type="submit" disabled={busy}>Salvar célula</button>
        </form> : <p className={styles.poolLine}>Perigo <b>{cell.danger}</b> · Desespero <b>{cell.desperation}</b>{cell.notes ? ` · ${cell.notes}` : ""}</p>}

        <h3>Membros</h3>
        <ul className={styles.rows}>{cellMembers.map((member) => <li key={member.sheet_id}><span>{sheetName(member.sheet_id)}{member.role ? ` · ${member.role}` : ""}</span>
          {canManage && <button type="button" disabled={busy} onClick={() => void write(() => table("hunter_cell_members").delete().eq("cell_id", cell.id).eq("sheet_id", member.sheet_id), "Membro removido.")}>remover</button>}</li>)}</ul>
        {canManage && <form className={styles.inline} onSubmit={addMember}>
          <label>Ficha<select value={memberDraft.sheetId} onChange={(event) => setMemberDraft({ ...memberDraft, sheetId: event.target.value })}><option value="">Selecione</option>{sheets.filter((sheet) => !cellMembers.some((member) => member.sheet_id === sheet.id)).map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}</select></label>
          <label>Papel<input maxLength={80} value={memberDraft.role} onChange={(event) => setMemberDraft({ ...memberDraft, role: event.target.value })} /></label>
          <button className={styles.rollButton} type="submit" disabled={busy || !memberDraft.sheetId}>Incluir</button>
        </form>}

        <h3>Antagonistas e alvos</h3>
        <ul className={styles.rows}>{cellTargets.map((target) => <li key={target.id}><span>{target.name} · {target.kind === "alvo" ? "Alvo" : "Antagonista"} · ameaça {target.threat} · {STATUSES[target.status] ?? target.status}{target.notes ? ` · ${target.notes}` : ""}</span>
          {canManage && <span>
            <select aria-label={`Situação de ${target.name}`} value={target.status} disabled={busy} onChange={(event) => void write(() => table("hunter_cell_targets").update({ status: event.target.value }).eq("id", target.id), "Situação atualizada.")}>{Object.entries(STATUSES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <button type="button" disabled={busy} onClick={() => void write(() => table("hunter_cell_targets").delete().eq("id", target.id), "Alvo removido.")}>remover</button>
          </span>}</li>)}</ul>
        {canManage && <form onSubmit={addTarget}>
          <div className={styles.inline}>
            <label>Nome<input maxLength={120} value={targetDraft.name} onChange={(event) => setTargetDraft({ ...targetDraft, name: event.target.value })} /></label>
            <label>Tipo<select value={targetDraft.kind} onChange={(event) => setTargetDraft({ ...targetDraft, kind: event.target.value as Target["kind"] })}><option value="antagonista">Antagonista</option><option value="alvo">Alvo</option></select></label>
            <label>Ameaça<input type="number" min={0} max={5} value={targetDraft.threat} onChange={(event) => setTargetDraft({ ...targetDraft, threat: Number(event.target.value) })} /></label>
          </div>
          <label>Notas<textarea maxLength={2000} value={targetDraft.notes} onChange={(event) => setTargetDraft({ ...targetDraft, notes: event.target.value })} /></label>
          <button className={styles.rollButton} type="submit" disabled={busy}>Registrar alvo</button>
        </form>}

        <h3>Vínculos</h3>
        <ul className={styles.rows}>{cellBonds.map((bond) => <li key={bond.id}><span>{sheetName(bond.from_sheet_id)} → {bond.to_sheet_id ? sheetName(bond.to_sheet_id) : cellTargets.find((target) => target.id === bond.to_target_id)?.name ?? "alvo"} · {BOND_KINDS[bond.kind] ?? bond.kind}{bond.description ? ` · ${bond.description}` : ""}</span>
          {canManage && <button type="button" disabled={busy} onClick={() => void write(() => table("hunter_cell_bonds").delete().eq("id", bond.id), "Vínculo removido.")}>remover</button>}</li>)}</ul>
        {canManage && cellMembers.length > 0 && <form onSubmit={addBond}>
          <div className={styles.inline}>
            <label>De<select value={bondDraft.from} onChange={(event) => setBondDraft({ ...bondDraft, from: event.target.value })}><option value="">Membro</option>{cellMembers.map((member) => <option key={member.sheet_id} value={member.sheet_id}>{sheetName(member.sheet_id)}</option>)}</select></label>
            <label>Para<select value={bondDraft.to} onChange={(event) => setBondDraft({ ...bondDraft, to: event.target.value })}><option value="">Membro ou alvo</option>
              {cellMembers.map((member) => <option key={member.sheet_id} value={`sheet:${member.sheet_id}`}>{sheetName(member.sheet_id)}</option>)}
              {cellTargets.map((target) => <option key={target.id} value={`target:${target.id}`}>{target.name}</option>)}</select></label>
            <label>Tipo<select value={bondDraft.kind} onChange={(event) => setBondDraft({ ...bondDraft, kind: event.target.value })}>{Object.entries(BOND_KINDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          </div>
          <label>Descrição<input maxLength={500} value={bondDraft.description} onChange={(event) => setBondDraft({ ...bondDraft, description: event.target.value })} /></label>
          <button className={styles.rollButton} type="submit" disabled={busy || !bondDraft.from || !bondDraft.to}>Registrar vínculo</button>
        </form>}
      </article>}
    </div>
  </section>;
}
