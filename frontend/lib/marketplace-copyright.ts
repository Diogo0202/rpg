/** Formulário "Reportar Copyright" do marketplace: só texto e link; nenhum arquivo é enviado. */
export type CopyrightDraft = {
  reason: string;
  claimedWork: string;
  rightsHolder: string;
  evidenceUrl: string;
  goodFaith: boolean;
};

export type CopyrightPayload = {
  reason: string;
  claimed_work: string;
  rights_holder: string;
  evidence_url: string | null;
  good_faith: true;
};

export const emptyCopyrightDraft: CopyrightDraft = { reason: "", claimedWork: "", rightsHolder: "", evidenceUrl: "", goodFaith: false };

export const COPYRIGHT_LIMITS = { reason: [10, 2000], claimedWork: [2, 300], rightsHolder: [2, 200], evidenceUrl: 500 } as const;

const EMBEDDED_FILE = /data:[^\s,;]*;base64,|%PDF-|JVBERi0/i;

function isHttpLink(value: string): boolean {
  if (value.length > COPYRIGHT_LIMITS.evidenceUrl || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !!url.hostname;
  } catch { return false; }
}

/** Valida e monta o corpo; devolve a primeira mensagem de erro para o usuário. */
export function buildCopyrightReport(draft: CopyrightDraft): { ok: true; payload: CopyrightPayload } | { ok: false; error: string } {
  const reason = draft.reason.trim();
  const claimedWork = draft.claimedWork.trim();
  const rightsHolder = draft.rightsHolder.trim();
  const evidenceUrl = draft.evidenceUrl.trim();
  if (reason.length < COPYRIGHT_LIMITS.reason[0] || reason.length > COPYRIGHT_LIMITS.reason[1]) return { ok: false, error: "Descreva o motivo com 10 a 2000 caracteres." };
  if (claimedWork.length < COPYRIGHT_LIMITS.claimedWork[0] || claimedWork.length > COPYRIGHT_LIMITS.claimedWork[1]) return { ok: false, error: "Informe a obra protegida (2 a 300 caracteres)." };
  if (rightsHolder.length < COPYRIGHT_LIMITS.rightsHolder[0] || rightsHolder.length > COPYRIGHT_LIMITS.rightsHolder[1]) return { ok: false, error: "Informe o titular dos direitos (2 a 200 caracteres)." };
  if (evidenceUrl && !isHttpLink(evidenceUrl)) return { ok: false, error: "O link deve começar com http:// ou https://." };
  if ([reason, claimedWork, rightsHolder, evidenceUrl].some((value) => EMBEDDED_FILE.test(value))) return { ok: false, error: "Não envie arquivos ou anexos; use um link para a obra." };
  if (draft.goodFaith !== true) return { ok: false, error: "Confirme a declaração de boa-fé." };
  return { ok: true, payload: { reason, claimed_work: claimedWork, rights_holder: rightsHolder, evidence_url: evidenceUrl || null, good_faith: true } };
}

export function copyrightReportPath(systemId: string): string {
  return `/api/v1/marketplace/systems/${encodeURIComponent(systemId)}/report/copyright`;
}
