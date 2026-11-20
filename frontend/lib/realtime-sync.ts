/**
 * Supabase Realtime subscription with reconnect, resync and version-based conflict handling.
 * Kept free of React and of the concrete Supabase client so it can run under `node --test`.
 */

export type RealtimeConnection = "connecting" | "connected" | "reconnecting" | "offline";

/** Statuses emitted by `RealtimeChannel.subscribe`. */
export type ChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | string;

export type SubscribableChannel = {
  subscribe(callback: (status: ChannelStatus, error?: Error) => void): unknown;
};

export type RealtimeClientLike<C extends SubscribableChannel> = {
  channel(topic: string, options?: { config?: Record<string, unknown> }): C;
  removeChannel(channel: C): unknown;
};

export type Scheduler = {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
};

export type RealtimeSyncOptions<C extends SubscribableChannel> = {
  client: RealtimeClientLike<C>;
  topic: string;
  config?: Record<string, unknown>;
  /** Attaches `.on(...)` listeners; must return the same channel. */
  bind: (channel: C) => C;
  /** Fetches a fresh snapshot. Called on every (re)subscribe so missed changes are recovered. */
  onResync: () => void;
  onStatus?: (status: RealtimeConnection, attempt: number) => void;
  onChannel?: (channel: C | null) => void;
  scheduler?: Scheduler;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type RealtimeSync = { stop(): void; reconnectNow(): void; attempt(): number };

const defaultScheduler: Scheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Exponential backoff: 1s, 2s, 4s… capped at `max`. `attempt` starts at 1. */
export function reconnectDelay(attempt: number, base = 1000, max = 30000): number {
  const safe = Math.max(1, Math.floor(Number.isFinite(attempt) ? attempt : 1));
  return Math.min(max, base * 2 ** Math.min(safe - 1, 30));
}

export function connectionLabel(status: RealtimeConnection): string {
  switch (status) {
    case "connected": return "Ao vivo";
    case "connecting": return "Conectando…";
    case "reconnecting": return "Reconectando…";
    default: return "Sem tempo real";
  }
}

/**
 * Opens a channel and keeps it alive. On CHANNEL_ERROR / TIMED_OUT / unexpected CLOSED the channel
 * is removed and recreated after a backoff delay; every successful SUBSCRIBED triggers `onResync`.
 */
export function startRealtimeSync<C extends SubscribableChannel>(options: RealtimeSyncOptions<C>): RealtimeSync {
  const scheduler = options.scheduler ?? defaultScheduler;
  const base = options.baseDelayMs ?? 1000;
  const max = options.maxDelayMs ?? 30000;
  let stopped = false;
  let attempt = 0;
  let generation = 0;
  let timer: unknown = null;
  let current: C | null = null;

  const report = (status: RealtimeConnection) => { if (!stopped) options.onStatus?.(status, attempt); };

  function teardown() {
    if (timer !== null) { scheduler.clear(timer); timer = null; }
    const channel = current;
    current = null;
    options.onChannel?.(null);
    if (channel) {
      try { void options.client.removeChannel(channel); } catch { /* channel already gone */ }
    }
  }

  function open() {
    if (stopped) return;
    const mine = ++generation;
    report(attempt === 0 ? "connecting" : "reconnecting");
    const channel = options.bind(options.client.channel(options.topic, options.config ? { config: options.config } : undefined));
    current = channel;
    options.onChannel?.(channel);
    channel.subscribe((status) => {
      if (stopped || mine !== generation) return;
      if (status === "SUBSCRIBED") {
        attempt = 0;
        report("connected");
        options.onResync();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        scheduleReconnect();
      }
    });
  }

  function scheduleReconnect() {
    if (stopped || timer !== null) return;
    attempt += 1;
    generation += 1; // ignore late callbacks from the failed channel
    report("reconnecting");
    const delay = reconnectDelay(attempt, base, max);
    const failed = current;
    current = null;
    options.onChannel?.(null);
    if (failed) {
      try { void options.client.removeChannel(failed); } catch { /* ignore */ }
    }
    timer = scheduler.set(() => { timer = null; open(); }, delay);
  }

  open();

  return {
    stop() {
      if (stopped) return;
      teardown();
      stopped = true;
      generation += 1;
      options.onStatus?.("offline", attempt);
    },
    reconnectNow() {
      if (stopped) return;
      teardown();
      generation += 1;
      open();
    },
    attempt: () => attempt,
  };
}

export type Versioned = { id: string; version: number };

/** A realtime row wins only when it is at least as new as the local copy. */
export function isNewerVersion(local: Versioned | null | undefined, incoming: Versioned): boolean {
  if (!local) return true;
  return Number.isFinite(incoming.version) && incoming.version >= local.version;
}

export type RowChange<T extends Versioned> =
  | { eventType: "INSERT" | "UPDATE"; new: T }
  | { eventType: "DELETE"; old: { id?: string } };

/** Applies a postgres_changes payload to a list, ignoring stale or duplicated versions. */
export function applyRowChange<T extends Versioned>(rows: T[], change: RowChange<T>): T[] {
  if (change.eventType === "DELETE") {
    const id = change.old?.id;
    return id ? rows.filter((row) => row.id !== id) : rows;
  }
  const incoming = change.new;
  if (!incoming || typeof incoming.id !== "string") return rows;
  const index = rows.findIndex((row) => row.id === incoming.id);
  if (index < 0) return [incoming, ...rows];
  const existing = rows[index];
  if (!isNewerVersion(existing, incoming)) return rows;
  const next = rows.slice();
  next[index] = { ...existing, ...incoming };
  return next;
}

export type PresenceRole = "narrador" | "jogador" | "convidado";
export type PresenceMeta = { user_id?: unknown; name?: unknown; online_at?: unknown };
export type PresenceMember = { userId: string; name: string; role: PresenceRole; onlineAt: string; self: boolean };

/**
 * Turns `channel.presenceState()` into one entry per user. Roles never come from the payload
 * (clients could lie); they are looked up in the campaign membership the viewer can read.
 */
export function presenceMembers(
  state: Record<string, PresenceMeta[] | undefined>,
  roles: Record<string, PresenceRole>,
  viewerId: string,
): PresenceMember[] {
  const byUser = new Map<string, PresenceMember>();
  for (const [key, metas] of Object.entries(state)) {
    for (const meta of metas ?? []) {
      const userId = typeof meta.user_id === "string" ? meta.user_id : key;
      if (!roles[userId]) continue; // not a member we know about: ignore
      const rawName = typeof meta.name === "string" ? meta.name.trim().slice(0, 80) : "";
      const onlineAt = typeof meta.online_at === "string" ? meta.online_at : "";
      const previous = byUser.get(userId);
      if (previous && previous.onlineAt <= onlineAt) continue;
      byUser.set(userId, { userId, name: rawName || "Membro da campanha", role: roles[userId], onlineAt, self: userId === viewerId });
    }
  }
  const order: Record<PresenceRole, number> = { narrador: 0, jogador: 1, convidado: 2 };
  return [...byUser.values()].sort((a, b) => order[a.role] - order[b.role] || Number(b.self) - Number(a.self) || a.name.localeCompare(b.name, "pt-BR"));
}

export function roleFromMembership(role: string | null | undefined, isOwner: boolean): PresenceRole {
  if (isOwner || role === "owner" || role === "master") return "narrador";
  if (role === "player") return "jogador";
  return "convidado";
}

/** Topic for the private presence/ping channel; must match private.can_use_campaign_realtime. */
export function liveTopic(campaignId: string): string {
  return `campaign:${campaignId}:live`;
}

/** Client-side throttle for the narrator's attention ping (the server only checks the role). */
export function canSendPing(lastSentAt: number | null, now: number, cooldownMs = 5000): boolean {
  return lastSentAt === null || now - lastSentAt >= cooldownMs;
}
