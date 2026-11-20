import { createSyncId } from "../sync/core.ts";
import { ONE_RING_CATALOG as C } from "./catalog.ts";
export type CompanyKind = "create" | "configure" | "add_member" | "remove_member" | "set_focus" | "spend" | "restore" | "reset_session";

export type CompanyRecord = {
  id: string; campaign_id: string; name: string; patron_id: string | null; safe_havens: string[];
  version: number; society_max: number; society_current: number; spent_this_session?: number;
};
export type CompanyMember = { sheet_id: string; name: string; owner_id: string; society_bonus?: number };
export type CompanyFocus = { source_sheet_id: string; target_sheet_id: string };
export type CompanyEvent = { id: string; operation_id: string; kind: string; amount: number | null; reason: string | null; actor_id: string; created_at: string };
export type CompanySnapshot = { company: CompanyRecord | null; members: CompanyMember[]; focuses: CompanyFocus[]; events: CompanyEvent[]; reset_sessions?: string[] };
export type CompanyPayload = Record<string, unknown>;
export type CompanyCommand = { operation_id: string; expected_version: number; kind: CompanyKind; payload: CompanyPayload };
export type CompanyRole = "narrator" | "player" | "guest";
export type CompanyQueueState = "queued" | "conflict" | "denied" | "invalid";
export type CompanyQueueEntry = { command: CompanyCommand; state: CompanyQueueState; reason?: string; created_at: number };
export type CompanySyncState = { schema: "one-ring-company-v1"; account_id: string; campaign_id: string; device_id: string; snapshot: CompanySnapshot | null; queue: CompanyQueueEntry[]; paused: boolean; viewer_id?: string; viewer_role?: CompanyRole; approved_templates?: { id: string; name: string }[]; candidates?: {id:string;name:string;owner_id:string}[]; ended_sessions?: {id:string;sequence:number;title:string}[]; updated_at: number; retry_at?: number };

export function emptyCompanySnapshot(): CompanySnapshot { return { company: null, members: [], focuses: [], events: [] }; }

export function validateCompanyCommand(snapshot: CompanySnapshot | null, role: CompanyRole, actorId: string, kind: CompanyKind, payload: CompanyPayload): string | null {
  const company = snapshot?.company ?? null;
  if (role === "guest") return "Convidados não podem alterar a Companhia.";
  if (role !== "narrator" && kind !== "set_focus") return "Somente o narrador pode alterar esse dado.";
  if ((kind === "create" || kind === "configure") && payload.patron_id != null && !C.patrons.some((p)=>p.id===payload.patron_id)) return "Escolha um patrono do catálogo.";
  if (kind === "create") return company ? "A Companhia já existe." : validName(payload.name) && validHavens(payload.safe_havens) ? null : "Informe nome e refúgios válidos.";
  if (!company) return "Crie a Companhia antes desta operação.";
  if (kind === "configure") return validName(payload.name) && validHavens(payload.safe_havens) ? null : "Informe nome e refúgios válidos.";
  if (kind === "add_member" || kind === "remove_member") return isText(payload.sheet_id) ? null : "Ficha inválida.";
  if (kind === "set_focus") {
    if (!isText(payload.source_sheet_id) || !(payload.target_sheet_id === null || isText(payload.target_sheet_id))) return "Escolha uma ficha para definir o foco.";
    if (!company || !snapshot?.members.some((member) => member.sheet_id === payload.source_sheet_id)) return "A ficha de origem precisa estar na Companhia.";
    if (role === "player" && !snapshot?.members.some((member) => member.sheet_id === payload.source_sheet_id && member.owner_id === actorId)) return "Cada jogador só pode alterar o foco da própria ficha.";
    if (payload.target_sheet_id && !snapshot?.members.some((member) => member.sheet_id === payload.target_sheet_id)) return "O alvo precisa estar na Companhia.";
    if (payload.target_sheet_id === payload.source_sheet_id) return "Escolha outro companheiro como foco.";
    return null;
  }
  if (kind === "spend" || kind === "restore") {
    if (!Number.isSafeInteger(payload.amount) || Number(payload.amount) <= 0 || !isText(payload.reason) || payload.reason.trim().length > 200) return "Informe uma quantidade positiva e um motivo com até 200 caracteres.";
    if (kind === "spend" && Number(payload.amount) > company.society_current) return "A Sociedade não tem saldo suficiente.";
    if (kind === "restore" && Number(payload.amount) > (company.spent_this_session ?? Math.max(0,company.society_max-company.society_current))) return "A restauração excede o limite da Sociedade.";
    return null;
  }
  if (kind === "reset_session") return isText(payload.session_id) ? null : "Escolha uma sessão encerrada.";
  return "Operação desconhecida.";
}

