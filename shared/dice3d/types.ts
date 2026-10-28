/** Dice engine contracts. Kept free of DOM and React so the simulation runs in Node tests. */
export type DieKind = "d20" | "d6" | "d10";

/** Why the die is on the table; the style colors the medallion rim by role. */
export type DieRole = "main" | "boon" | "bane" | "fate" | "hunger" | "desperation";

/** One die to throw and the face the server already decided it must land on. */
export type DieRequest = {
  kind: DieKind;
  value: number;
  role: DieRole;
  /** False for boon/bane dice that do not count (only the highest d6 does). */
  kept?: boolean;
};

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Visual identity of a system's dice set. Colors are CSS hex strings. */
export type DiceStyle = {
  id: string;
  label: string;
  metal: string;
  metalness: number;
  roughness: number;
  medallion: string;
  numeral: string;
  splatter: string;
  /** Splatter density from 0 to 1. */
  splatterAmount: number;
  rims: Record<DieRole, string>;
  /** Spike length relative to the die radius; 0 disables spikes. */
  spikes: number;
  /** Per-role overrides of the die body, for sets whose dice differ in finish (V5 Hunger dice). */
  bodies?: Partial<Record<DieRole, DieBody>>;
};

/** Painted look of one die role: base color, speckle colors and the engraved glyph color. */
export type DieBody = {
  color: string;
  /** Fine speckles over the face: a matte grain on black, glitter on red. */
  speckle: string[];
  speckleAmount: number;
  glyph: string;
  metalness: number;
  roughness: number;
};

/** Aim of a throw: direction on the table (0 = toward +x, screen right) and strength from 0 to 1. */
export type Aim = { angle: number; power: number };
