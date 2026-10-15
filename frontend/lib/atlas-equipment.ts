import equipmentJson from "../data/atlas-equipment.json";

export type AtlasEquipmentCategory = "weapon" | "armor" | "equipment" | "clothing" | "dwelling" | "vehicle" | "mount" | "animal";
export type AtlasEra = "antiga" | "medieval" | "revolucao-industrial" | "moderna";
export type AtlasDamageKind = "all" | "ballistic" | "cutting" | "blunt" | "incapacitating" | "narrative";

export type AtlasAnimalProfile = {
  species: string;
  strength: number;
  dexterity: number;
  stamina: number;
  health: number;
  speed: string;
  attack: string;
  traits: string[];
  price_label?: string;
};

export type AtlasEquipment = {
  id: string;
  name: string;
  category: AtlasEquipmentCategory;
  resource_cost: number;
  damage_bonus: number | null;
  protection: number;
  notes: string;
  eras: AtlasEra[];
  animal_profile?: AtlasAnimalProfile;
  source: "RPG Atlas fb34a5b, shared/vampire-v5.ts";
};

export const ATLAS_EQUIPMENT = equipmentJson as AtlasEquipment[];

export type AtlasEquipmentFilter = {
  query?: string;
  category?: AtlasEquipmentCategory | "all";
  era?: AtlasEra | "all";
  maxResources?: number;
  damageKind?: AtlasDamageKind;
};

export function getAtlasDamageKind(item: AtlasEquipment): Exclude<AtlasDamageKind, "all"> {
  if (item.damage_bonus === null) return "narrative";
  if (["pistola", "revolver", "submetralhadora", "rifle", "espingarda"].includes(item.id)) return "ballistic";
  if (["faca", "espada", "machete", "machado", "arco", "gladio-cerimonial"].includes(item.id)) return "cutting";
  if (item.id === "gas") return "incapacitating";
  return "blunt";
}

export function filterAtlasEquipment(items: readonly AtlasEquipment[], filter: AtlasEquipmentFilter = {}): AtlasEquipment[] {
  const query = filter.query?.trim().toLocaleLowerCase("pt-BR");
  return items.filter((item) =>
    (!query || `${item.name} ${item.notes} ${item.category}`.toLocaleLowerCase("pt-BR").includes(query)) &&
    (!filter.category || filter.category === "all" || item.category === filter.category) &&
    (filter.maxResources === undefined || item.resource_cost <= filter.maxResources) &&
    (!filter.damageKind || filter.damageKind === "all" || getAtlasDamageKind(item) === filter.damageKind) &&
    (!filter.era || filter.era === "all" || item.eras.includes(filter.era) || (!item.eras.length && filter.era === "moderna"))
  );
}
