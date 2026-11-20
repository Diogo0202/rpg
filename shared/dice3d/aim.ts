import type { Aim } from "./types.ts";

/** One pointer sample while dragging, in CSS pixels and milliseconds. */
export type PointerSample = { x: number; y: number; t: number };

/** Drags shorter than this are taps and throw with the default aim. */
export const TAP_DISTANCE_PX = 14;
/** Only the end of the drag counts: where the finger was heading when it let go. */
export const AIM_WINDOW_MS = 140;
/** Speed (px/ms) of a full-power flick. */
export const FULL_POWER_SPEED = 2;
export const MIN_POWER = 0.3;

/**
 * Turns the drag into a throw. The camera looks down with screen right = +x and screen down = +z,
 * so the screen vector maps straight to the table. Returns null for a tap or a hold without
 * movement, which the tray throws with its default aim. Pure, so it runs in Node tests.
 */
export function aimFromSamples(samples: readonly PointerSample[]): Aim | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (Math.hypot(last.x - first.x, last.y - first.y) < TAP_DISTANCE_PX) return null;
  let from = last;
  for (let index = samples.length - 2; index >= 0 && last.t - samples[index].t <= AIM_WINDOW_MS; index--) from = samples[index];
  if (from === last) from = samples[samples.length - 2];
  const dx = last.x - from.x;
  const dy = last.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return null;
  const speed = distance / Math.max(last.t - from.t, 16);
  return { angle: Math.atan2(dy, dx), power: Math.min(1, Math.max(MIN_POWER, speed / FULL_POWER_SPEED)) };
}

/**
 * Listens on `element` for a press, drag and release (mouse, touch and pen through pointer
 * events) and reports the aim once, on release. Returns a function that removes the listeners.
 * Keyboard users throw from a button, so this is only the pointer path.
 */
export function attachThrowGesture(element: HTMLElement, onThrow: (aim: Aim | null) => void): () => void {
  let samples: PointerSample[] = [];
  let active: number | null = null;
  const push = (event: PointerEvent) => samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
  const down = (event: PointerEvent) => {
    if (active !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    // Buttons on top of the tray keep their own click.
    if (event.target instanceof Element && event.target.closest("button")) return;
    active = event.pointerId;
    samples = [];
    push(event);
    element.setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId === active) push(event);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== active) return;
    push(event);
    active = null;
    element.releasePointerCapture?.(event.pointerId);
    onThrow(aimFromSamples(samples));
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === active) active = null;
  };
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", cancel);
  return () => {
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", cancel);
  };
}
