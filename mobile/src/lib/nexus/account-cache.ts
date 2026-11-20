/** Cache por conta: campanhas, capacidades e campanha escolhida, guardados nas preferências locais. */

import type { SyncCampaign, SyncCapabilities } from "@/lib/mobile-sync/index.ts";
import { prefGet, prefSet } from "./prefs";

const CAMPAIGNS = "nexus-cached-campaigns-v1:";
const CAPABILITIES = "nexus-cached-capabilities-v1:";
const SELECTED = "nexus-selected-campaign-v1:";
const DEMO_SEED_DISABLED = "nexus-local-demo-seed-disabled-v1";

export const accountCache = {
  async campaigns(accountId: string): Promise<SyncCampaign[]> {
    return (await prefGet<SyncCampaign[]>(`${CAMPAIGNS}${accountId}`)) ?? [];
  },
  saveCampaigns(accountId: string, rows: SyncCampaign[]) {
    return prefSet(`${CAMPAIGNS}${accountId}`, rows);
  },
  selectedCampaign(accountId: string) {
    return prefGet<string>(`${SELECTED}${accountId}`);
  },
  selectCampaign(accountId: string, campaignId: string) {
    return prefSet(`${SELECTED}${accountId}`, campaignId);
  },
  capabilities(accountId: string, campaignId: string) {
    return prefGet<SyncCapabilities>(`${CAPABILITIES}${accountId}:${campaignId}`);
  },
  saveCapabilities(accountId: string, campaignId: string, caps: SyncCapabilities) {
    return prefSet(`${CAPABILITIES}${accountId}:${campaignId}`, caps);
  },
  /** Apaga lista, escolha e capacidades das campanhas informadas. */
  async clear(accountId: string, campaignIds: string[]) {
    await prefSet(`${CAMPAIGNS}${accountId}`, []);
    await prefSet(`${SELECTED}${accountId}`, "");
    for (const campaignId of new Set(campaignIds)) await prefSet(`${CAPABILITIES}${accountId}:${campaignId}`, null);
  },
  async demoSeedDisabled() {
    return (await prefGet<boolean>(DEMO_SEED_DISABLED)) === true;
  },
  setDemoSeedDisabled(disabled: boolean) {
    return prefSet(DEMO_SEED_DISABLED, disabled);
  },
};

/** Capacidades em cache valem só para a mesma campanha e a versão 1 do protocolo. */
export function validCapabilities(caps: SyncCapabilities | undefined | null, campaignId: string): caps is SyncCapabilities {
  return Boolean(caps) && caps!.campaign_id === campaignId && caps!.protocol_version === 1;
}
