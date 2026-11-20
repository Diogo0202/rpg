export type ThemeMode = "standard" | "hunter" | "demon-lord";

const THEME_KEY = "rpg-atlas-theme-v1";
const THEME_MODES: ThemeMode[] = ["standard", "hunter", "demon-lord"];
/** Browser toolbar color per theme (meta theme-color). */
const THEME_COLORS: Record<ThemeMode, string> = { standard: "#1c2b28", hunter: "#17191B", "demon-lord": "#15130f" };

export function readThemeMode(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return THEME_MODES.find((mode) => mode === saved) ?? "standard";
  } catch {
    return "standard";
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[mode]);
}

export function saveThemeMode(mode: ThemeMode): boolean {
  applyThemeMode(mode);
  try {
    window.localStorage.setItem(THEME_KEY, mode);
    return true;
  } catch {
    return false;
  }
}
