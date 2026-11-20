import type { DiceStyle } from "./types.ts";

/** Dice sets per game system. A new system adds an entry here and a mapper like sotdl.ts. */
export const DICE_STYLES: Record<string, DiceStyle> = {
  "shadow-demon-lord": {
    id: "shadow-demon-lord",
    label: "Ferro profano",
    metal: "#8d8a86",
    metalness: 0.92,
    roughness: 0.38,
    medallion: "#1b1917",
    numeral: "#d9d5ce",
    splatter: "#8f1d14",
    splatterAmount: 0.55,
    rims: { main: "#b9b4ab", boon: "#c9a14a", bane: "#a8241a", fate: "#b9b4ab", hunger: "#a8241a", desperation: "#a8241a" },
    spikes: 0.42,
  },
  // Official V5 set: matte black dice with fine grain, glossy red Hunger dice with glitter,
  // glyphs engraved in the opposite color.
  "vampire-v5": {
    id: "vampire-v5",
    label: "Dados oficiais V5",
    metal: "#0d0d0f",
    metalness: 0,
    roughness: 0.85,
    medallion: "#0d0d0f",
    numeral: "#c4161c",
    splatter: "#8f1d14",
    splatterAmount: 0,
    rims: { main: "#c4161c", boon: "#c4161c", bane: "#c4161c", fate: "#c4161c", hunger: "#120405", desperation: "#120405" },
    spikes: 0,
    bodies: {
      main: { color: "#0d0d0f", speckle: ["#26262b", "#1a1a1e", "#34343a"], speckleAmount: 1, glyph: "#d3161e", metalness: 0, roughness: 0.88 },
      hunger: { color: "#b3121a", speckle: ["#ff7a68", "#ffd9d2", "#ff3c32", "#7d0a10"], speckleAmount: 1, glyph: "#140506", metalness: 0.3, roughness: 0.2 },
    },
  },
  hunter: {
    id: "hunter",
    label: "Caçador: laranja e Desespero preto",
    metal: "#ed6b23",
    metalness: 0,
    roughness: 0.58,
    medallion: "#ed6b23",
    numeral: "#18191b",
    splatter: "#1b1b1d",
    splatterAmount: 0,
    rims: { main: "#17191c", boon: "#17191c", bane: "#17191c", fate: "#17191c", hunger: "#17191c", desperation: "#f47a2f" },
    spikes: 0,
    bodies: {
      main: { color: "#f0782c", speckle: ["#ffa456", "#c9541d"], speckleAmount: 0.32, glyph: "#161719", metalness: 0.05, roughness: 0.62 },
      desperation: { color: "#17191c", speckle: ["#343538", "#282a2d"], speckleAmount: 0.4, glyph: "#f47a2f", metalness: 0.08, roughness: 0.58 },
    },
  },
};

export const DEFAULT_DICE_STYLE = DICE_STYLES["shadow-demon-lord"];

export function diceStyleFor(systemKey: string | null | undefined): DiceStyle {
  return (systemKey && DICE_STYLES[systemKey]) || DEFAULT_DICE_STYLE;
}

/** Hunger dice need their own role on the style; the rim colors above are only for SotDL. */
export function bodyFor(style: DiceStyle, role: keyof NonNullable<DiceStyle["bodies"]>) {
  return style.bodies?.[role];
}
