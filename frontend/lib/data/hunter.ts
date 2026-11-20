import type { Db } from "./db.ts";

/** Células de Caçador e o estado de Desespero calculado no banco. */

export function hunterSheetState(db: Db, sheetId: string) {
  return db.rpc("hunter_sheet_state", { p_sheet_id: sheetId });
}

export function listCells(db: Db, campaignId: string) {
  return db.from("hunter_cells").select("id,name,danger,desperation,notes,version").eq("campaign_id", campaignId).order("name");
}

export function listCellMembers(db: Db, campaignId: string) {
  return db.from("hunter_cell_members").select("cell_id,sheet_id,role").eq("campaign_id", campaignId);
}

export function listCellTargets(db: Db, campaignId: string) {
  return db.from("hunter_cell_targets").select("id,cell_id,name,kind,status,threat,notes").eq("campaign_id", campaignId).order("threat", { ascending: false });
}

export function listCellBonds(db: Db, campaignId: string) {
  return db.from("hunter_cell_bonds").select("id,cell_id,from_sheet_id,to_sheet_id,to_target_id,kind,description").eq("campaign_id", campaignId);
}

/** Nomes públicos das fichas, visíveis a todos os membros da campanha. */
export function listPublicSheetNames(db: Db, campaignId: string) {
  return db.from("party_status_public").select("id,name").eq("campaign_id", campaignId).order("name");
}

export function createCell(db: Db, campaignId: string, name: string) {
  return db.from("hunter_cells").insert({ campaign_id: campaignId, name });
}

export function updateCell(db: Db, cell: { id: string; version: number }, patch: { danger: number; desperation: number; notes: string }) {
  return db.from("hunter_cells").update(patch).eq("id", cell.id).eq("version", cell.version);
}

export function addCellMember(db: Db, member: { cellId: string; campaignId: string; sheetId: string; role: string }) {
  return db.from("hunter_cell_members").insert({ cell_id: member.cellId, campaign_id: member.campaignId, sheet_id: member.sheetId, role: member.role });
}

export function removeCellMember(db: Db, cellId: string, sheetId: string) {
  return db.from("hunter_cell_members").delete().eq("cell_id", cellId).eq("sheet_id", sheetId);
}

export function addCellTarget(db: Db, target: { cellId: string; campaignId: string; name: string; kind: string; threat: number; notes: string }) {
  return db.from("hunter_cell_targets").insert({ cell_id: target.cellId, campaign_id: target.campaignId, name: target.name, kind: target.kind, threat: target.threat, notes: target.notes });
}

export function setCellTargetStatus(db: Db, targetId: string, status: string) {
  return db.from("hunter_cell_targets").update({ status }).eq("id", targetId);
}

export function removeCellTarget(db: Db, targetId: string) {
  return db.from("hunter_cell_targets").delete().eq("id", targetId);
}

/** O vínculo aponta para outra ficha ou para um alvo, nunca para os dois. */
export function addCellBond(db: Db, bond: {
  cellId: string; campaignId: string; fromSheetId: string; kind: string; description: string; toSheetId: string | null; toTargetId: string | null;
}) {
  return db.from("hunter_cell_bonds").insert({
    cell_id: bond.cellId, campaign_id: bond.campaignId, from_sheet_id: bond.fromSheetId, kind: bond.kind, description: bond.description,
    to_sheet_id: bond.toSheetId, to_target_id: bond.toTargetId,
  });
}

export function removeCellBond(db: Db, bondId: string) {
  return db.from("hunter_cell_bonds").delete().eq("id", bondId);
}