function isText(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function validName(value: unknown): value is string { return isText(value) && value.trim().length <= 120; }
function validHavens(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 30 && value.every((entry) => isText(entry) && entry.trim().length <= 120); }

export function optimisticSnapshot(snapshot: CompanySnapshot, command: CompanyCommand): CompanySnapshot {
  const next = structuredClone(snapshot), p = command.payload, company = next.company;
  switch (command.kind) {
    case "create": next.company = { id: `pending:${command.operation_id}`, campaign_id: "", name: String(p.name).trim(), patron_id: typeof p.patron_id === "string" ? p.patron_id : null, safe_havens: (p.safe_havens as string[]).map((x) => x.trim()).filter(Boolean), version: command.expected_version + 1, society_max: C.patrons.find((patron)=>patron.id===p.patron_id)?.bonus ?? 0, society_current: 0, spent_this_session:0 }; break;
    case "configure": if (company) { company.name = String(p.name).trim(); company.patron_id = typeof p.patron_id === "string" ? p.patron_id : null; company.safe_havens = (p.safe_havens as string[]).map((x) => x.trim()).filter(Boolean); company.version++; } break;
    case "add_member": if (!next.members.some((m) => m.sheet_id === p.sheet_id)) next.members.push({ sheet_id: String(p.sheet_id), name: String(p.name ?? "Ficha"), owner_id: String(p.owner_id ?? "") }); if (company) company.version++; break;
    case "remove_member": next.members = next.members.filter((m) => m.sheet_id !== p.sheet_id); next.focuses = next.focuses.filter((f) => f.source_sheet_id !== p.sheet_id && f.target_sheet_id !== p.sheet_id); if (company) company.version++; break;
    case "set_focus": next.focuses = next.focuses.filter((f) => f.source_sheet_id !== p.source_sheet_id); if (p.target_sheet_id) next.focuses.push({ source_sheet_id: String(p.source_sheet_id), target_sheet_id: String(p.target_sheet_id) }); if (company) company.version++; break;
    case "spend": if (company) { company.spent_this_session = (company.spent_this_session ?? Math.max(0,company.society_max-company.society_current)) + Number(p.amount); company.society_current -= Number(p.amount); company.version++; } break;
    case "restore": if (company) { company.spent_this_session = Math.max(0,(company.spent_this_session ?? Math.max(0,company.society_max-company.society_current))-Number(p.amount)); company.society_current = Math.max(0,company.society_max-company.spent_this_session); company.version++; } break;
    case "reset_session": if (company) { if(!next.reset_sessions?.includes(String(p.session_id))) { company.spent_this_session=0; company.society_current=company.society_max; next.reset_sessions=[...(next.reset_sessions??[]),String(p.session_id)]; } company.version++; } break;
  }
  if(next.company && ["create","configure","add_member","remove_member"].includes(command.kind)) {
    const spent = company?.spent_this_session ?? Math.max(0,(company?.society_max??0)-(company?.society_current??0));
    next.company.society_max = next.members.reduce((sum,m)=>sum+1+(m.society_bonus??0),0)+(C.patrons.find((patron)=>patron.id===next.company?.patron_id)?.bonus??0);
    next.company.spent_this_session=spent;next.company.society_current=Math.max(0,next.company.society_max-spent);
  }
  return next;
}

export function projectCompanySnapshot(base: CompanySnapshot, queue: CompanyQueueEntry[]): CompanySnapshot {
  let current=structuredClone(base);for(const entry of queue){if(entry.state!=="queued")break;current=optimisticSnapshot(current,entry.command);}return current;
}

export function makeCompanyCommand(kind: CompanyKind, payload: CompanyPayload, expectedVersion: number, makeId: () => string = createSyncId): CompanyCommand {
  return { operation_id: makeId(), expected_version: expectedVersion, kind, payload: structuredClone(payload) };
}
