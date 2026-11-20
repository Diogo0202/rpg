import catalog from "../../backend/app/data/one_ring_2e.json" with { type: "json" };
export type RingCulture = { id:string;name:string;attributes:number[][];bases:number[];skills:Record<string,number>;favoured:string[];combat:string[];traits:string[];living:string;languages:string[];blessing:string;page:number;attribute_bonus?:number;armor_load_divisor?:number;allowed_weapons?:string[];forbidden_equipment?:string[];fellowship_bonus?:number;valour_favoured?:boolean;wisdom_favoured?:boolean;greed_bonus?:number;age_suggestion?:number[] };
export type RingCatalog = {
 version:number;source:typeof catalog.source;attributes:string[];
 skills:Array<{id:string;label:string;legacy_label:string;attribute:string}>;proficiencies:Array<{id:string;label:string}>;
 skill_costs:number[];combat_costs:number[];previous_experience:number;cultures:RingCulture[];
 callings:Array<{id:string;name:string;favoured:string[];trait:string;shadow:string;page:number;enemy_choice?:boolean}>;enemies:string[];
 living:Array<{name:string;treasure:number;useful_items:number;mount_vigour:number}>;
 weapons:Array<{id:string;name:string;proficiency:string;damage:number;wound:number;load:number;hands:number;wound_two_hands?:number}>;
 armor:Array<{id:string;name:string;protection:number;load:number;minimum_living:string}>;
 helmet:{id:string;name:string;protection:number;load:number};shields:Array<{id:string;name:string;parry:number;load:number;minimum_living:string}>;
 virtues:Array<{id:string;name:string;effect:string;amount:number;page:number}>;rewards:Array<{id:string;name:string;targets:string[];effect:string;amount:number;page:number}>;
 patrons:Array<{id:string;name:string;bonus:number}>;
};
export const ONE_RING_CATALOG = catalog as RingCatalog;
