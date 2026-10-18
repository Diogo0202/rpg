export function checkedAudioUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return trimmed;
  } catch {
    return null;
  }
}
