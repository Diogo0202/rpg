import { createClient } from "./supabase/client";
import type { MapRpc } from "./map-interactions";

/** Stable adapter for the web session. Mobile supplies its own authenticated client. */
export const webMapRpc: MapRpc = async (name, args) => {
  const { data, error } = await createClient().rpc(name, args);
  return { data, error: error ? { message: error.message } : null };
};
