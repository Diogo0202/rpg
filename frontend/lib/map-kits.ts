/**
 * Per-system drawing kits for the top-down map editor. Every material, prop
 * and icon is drawn with in-house SVG primitives: no third-party art and no
 * WebGL, so maps stay light on phones at the table.
 */

export type MapTheme = "medieval" | "modern";
export type FillPattern = "none" | "planks" | "hatch" | "dots" | "bricks" | "tiles" | "waves" | "stripes";

export type FloorMaterial = { id: string; label: string; fill: string; detail: string; pattern: FillPattern };
export type WallMaterial = { id: string; label: string; color: string; edge: string; thickness: number; dash?: string };
export type DoorStyle = { id: string; label: string; color: string; secret?: boolean };
/** Props are composed of simple shapes in a 100×100 box centred on the prop. */
export type PropShape =
  | { shape: "rect"; x: number; y: number; w: number; h: number; r?: number; fill: string; stroke?: string }
  | { shape: "circle"; cx: number; cy: number; r: number; fill: string; stroke?: string }
  | { shape: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number };
export type PropDefinition = { id: string; label: string; size: number; shapes: PropShape[] };
/** 24×24 single-path glyphs shown inside NPC and item pins. */
export type PinIcon = { id: string; label: string; path: string };

export type MapKit = {
  theme: MapTheme;
  label: string;
  background: string;
  /** Default floor for new houses; differs from the outdoor background. */
  houseFloor: string;
  floors: FloorMaterial[];
  walls: WallMaterial[];
  doors: DoorStyle[];
  props: PropDefinition[];
  npcIcons: PinIcon[];
  itemIcons: PinIcon[];
};

const PERSON = "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 18c0-4 3.1-7 7-7s7 3 7 7z";
const SKULL = "M12 2c-4.4 0-8 3.1-8 7.5 0 2.4 1 4 2.5 5V18h3v-2h1v2h3v-2h1v2h3v-3.5c1.5-1 2.5-2.6 2.5-5C20 5.1 16.4 2 12 2zm-3.5 9a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6zm7 0a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6z";
const KEY = "M7.5 9a4.5 4.5 0 1 1 4.2 6H11v2H9v2H6v-3l3.3-3.3A4.5 4.5 0 0 1 7.5 9zm2.5-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z";
const CHEST = "M3 9a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v1H3zm0 3h18v7H3zm8 1v3h2v-3z";

