/** Interface-independent primitives extracted from the existing mobile sync engine. */
export interface SyncPartition { accountId:string;campaignId:string;deviceId:string }
export const syncPartitionKey=(p:SyncPartition)=>JSON.stringify([p.accountId,p.campaignId,p.deviceId]);
export function createSyncId():string {if(!globalThis.crypto?.randomUUID)throw new Error("crypto.randomUUID is required for sync IDs");return globalThis.crypto.randomUUID();}
export class SyncHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly code?: string;
  constructor(message: string, status: number, retryAfterMs?: number, code?: string) {
    super(message); this.name = "SyncHttpError";
    this.status = status; this.retryAfterMs = retryAfterMs; this.code = code;
  }
}

export function parseRetryAfter(value: string | null, now = Date.now(), capMs = 120000): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const raw = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(raw)) return undefined;
  if (raw < 0) return 0;
  return Math.min(capMs, Math.floor(raw));
}

