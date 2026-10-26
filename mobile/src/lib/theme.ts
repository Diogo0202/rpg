export type ThemeMode = "standard" | "dark" | "hunter" | "demon-lord";

const THEME_KEY = "rpg-atlas-theme-v1";
const THEME_MODES: ThemeMode[] = ["standard", "dark", "hunter", "demon-lord"];
/** Classes a theme sets on <html>; "standard" sets none. */
const THEME_CLASSES: ThemeMode[] = ["dark", "hunter", "demon-lord"];
/** Browser toolbar color per theme (meta theme-color). */
const THEME_COLORS: Record<ThemeMode, string> = { standard: "#1b3325", dark: "#1b3325", hunter: "#17191B", "demon-lord": "#15130f" };

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "standard";
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return THEME_MODES.find((mode) => mode === saved) ?? "standard";
  } catch {
    return "standard";
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  for (const name of THEME_CLASSES) document.documentElement.classList.toggle(name, mode === name);
  document.documentElement.style.colorScheme = mode === "dark" ? "dark" : "light";
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
