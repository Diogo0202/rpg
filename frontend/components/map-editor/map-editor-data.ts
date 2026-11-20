import { browserDb } from "../../lib/data/browser";
import { listMapSheetOptions, saveMap } from "../../lib/data/maps";
import { createEntity, listMapEntityOptions } from "../../lib/data/world";
import type { MapDocumentV2 } from "../../lib/map-document";
import type { EntityOption, SheetOption } from "./pin-creator";

export type EditableMap = {
  id: string;
  campaign_id: string;
  name: string;
  document: Record<string, unknown>;
  version: number;
  system_key: string | null;
  shared_with_players: boolean;
  updated_at: string;
};

export type MapPatch = Pick<EditableMap, "name" | "system_key" | "shared_with_players"> & { document: MapDocumentV2 };

/** Porta de dados do editor: Supabase por padrão, trocada pela fixture de desenvolvimento. */
export type MapEditorData = {
  loadReferences: (campaignId: string) => Promise<{ sheets: SheetOption[]; entities: EntityOption[] }>;
  createEntity: (campaignId: string, viewerId: string, kind: "npc" | "item", name: string) => Promise<EntityOption>;
  /** Resolves to null when the stored version moved on (optimistic lock). */
  saveMap: (map: EditableMap, patch: MapPatch) => Promise<EditableMap | null>;
  /** Fixed portrait URLs; when set, Storage is never queried. */
  portraitUrls?: Record<string, string>;
};

/** Adaptador da porta sobre os repositórios de mapas e do mundo. */
export const supabaseMapData: MapEditorData = {
  async loadReferences(campaignId) {
    const db = browserDb();
    const [sheetResult, entityResult] = await Promise.all([
      listMapSheetOptions(db, campaignId),
      listMapEntityOptions(db, campaignId),
    ]);
    return { sheets: (sheetResult.data ?? []) as SheetOption[], entities: (entityResult.data ?? []) as EntityOption[] };
  },
  async createEntity(campaignId, viewerId, kind, name) {
    const { data, error } = await createEntity(browserDb(), { campaignId, createdBy: viewerId, kind, name: name.slice(0, 160), body: {} }, "id,name,kind");
    if (error || !data) throw new Error("Não foi possível criar a entidade no mundo da campanha.");
    return data as EntityOption;
  },
  async saveMap(map, patch) {
    const { data, error } = await saveMap(browserDb(), map, patch);
    if (error) throw new Error("O banco recusou o mapa. Confira estruturas e pins.");
    return (data as EditableMap | null) ?? null;
  },
};
