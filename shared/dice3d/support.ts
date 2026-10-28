/** Feature checks kept apart from tray.ts so callers can decide without loading three.js. */
export function canUseWebGL(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof window === "undefined" || (!("WebGLRenderingContext" in window) && !("WebGL2RenderingContext" in window))) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