export const MEDIEVAL_KIT: MapKit = {
  theme: "medieval",
  label: "Medieval",
  background: "grass",
  houseFloor: "wood_planks",
  floors: [
    { id: "grass", label: "Grama", fill: "#3f5a36", detail: "#4f6d43", pattern: "dots" },
    { id: "dirt", label: "Terra batida", fill: "#6b5236", detail: "#5a4530", pattern: "dots" },
    { id: "cobblestone", label: "Calçamento", fill: "#6f6a62", detail: "#57534d", pattern: "bricks" },
    { id: "wood_planks", label: "Tábuas", fill: "#7a5732", detail: "#5e4224", pattern: "planks" },
    { id: "stone_floor", label: "Piso de pedra", fill: "#5d5c58", detail: "#4a4946", pattern: "tiles" },
    { id: "water", label: "Água", fill: "#2f5966", detail: "#3c7180", pattern: "waves" },
  ],
  walls: [
    { id: "stone", label: "Pedra", color: "#8d8a83", edge: "#3c3a36", thickness: 70 },
    { id: "wood", label: "Madeira", color: "#6e4b2a", edge: "#3a2614", thickness: 50 },
    { id: "palisade", label: "Paliçada", color: "#7b5a35", edge: "#3a2614", thickness: 60, dash: "60 25" },
    { id: "ruin", label: "Ruína", color: "#77746c", edge: "#3c3a36", thickness: 60, dash: "140 70" },
  ],
  doors: [
    { id: "wooden", label: "Porta de madeira", color: "#9a6b3a" },
    { id: "iron_gate", label: "Portão de ferro", color: "#5f6670" },
    { id: "secret", label: "Passagem secreta", color: "#8d8a83", secret: true },
  ],
  props: [
    { id: "table", label: "Mesa", size: 260, shapes: [{ shape: "rect", x: -45, y: -30, w: 90, h: 60, r: 6, fill: "#8a6238", stroke: "#3a2614" }] },
    { id: "barrel", label: "Barril", size: 160, shapes: [{ shape: "circle", cx: 0, cy: 0, r: 40, fill: "#7a5530", stroke: "#3a2614" }, { shape: "circle", cx: 0, cy: 0, r: 26, fill: "none", stroke: "#3a2614" }] },
    { id: "chest", label: "Baú", size: 180, shapes: [{ shape: "rect", x: -40, y: -26, w: 80, h: 52, r: 4, fill: "#8a5a2b", stroke: "#3a2614" }, { shape: "line", x1: -40, y1: -6, x2: 40, y2: -6, stroke: "#c9a24a", width: 6 }] },
    { id: "campfire", label: "Fogueira", size: 200, shapes: [{ shape: "circle", cx: 0, cy: 0, r: 42, fill: "#4a4038", stroke: "#2a241f" }, { shape: "circle", cx: 0, cy: 0, r: 24, fill: "#e0892f" }, { shape: "circle", cx: 0, cy: 0, r: 11, fill: "#f6d06b" }] },
    { id: "tree", label: "Árvore", size: 420, shapes: [{ shape: "circle", cx: 0, cy: 0, r: 46, fill: "#2f4a2a", stroke: "#1f331c" }, { shape: "circle", cx: -12, cy: -10, r: 20, fill: "#3b5c34" }] },
    { id: "cart", label: "Carroça", size: 380, shapes: [{ shape: "rect", x: -45, y: -25, w: 90, h: 50, r: 4, fill: "#7b5a35", stroke: "#3a2614" }, { shape: "circle", cx: -28, cy: 30, r: 12, fill: "#3a2614" }, { shape: "circle", cx: 28, cy: 30, r: 12, fill: "#3a2614" }] },
    { id: "bed", label: "Cama de palha", size: 260, shapes: [{ shape: "rect", x: -30, y: -45, w: 60, h: 90, r: 6, fill: "#c2a868", stroke: "#6b5236" }] },
  ],
  npcIcons: [
    { id: "villager", label: "Aldeão", path: PERSON },
    { id: "innkeeper", label: "Taverneiro", path: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 18c0-4 3.1-7 7-7s7 3 7 7zM9 15h6v2H9z" },
    { id: "guard", label: "Guarda", path: "M12 2l7 3v6c0 5-3 9-7 11-4-2-7-6-7-11V5z" },
    { id: "monster", label: "Criatura", path: SKULL },
  ],
  itemIcons: [
    { id: "sword", label: "Espada", path: "M19 2l3 3-11 11 2 2-2 2-2-2-3 3-2-2 3-3-2-2 2-2 2 2z" },
    { id: "potion", label: "Poção", path: "M9 2h6v2h-1v4l5 8a4 4 0 0 1-3.5 6h-7A4 4 0 0 1 5 16l5-8V4H9z" },
    { id: "scroll", label: "Pergaminho", path: "M6 3h11a3 3 0 0 1 0 6h-1v10a3 3 0 0 1-3 3H5a3 3 0 0 1 0-6h1zm2 2v11h5a3 3 0 0 1 1 1V5z" },
    { id: "coin", label: "Moedas", path: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" },
    { id: "key", label: "Chave", path: KEY },
    { id: "chest", label: "Tesouro", path: CHEST },
    { id: "trap", label: "Armadilha", path: SKULL },
  ],
};

export const MODERN_KIT: MapKit = {
  theme: "modern",
  label: "Cidade moderna",
  background: "asphalt",
  houseFloor: "tile_floor",
  floors: [
    { id: "asphalt", label: "Asfalto", fill: "#2e3034", detail: "#3a3d42", pattern: "dots" },
    { id: "road_lines", label: "Faixa de rua", fill: "#2e3034", detail: "#d8c25a", pattern: "stripes" },
    { id: "sidewalk", label: "Calçada", fill: "#7d7b76", detail: "#67655f", pattern: "tiles" },
    { id: "tile_floor", label: "Piso frio", fill: "#b9b5ac", detail: "#a19d94", pattern: "tiles" },
    { id: "carpet", label: "Carpete", fill: "#6a3b3f", detail: "#5a3235", pattern: "dots" },
    { id: "parquet", label: "Taco de madeira", fill: "#8a6a45", detail: "#735638", pattern: "planks" },
    { id: "park_grass", label: "Grama de praça", fill: "#3f6138", detail: "#4d7244", pattern: "dots" },
  ],
  walls: [
    { id: "concrete", label: "Concreto", color: "#9a9a96", edge: "#4a4a47", thickness: 60 },
    { id: "brick", label: "Tijolo", color: "#94513c", edge: "#4c2519", thickness: 60 },
    { id: "glass", label: "Vidro", color: "#9fc6d6", edge: "#45707f", thickness: 30 },
    { id: "chain_fence", label: "Alambrado", color: "#8d949b", edge: "#5a6067", thickness: 20, dash: "30 20" },
    { id: "drywall", label: "Divisória", color: "#d3cfc6", edge: "#7c786f", thickness: 35 },
  ],
  doors: [
    { id: "door", label: "Porta comum", color: "#8a6a45" },
    { id: "rolling_shutter", label: "Porta de enrolar", color: "#7d848b" },
    { id: "glass_door", label: "Porta de vidro", color: "#9fc6d6" },
    { id: "hidden", label: "Passagem oculta", color: "#9a9a96", secret: true },
  ],
  props: [
    { id: "car", label: "Carro", size: 460, shapes: [{ shape: "rect", x: -22, y: -46, w: 44, h: 92, r: 12, fill: "#5a6f8a", stroke: "#1f2733" }, { shape: "rect", x: -16, y: -26, w: 32, h: 22, r: 4, fill: "#9fc6d6" }] },
    { id: "dumpster", label: "Caçamba", size: 300, shapes: [{ shape: "rect", x: -45, y: -25, w: 90, h: 50, r: 4, fill: "#3f6b45", stroke: "#1d3321" }] },
    { id: "streetlight", label: "Poste", size: 140, shapes: [{ shape: "circle", cx: 0, cy: 0, r: 18, fill: "#55595e", stroke: "#2a2c2f" }, { shape: "circle", cx: 0, cy: 0, r: 46, fill: "rgba(246,214,107,0.18)" }] },
    { id: "bench", label: "Banco", size: 240, shapes: [{ shape: "rect", x: -45, y: -14, w: 90, h: 28, r: 4, fill: "#7a5a3a", stroke: "#3a2614" }] },
    { id: "counter", label: "Balcão", size: 360, shapes: [{ shape: "rect", x: -48, y: -16, w: 96, h: 32, r: 3, fill: "#5d5650", stroke: "#2a2622" }] },
    { id: "tree", label: "Árvore", size: 380, shapes: [{ shape: "circle", cx: 0, cy: 0, r: 44, fill: "#2f4a2a", stroke: "#1f331c" }, { shape: "circle", cx: 10, cy: -10, r: 18, fill: "#3b5c34" }] },
    { id: "sofa", label: "Sofá", size: 280, shapes: [{ shape: "rect", x: -45, y: -22, w: 90, h: 44, r: 10, fill: "#4b4f6a", stroke: "#22243a" }, { shape: "rect", x: -40, y: -22, w: 80, h: 14, r: 6, fill: "#3a3d55" }] },
  ],
  npcIcons: [
    { id: "civilian", label: "Civil", path: PERSON },
    { id: "police", label: "Polícia", path: "M12 2l8 3-1 4H5L4 5zm-7 8h14v2a7 7 0 0 1-14 0zm-1 11c0-3 3.6-5 8-5s8 2 8 5z" },
    { id: "thug", label: "Capanga", path: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-7 18c0-4 3.1-7 7-7s7 3 7 7zM8 6h8v2H8z" },
    { id: "monster", label: "Criatura", path: SKULL },
  ],
  itemIcons: [
    { id: "phone", label: "Celular", path: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 3v13h8V5z" },
    { id: "gun", label: "Arma", path: "M2 7h18v4h-6l-2 2h-2l-1 6H5l1-6H2z" },
    { id: "key", label: "Chave", path: KEY },
    { id: "briefcase", label: "Maleta", path: "M9 3h6a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3V5a2 2 0 0 1 2-2zm0 3h6V5H9z" },
    { id: "cash", label: "Dinheiro", path: "M2 6h20v12H2zm10 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
    { id: "trap", label: "Perigo", path: SKULL },
  ],
};

/** O Um Anel uses the medieval kit; Vampire V5, Hunter and unknown systems use the city. */
export function themeForSystem(systemKey: string | null | undefined): MapTheme {
  return systemKey === "one-ring" ? "medieval" : "modern";
}

export function kitForSystem(systemKey: string | null | undefined): MapKit {
  return themeForSystem(systemKey) === "medieval" ? MEDIEVAL_KIT : MODERN_KIT;
}

export function findFloor(kit: MapKit, id: string | undefined): FloorMaterial {
  return kit.floors.find((item) => item.id === id) ?? kit.floors[0];
}

export function findWall(kit: MapKit, id: string | undefined): WallMaterial {
  return kit.walls.find((item) => item.id === id) ?? kit.walls[0];
}

export function findDoor(kit: MapKit, id: string | undefined): DoorStyle {
  return kit.doors.find((item) => item.id === id) ?? kit.doors[0];
}

export function findProp(kit: MapKit, id: string | undefined): PropDefinition | undefined {
  return kit.props.find((item) => item.id === id);
}

export function findPinIcon(kit: MapKit, id: string | undefined): PinIcon | undefined {
  return [...kit.npcIcons, ...kit.itemIcons].find((item) => item.id === id);
}
