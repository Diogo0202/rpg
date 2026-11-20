import { CanvasTexture, SRGBColorSpace } from "three";
import { seededRandom } from "./random.ts";
import { v5Glyph } from "./v5.ts";
import type { DiceStyle, DieBody, DieKind, DieRole } from "./types.ts";

/**
 * Face atlas drawn on a canvas: aged metal, blood splatter and a recessed medallion with the
 * numeral. Browser only. Cells are laid out in a grid; geometry UVs point each face at its cell.
 */
export const ATLAS_SIZE = 1024;
export const ATLAS_GRID: Record<DieKind, [number, number]> = { d20: [5, 4], d6: [3, 2], d10: [4, 3] };

function splatter(context: CanvasRenderingContext2D, x: number, y: number, size: number, style: DiceStyle, random: () => number) {
  const drops = Math.round(14 * style.splatterAmount);
  for (let index = 0; index < drops; index++) {
    const radius = size * (0.008 + random() ** 3 * 0.05);
    context.globalAlpha = 0.55 + random() * 0.4;
    context.fillStyle = style.splatter;
    context.beginPath();
    context.ellipse(x + random() * size, y + random() * size, radius, radius * (0.6 + random() * 0.6), random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

function cell(context: CanvasRenderingContext2D, kind: DieKind, x: number, y: number, size: number, value: number, rim: string, style: DiceStyle, random: () => number) {
  const metal = context.createLinearGradient(x, y, x + size, y + size);
  metal.addColorStop(0, "#d7d3cc");
  metal.addColorStop(0.5, style.metal);
  metal.addColorStop(1, "#4b4845");
  context.fillStyle = metal;
  context.fillRect(x, y, size, size);
  // Engraved filigree scratches.
  context.strokeStyle = "#2a2826";
  context.lineWidth = size * 0.006;
  for (let index = 0; index < 10; index++) {
    context.globalAlpha = 0.25 + random() * 0.3;
    context.beginPath();
    const startX = x + random() * size;
    const startY = y + random() * size;
    context.moveTo(startX, startY);
    context.quadraticCurveTo(startX + (random() - 0.5) * size * 0.4, startY + (random() - 0.5) * size * 0.4, startX + (random() - 0.5) * size * 0.3, startY + (random() - 0.5) * size * 0.3);
    context.stroke();
  }
  context.globalAlpha = 1;
  splatter(context, x, y, size, style, random);

  // Triangle faces put their incircle a third of the way up; squares centre it.
  const centerX = x + size / 2;
  const centerY = y + size * (kind === "d20" ? 0.6 : 0.5);
  const radius = size * (kind === "d20" ? 0.2 : 0.3);
  context.fillStyle = style.medallion;
  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = rim;
  context.lineWidth = radius * 0.16;
  context.stroke();
  context.lineWidth = radius * 0.05;
  context.beginPath();
  context.arc(centerX, centerY, radius * 0.8, 0, Math.PI * 2);
  context.stroke();
  splatter(context, centerX - radius, centerY - radius, radius * 2, { ...style, splatterAmount: style.splatterAmount * 0.5 }, random);

  const label = kind === "d20" && (value === 6 || value === 9) ? `${value}.` : String(value);
  context.fillStyle = style.numeral;
  context.font = `700 ${Math.round(radius * (label.length > 1 ? 0.95 : 1.15))}px Georgia, "Times New Roman", serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "#000";
  context.shadowBlur = radius * 0.12;
  context.fillText(label, centerX, centerY + radius * 0.05);
  context.shadowBlur = 0;
}

function dot(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

/** Ankh centered on (x, y); `unit` is the half height. `crown` adds three points over the loop. */
function ankh(context: CanvasRenderingContext2D, x: number, y: number, unit: number, crown: boolean) {
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = unit * 0.2;
  context.beginPath();
  context.ellipse(x, y - unit * 0.42, unit * 0.27, unit * 0.34, 0, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(x, y - unit * 0.08);
  context.lineTo(x, y + unit * 0.85);
  context.moveTo(x - unit * 0.48, y + unit * 0.14);
  context.lineTo(x + unit * 0.48, y + unit * 0.14);
  context.stroke();
  if (!crown) return;
  context.beginPath();
  context.moveTo(x - unit * 0.34, y - unit * 0.84);
  context.lineTo(x - unit * 0.3, y - unit * 1.12);
  context.lineTo(x - unit * 0.12, y - unit * 0.92);
  context.lineTo(x, y - unit * 1.2);
  context.lineTo(x + unit * 0.12, y - unit * 0.92);
  context.lineTo(x + unit * 0.3, y - unit * 1.12);
  context.lineTo(x + unit * 0.34, y - unit * 0.84);
  context.closePath();
  context.fill();
}

/** Skull; `hollow` is the die body color, used for the eye sockets and the nose. */
function skull(context: CanvasRenderingContext2D, x: number, y: number, unit: number, hollow: string) {
  dot(context, x, y - unit * 0.2, unit * 0.62);
  context.beginPath();
  context.roundRect(x - unit * 0.34, y + unit * 0.2, unit * 0.68, unit * 0.52, unit * 0.1);
  context.fill();
  context.fillStyle = hollow;
  dot(context, x - unit * 0.24, y - unit * 0.14, unit * 0.18);
  dot(context, x + unit * 0.24, y - unit * 0.14, unit * 0.18);
  context.beginPath();
  context.moveTo(x, y + unit * 0.02);
  context.lineTo(x - unit * 0.09, y + unit * 0.2);
  context.lineTo(x + unit * 0.09, y + unit * 0.2);
  context.fill();
  context.strokeStyle = hollow;
  context.lineWidth = unit * 0.05;
  for (const offset of [-0.17, 0, 0.17]) {
    context.beginPath();
    context.moveTo(x + unit * offset, y + unit * 0.4);
    context.lineTo(x + unit * offset, y + unit * 0.72);
    context.stroke();
  }
}

/** One V5 face: grainy or glittering body, then the engraved glyph at the cell center. */
function v5Cell(context: CanvasRenderingContext2D, x: number, y: number, size: number, value: number, role: DieRole, body: DieBody, random: () => number) {
  context.fillStyle = body.color;
  context.fillRect(x, y, size, size);
  const specks = Math.round(900 * body.speckleAmount);
  for (let index = 0; index < specks; index++) {
    const glitter = role === "hunger" && index % 9 === 0;
    context.globalAlpha = glitter ? 0.9 : 0.35 + random() * 0.4;
    context.fillStyle = body.speckle[Math.floor(random() * body.speckle.length)];
    dot(context, x + random() * size, y + random() * size, size * (glitter ? 0.006 + random() * 0.006 : 0.003 + random() * 0.003));
  }
  context.globalAlpha = 1;
  const glyph = v5Glyph(role, value);
  context.fillStyle = body.glyph;
  context.strokeStyle = body.glyph;
  const unit = size * 0.24;
  const cx = x + size / 2;
  const cy = y + size / 2;
  if (glyph === "skull") skull(context, cx, cy, unit, body.color);
  else ankh(context, cx, cy + (glyph === "crowned-ankh" ? unit * 0.12 : 0), unit * (glyph === "crowned-ankh" ? 0.8 : 0.95), glyph === "crowned-ankh");
}

/** Original Hunter-inspired stencil: readable value with a cut flame on 10 and an alert on 1. */
function hunterCell(context: CanvasRenderingContext2D, x: number, y: number, size: number, value: number, body: DieBody, random: () => number) {
  const shade = context.createLinearGradient(x, y, x + size, y + size);
  shade.addColorStop(0, body.color);
  shade.addColorStop(0.52, body.color);
  shade.addColorStop(1, body.speckle[1] ?? body.color);
  context.fillStyle = shade;
  context.fillRect(x, y, size, size);
  for (let index = 0; index < 220 * body.speckleAmount; index++) {
    context.globalAlpha = 0.14 + random() * 0.16;
    context.fillStyle = body.speckle[0];
    dot(context, x + random() * size, y + random() * size, size * 0.002);
  }
  context.globalAlpha = 1;
  const cx = x + size / 2;
  const cy = y + size / 2;
  context.fillStyle = body.glyph;
  context.strokeStyle = body.glyph;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `900 ${Math.round(size * (value === 10 ? 0.38 : 0.48))}px system-ui`;
  context.fillText(String(value), cx, cy + size * 0.07);
  context.lineWidth = size * 0.025;
  context.beginPath();
  context.moveTo(cx - size * 0.19, cy + size * 0.31);
  context.lineTo(cx + size * 0.16, cy + size * 0.31);
  context.stroke();
  if (value === 1 || value === 10) {
    context.font = `900 ${Math.round(size * 0.19)}px system-ui`;
    context.fillText(value === 1 ? "!" : "✦", cx, cy - size * 0.29);
  }
}

const atlasCache = new Map<string, CanvasTexture>();

/** Atlas for one kind and rim role; cells follow the solid's face order. */
export function faceAtlas(kind: DieKind, values: number[], role: DieRole, style: DiceStyle): CanvasTexture {
  const key = `${style.id}:${kind}:${role}`;
  const cached = atlasCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS_SIZE;
  const context = canvas.getContext("2d")!;
  const [columns, rows] = ATLAS_GRID[kind];
  const size = ATLAS_SIZE / Math.max(columns, rows);
  const random = seededRandom(kind === "d20" ? 2020 : 66);
  const body = style.bodies?.[role];
  values.forEach((value, index) => {
    const x = (index % columns) * size;
    const y = Math.floor(index / columns) * size;
    if (kind === "d10" && body && style.id === "hunter") hunterCell(context, x, y, size, value, body, random);
    else if (kind === "d10" && body) v5Cell(context, x, y, size, value, role, body, random);
    else cell(context, kind, x, y, size, value, style.rims[role], style, random);
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  atlasCache.set(key, texture);
  return texture;
}

/** UV rectangle of a face cell, as [u0, v0, u1, v1] in texture space (v up). */
export function cellRect(kind: DieKind, index: number): [number, number, number, number] {
  const [columns, rows] = ATLAS_GRID[kind];
  const size = 1 / Math.max(columns, rows);
  const u0 = (index % columns) * size;
  const top = Math.floor(index / columns) * size;
  return [u0, 1 - top - size, u0 + size, 1 - top];
}
