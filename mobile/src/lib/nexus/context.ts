import { createContext } from "react";
import type {
  JsonValue,
  SyncCampaign,
  SyncCapabilities,
  SyncEngine,
  SyncState,
} from "@/lib/mobile-sync/index.ts";

export type Entity<T = Record<string, JsonValue>> = {
  type: string;
  id: string;
  version: number;
  data: T;
  pending: boolean;
  conflict: boolean;
};

export type PathSet = { path: string[]; value: JsonValue | undefined };
export type NexusUser = { id: string; email: string | null };

export type NexusContextValue = {
  ready: boolean;
  error: string | null;
  engine: SyncEngine | null;
  state: SyncState | null;
  deviceId: string | null;
  mode: "local" | "connected";
  accountId: string;
  campaignId: string;
  campaignName: string;
  user: NexusUser | null;
  campaigns: SyncCampaign[];
  capabilities: SyncCapabilities | null;
  connectionMessage: string;
  list: <T = Record<string, JsonValue>>(type: string) => Entity<T>[];
  get: <T = Record<string, JsonValue>>(
    type: string,
    id: string | undefined | null,
  ) => Entity<T> | undefined;
  create: (
    type: string,
    data: Record<string, JsonValue>,
    opts?: { dependsOnEntities?: [string, string][]; id?: string },
  ) => Promise<string>;
  update: (type: string, id: string, sets: PathSet[]) => Promise<boolean>;
  remove: (type: string, id: string) => Promise<void>;
  refresh: () => Promise<void>;
  wipeLocal: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshCampaigns: () => Promise<SyncCampaign[]>;
  connectCampaign: (campaignId: string) => Promise<void>;
  syncNow: () => Promise<void>;
  setLocalMode: () => Promise<void>;
  connectionConfigured: boolean;
};

/**
 * Keep the provider boundary in its own module. Vite can replace store.tsx during
 * Fast Refresh while the mounted root still holds the provider from the prior module
 * instance. Keeping this context in a stable dependency lets updated consumers read
 * that provider value instead of creating a second context.
 */
export const NexusContext = createContext<NexusContextValue | null>(null);
