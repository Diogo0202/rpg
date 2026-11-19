/**
 * Browser-only: rasterizes the map SVG (as drawn by MapCanvas) into a PNG.
 * CSS-module styles are inlined and remote portraits are embedded as data
 * URLs (or dropped when they cannot be read), so the canvas is never tainted.
 */

const STYLE_PROPERTIES = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "paint-order"];
const SVG_NS = "http://www.w3.org/2000/svg";

function inlineStyles(source: Element, target: Element) {
  if (source.getAttribute("class")) {
    const computed = window.getComputedStyle(source);
    const declarations = STYLE_PROPERTIES.map((property) => `${property}:${computed.getPropertyValue(property)}`).filter((item) => !item.endsWith(":"));
    target.setAttribute("style", `${declarations.join(";")};${target.getAttribute("style") ?? ""}`);
    target.removeAttribute("class");
  }
  const sourceChildren = source.children;
  const targetChildren = target.children;
  for (let index = 0; index < sourceChildren.length && index < targetChildren.length; index += 1) inlineStyles(sourceChildren[index], targetChildren[index]);
}

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/** Renders the whole map (ignoring the current zoom) at `pixelWidth` px wide. */
export async function rasterizeMapSvg(svg: SVGSVGElement, mapWidth: number, mapHeight: number, pixelWidth: number, pixelHeight = Math.round((pixelWidth * mapHeight) / mapWidth)): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("viewBox", `0 0 ${mapWidth} ${mapHeight}`);
  clone.setAttribute("width", String(pixelWidth));
  clone.setAttribute("height", String(pixelHeight));
  clone.setAttribute("preserveAspectRatio", "none");
  clone.removeAttribute("style");
  for (const image of Array.from(clone.querySelectorAll("image"))) {
    const href = image.getAttribute("href") ?? image.getAttribute("xlink:href") ?? "";
    if (href.startsWith("data:")) continue;
    const inline = href ? await toDataUrl(href) : null;
    if (inline) image.setAttribute("href", inline);
    else image.remove();
  }
  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const picture = new Image();
    picture.decoding = "async";
    await new Promise<void>((resolve, reject) => { picture.onload = () => resolve(); picture.onerror = () => reject(new Error("Falha ao desenhar o SVG do mapa.")); picture.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("O navegador não ofereceu um canvas 2D.");
    context.fillStyle = "#0e0f12";
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.drawImage(picture, 0, 0, pixelWidth, pixelHeight);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Não foi possível gerar o PNG.")), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const IMPORT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/avif"]);
const IMPORT_MAX_FILE = 25 * 1024 * 1024;

async function loadPicture(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const picture = new Image();
    picture.decoding = "async";
    await new Promise<void>((resolve, reject) => { picture.onload = () => resolve(); picture.onerror = () => reject(new Error("O navegador não conseguiu abrir esta imagem.")); picture.src = url; });
    return picture;
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Reads a picture chosen by the user and re-encodes it (JPEG, shrinking side
 * and quality as needed) until the data URL fits in `maxChars`.
 */
export async function importMapImage(file: File, maxChars: number): Promise<{ data: string; width: number; height: number; name: string }> {
  if (!IMPORT_TYPES.has(file.type)) throw new Error("Escolha uma imagem PNG, JPEG, WebP, GIF, BMP ou AVIF.");
  if (file.size > IMPORT_MAX_FILE) throw new Error("A imagem passa de 25 MB. Reduza o arquivo antes de importar.");
  const picture = await loadPicture(file);
  const sourceWidth = picture.naturalWidth, sourceHeight = picture.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("A imagem não tem dimensões válidas.");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("O navegador não ofereceu um canvas 2D.");
  for (const side of [2400, 2048, 1600, 1280, 1024, 800]) {
    const scale = Math.min(1, side / Math.max(sourceWidth, sourceHeight));
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    context.fillStyle = "#0e0f12";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.72, 0.6]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= maxChars) return { data, width: canvas.width, height: canvas.height, name: file.name.slice(0, 160) };
    }
  }
  throw new Error("Não foi possível reduzir a imagem ao limite do mapa.");
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
