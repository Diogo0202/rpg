// Estante de grimórios: base visual comum para sistemas e fichas na web e no mobile.
// Este arquivo não depende de React; cada app monta a marcação com as classes de grimoire-shelf.css.

export const BOOKS_PER_SHELF = 4;

export type GrimoireCover = {
  cloth: string;
  clothDeep: string;
  spine: string;
  accent: string;
  mark: string;
  engine: string;
  genre: string;
  code: string;
  /** Ilustração da capa; quando falha ao carregar, o livro volta à capa de couro. */
  art?: string;
};

type Leather = Pick<GrimoireCover, "cloth" | "clothDeep" | "spine" | "accent">;

const LEATHER = {
  crimson: { cloth: "#7f1d1d", clothDeep: "#2a0404", spine: "#3b0707", accent: "#fbbf24" },
  emerald: { cloth: "#065f46", clothDeep: "#021f18", spine: "#02241c", accent: "#34d399" },
  sapphire: { cloth: "#1e1b4b", clothDeep: "#090d1a", spine: "#0b1024", accent: "#93c5fd" },
  obsidian: { cloth: "#422006", clothDeep: "#09090b", spine: "#121215", accent: "#f59e0b" },
  amethyst: { cloth: "#581c87", clothDeep: "#1e0a3c", spine: "#240c4f", accent: "#e879f9" },
  copper: { cloth: "#7c2d12", clothDeep: "#270b04", spine: "#361005", accent: "#fdba74" },
} satisfies Record<string, Leather>;

const SYSTEM_COVERS: Record<string, GrimoireCover> = {
  "vampire-v5": { ...LEATHER.crimson, mark: "V5", engine: "Parada d10", genre: "Horror pessoal", code: "SYS-V5", art: coverArt("vampire-v5") },
  "vampire-v3": { ...LEATHER.amethyst, mark: "V3", engine: "Parada d10", genre: "Horror gótico", code: "SYS-V3", art: coverArt("vampire-v3") },
  hunter: { ...LEATHER.emerald, mark: "C", engine: "Parada d10", genre: "Caça e revanche", code: "SYS-CAÇ", art: coverArt("hunter") },
  "one-ring": { ...LEATHER.sapphire, mark: "1A", engine: "d12 + d6", genre: "Terra-média", code: "SYS-1A", art: coverArt("one-ring") },
  "shadow-demon-lord": { ...LEATHER.copper, mark: "SD", engine: "Sistema d20", genre: "Fantasia sombria", code: "SYS-SDL", art: coverArt("shadow-demon-lord") },
  "demon-the-fallen": { ...LEATHER.obsidian, mark: "DQ", engine: "Parada d10", genre: "Anjos caídos", code: "SYS-DQ", art: coverArt("demon-the-fallen") },
};

/** Ilustração da capa, servida da pasta public/covers de cada app (web e mobile). */
function coverArt(systemKey: string): string {
  return `/covers/${systemKey}.jpg`;
}

const FALLBACK: Leather[] = Object.values(LEATHER);

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value;
}

/** Capa do sistema; chaves desconhecidas (modelos próprios da mesa) recebem um couro estável pelo texto. */
export function grimoireCover(systemKey?: string | null, seed = ""): GrimoireCover {
  const known = systemKey ? SYSTEM_COVERS[systemKey] : undefined;
  if (known) return known;
  const source = systemKey || seed || "modelo";
  const leather = FALLBACK[hash(source) % FALLBACK.length];
  const initials = (seed || source).split(/[\s-]+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
  return { ...leather, mark: initials || "✦", engine: "Modelo da mesa", genre: "Sistema próprio", code: "TOMO" };
}

/** Variáveis CSS lidas por grimoire-shelf.css. */
export function grimoireStyle(cover: GrimoireCover): Record<string, string> {
  return {
    "--grimoire-cloth": cover.cloth,
    "--grimoire-cloth-deep": cover.clothDeep,
    "--grimoire-spine": cover.spine,
    "--grimoire-accent": cover.accent,
  };
}

export function shelvesOf<T>(items: T[], size = BOOKS_PER_SHELF): T[][] {
  const shelves: T[][] = [];
  for (let index = 0; index < items.length; index += size) shelves.push(items.slice(index, index + size));
  return shelves.length ? shelves : [[]];
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
export function shelfNumeral(position: number): string {
  return ROMAN[position - 1] ?? String(position);
}

/** Verdadeiro quando o ambiente consegue animar (jsdom e movimento reduzido abrem na hora). */
export function canAnimateGrimoire(book: HTMLElement): boolean {
  if (typeof book.getAnimations !== "function" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Puxa o livro da estante, abre a capa e resolve quando a animação termina. */
export async function openGrimoire(book: HTMLElement): Promise<void> {
  const shelf = book.closest<HTMLElement>(".grimoire-case");
  book.dataset.opening = "true";
  if (shelf) shelf.dataset.active = "true";
  const cover = book.querySelector(".grimoire-cover");
  const animations = cover?.getAnimations?.() ?? [];
  await Promise.allSettled(animations.map((animation) => animation.finished));
}

export function closeGrimoire(book: HTMLElement): void {
  delete book.dataset.opening;
  const shelf = book.closest<HTMLElement>(".grimoire-case");
  if (shelf) delete shelf.dataset.active;
}
