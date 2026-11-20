"use client";

import { useEffect, useState } from "react";
import { applyThemeMode, readThemeMode, saveThemeMode, type ThemeMode } from "../lib/theme";

export function ThemeSwitcher() {
  const [mode, setMode] = useState<ThemeMode>("standard");

  useEffect(() => {
    const saved = readThemeMode();
    setMode(saved);
    applyThemeMode(saved);
  }, []);

  return (
    <label className="theme-switcher">
      <span>Tema</span>
      <select value={mode} onChange={(event) => {
        const next = event.target.value as ThemeMode;
        setMode(next);
        saveThemeMode(next);
      }}>
        <option value="standard">Padrão</option>
        <option value="hunter">Caçador</option>
        <option value="demon-lord">Demon Lord</option>
      </select>
    </label>
  );
}
