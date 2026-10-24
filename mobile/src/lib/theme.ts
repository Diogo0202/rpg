export type ThemeMode = "standard" | "dark";

const THEME_KEY = "rpg-atlas-theme-v1";

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "standard";
  try {
    return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "standard";
  } catch {
    return "standard";
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", mode === "dark");
  document.documentElement.style.colorScheme = mode === "dark" ? "dark" : "light";
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
