"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import type { MapDocumentV2, MapPin, MapStructure } from "../../lib/map-document";
import { pointAlongPolyline, type Point } from "../../lib/map-geometry";
import { findDoor, findFloor, findPinIcon, findProp, findWall, type FloorMaterial, type MapKit } from "../../lib/map-kits";
import { initials } from "../../lib/portraits";
import styles from "./map-editor.module.css";

export type CanvasPointer = { kind: "down" | "move" | "up" | "double"; point: Point; shift: boolean; button: number };
export type CanvasDraft =
  | { type: "polyline"; points: Point[]; cursor: Point | null; closed: boolean }
  | { type: "rect"; from: Point; to: Point }
  | null;
export type LayerVisibility = { areas: boolean; shadows: boolean; walls: boolean; props: boolean; pins: boolean; grid: boolean };
export const ALL_LAYERS: LayerVisibility = { areas: true, shadows: true, walls: true, props: true, pins: true, grid: true };

export const PIN_RADIUS = { small: 110, medium: 150, large: 200 } as const;
const LEGACY_COLORS: Record<string, string> = { room: "#536b59", corridor: "#947a55", wall: "#252b28", water: "#365f69", forest: "#345541", mountain: "#77776c" };

type View = { x: number; y: number; scale: number };

type Props = {
  document: MapDocumentV2;
  kit: MapKit;
  portraitUrls: Record<string, string>;
  /** Portrait path per character sheet id (editor) or embedded in each pin (player view). */
  portraitPaths?: Record<string, string | null>;
  mode: "editor" | "player";
  selectedId?: string | null;
  draft?: CanvasDraft;
  layers?: LayerVisibility;
  movablePinIds?: Set<string>;
  label: string;
  onPointer?: (event: CanvasPointer) => void;
  /** Hand tool or two fingers pan; otherwise pointer events go to onPointer. */
  panMode?: boolean;
};

function patternMarkup(floor: FloorMaterial): ReactNode {
  const stroke = floor.detail;
  switch (floor.pattern) {
    case "planks": return <><rect width="240" height="240" fill={floor.fill} /><path d="M0 60H240M0 120H240M0 180H240M80 0V60M180 60V120M40 120V180M140 180V240" stroke={stroke} strokeWidth="6" /></>;
    case "bricks": return <><rect width="240" height="240" fill={floor.fill} /><path d="M0 0H240M0 80H240M0 160H240M60 0V80M180 0V80M120 80V160M0 80V160M60 160V240M180 160V240" stroke={stroke} strokeWidth="7" /></>;
    case "tiles": return <><rect width="240" height="240" fill={floor.fill} /><path d="M0 0H240V240M120 0V240M0 120H240" stroke={stroke} strokeWidth="5" fill="none" /></>;
    case "waves": return <><rect width="240" height="240" fill={floor.fill} /><path d="M0 60q30-30 60 0t60 0 60 0 60 0M0 180q30-30 60 0t60 0 60 0 60 0" stroke={stroke} strokeWidth="8" fill="none" /></>;
    case "stripes": return <><rect width="240" height="240" fill={floor.fill} /><rect x="0" y="108" width="140" height="24" fill={stroke} /></>;
    case "hatch": return <><rect width="240" height="240" fill={floor.fill} /><path d="M0 240L240 0M-60 60L60-60M180 300L300 180" stroke={stroke} strokeWidth="6" /></>;
    case "dots": return <><rect width="240" height="240" fill={floor.fill} /><circle cx="50" cy="60" r="10" fill={stroke} /><circle cx="170" cy="40" r="7" fill={stroke} /><circle cx="120" cy="150" r="9" fill={stroke} /><circle cx="210" cy="200" r="8" fill={stroke} /><circle cx="30" cy="200" r="6" fill={stroke} /></>;
    default: return <rect width="240" height="240" fill={floor.fill} />;
  }
}

const pointsAttr = (points: Point[]) => points.map(([x, y]) => `${x},${y}`).join(" ");

/** Top-down SVG renderer shared by the master's editor and the players' view. */
export function MapCanvas(props: Props) {
  const { document, kit, portraitUrls, portraitPaths = {}, mode, selectedId, draft, layers = ALL_LAYERS, movablePinIds, label, onPointer, panMode } = props;
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const pan = useRef<{ startX: number; startY: number; view: View } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; view: View } | null>(null);

  useEffect(() => { setView({ x: 0, y: 0, scale: 1 }); }, [document.width, document.height]);

  const width = document.width;
  const height = document.height;
  const viewWidth = width / view.scale;
  const viewHeight = height / view.scale;
  const walls = new Map(document.structures.filter((item) => item.type === "wall").map((item) => [item.id, item]));

  function toMap(clientX: number, clientY: number): Point {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return [0, 0];
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return [Math.min(width, Math.max(0, point.x)), Math.min(height, Math.max(0, point.y))];
  }

  function clampView(next: View): View {
    const scale = Math.min(8, Math.max(1, next.scale));
    return { scale, x: Math.min(width - width / scale, Math.max(0, next.x)), y: Math.min(height - height / scale, Math.max(0, next.y)) };
  }

  function zoomAt(clientX: number, clientY: number, factor: number) {
    const [mx, my] = toMap(clientX, clientY);
    setView((current) => {
      const scale = Math.min(8, Math.max(1, current.scale * factor));
      const ratio = current.scale / scale;
      return clampView({ scale, x: mx - (mx - current.x) * ratio, y: my - (my - current.y) * ratio });
    });
  }

  // React registers wheel handlers as passive, so preventDefault would not stop
  // the page from scrolling while zooming; attach a non-passive listener instead.
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomRef.current(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function emit(kind: CanvasPointer["kind"], event: ReactPointerEvent<SVGSVGElement>) {
    onPointer?.({ kind, point: toMap(event.clientX, event.clientY), shift: event.shiftKey, button: event.button });
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), view };
      pan.current = null;
      return;
    }
    if (panMode || event.button === 1) {
      pan.current = { startX: event.clientX, startY: event.clientY, view };
      return;
    }
    emit("down", event);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const factor = Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.distance);
      const base = pinch.current.view;
      setView(clampView({ ...base, scale: base.scale * factor }));
      return;
    }
    if (pan.current) {
      const rect = event.currentTarget.getBoundingClientRect();
      const base = pan.current.view;
      const dx = ((event.clientX - pan.current.startX) / Math.max(1, rect.width)) * (width / base.scale);
      const dy = ((event.clientY - pan.current.startY) / Math.max(1, rect.height)) * (height / base.scale);
      setView(clampView({ ...base, x: base.x - dx, y: base.y - dy }));
      return;
    }
    emit("move", event);
  }

  function onPointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pan.current) { pan.current = null; return; }
    emit("up", event);
  }

  function renderStructure(item: MapStructure): ReactNode {
    const selected = item.id === selectedId;
    const hiddenTag = mode === "editor" && item.gm_only ? styles.gmOnly : undefined;
    switch (item.type) {
      case "area": {
        const floor = findFloor(kit, item.material);
        return <g key={item.id} className={hiddenTag}>
          <polygon points={pointsAttr(item.points)} fill={`url(#${uid}-floor-${floor.id})`} stroke={selected ? "#f0c77f" : "rgba(0,0,0,.25)"} strokeWidth={selected ? 30 : 10} />
          {item.label && <text className={styles.areaLabel} x={item.points.reduce((sum, [x]) => sum + x, 0) / item.points.length} y={item.points.reduce((sum, [, y]) => sum + y, 0) / item.points.length}>{item.label}</text>}
        </g>;
      }
      case "shadow":
        return <polygon key={item.id} className={hiddenTag} points={pointsAttr(item.points)} fill="#05060a" fillOpacity={item.opacity}
          stroke={selected ? "#f0c77f" : mode === "editor" ? "rgba(240,199,127,.35)" : "none"} strokeWidth={selected ? 30 : 12} strokeDasharray={mode === "editor" ? "60 40" : undefined} />;
      case "wall": {
        const wall = findWall(kit, item.material);
        return <g key={item.id} className={hiddenTag}>
          {selected && <polyline points={pointsAttr(item.points)} fill="none" stroke="#f0c77f" strokeWidth={item.thickness + 50} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />}
          <polyline points={pointsAttr(item.points)} fill="none" stroke={wall.edge} strokeWidth={item.thickness + 14} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={wall.dash} />
          <polyline points={pointsAttr(item.points)} fill="none" stroke={wall.color} strokeWidth={item.thickness} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={wall.dash} />
        </g>;
      }
      case "door": {
        const wall = walls.get(item.wall_id);
        if (!wall || wall.type !== "wall") return null;
        const style = findDoor(kit, item.style);
        const { point: [x, y], angle } = pointAlongPolyline(wall.points, item.at);
        const degrees = (angle * 180) / Math.PI;
        const depth = wall.thickness + 24;
        if (style.secret && mode === "player") return null;
        return <g key={item.id} transform={`translate(${x} ${y}) rotate(${degrees})`} className={hiddenTag}>
          <rect x={-item.width / 2 - 10} y={-depth / 2 - 6} width={item.width + 20} height={depth + 12} fill={findFloor(kit, document.background).fill} />
          {item.state === "open"
            ? <><path d={`M${-item.width / 2} 0 A${item.width} ${item.width} 0 0 1 ${item.width / 2} ${-item.width}`} fill="none" stroke={style.color} strokeWidth="14" strokeDasharray="30 22" /><line x1={-item.width / 2} y1={0} x2={-item.width / 2} y2={-item.width} stroke={style.color} strokeWidth="26" /></>
            : <rect x={-item.width / 2} y={-depth / 4} width={item.width} height={depth / 2} rx="8" fill={style.color} stroke={selected ? "#f0c77f" : "#1b1712"} strokeWidth={selected ? 22 : 8} strokeDasharray={style.secret ? "30 20" : undefined} />}
          {item.state === "locked" && <circle cx="0" cy="0" r="26" fill="#d9b14a" stroke="#1b1712" strokeWidth="6" />}
          {selected && item.state === "open" && <circle cx="0" cy="0" r="40" fill="none" stroke="#f0c77f" strokeWidth="14" />}
        </g>;
      }
      case "prop": {
        const definition = findProp(kit, item.kind);
        if (!definition) return null;
        const factor = (definition.size * item.scale) / 100;
        return <g key={item.id} className={hiddenTag} transform={`translate(${item.x} ${item.y}) rotate(${item.rotation}) scale(${factor})`}>
          {definition.shapes.map((shape, index) => shape.shape === "rect"
            ? <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r} fill={shape.fill} stroke={shape.stroke} strokeWidth={2} />
            : shape.shape === "circle"
              ? <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} stroke={shape.stroke} strokeWidth={2} />
              : <line key={index} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={shape.stroke} strokeWidth={shape.width} />)}
          {selected && <circle r="60" fill="none" stroke="#f0c77f" strokeWidth={6 / Math.max(0.2, factor / 3)} />}
        </g>;
      }
    }
  }

  function renderPin(pin: MapPin): ReactNode {
    const radius = PIN_RADIUS[pin.size ?? "medium"];
    const ring = pin.ring_color ?? (pin.kind === "character" ? "#d6b15d" : pin.kind === "npc" ? "#a16b8d" : "#83a89a");
    const path = pin.kind === "character" ? (pin.portrait_path ?? (pin.sheet_id ? portraitPaths[pin.sheet_id] : null)) : null;
    const url = path ? portraitUrls[path] : undefined;
    const icon = pin.kind === "character" ? undefined : findPinIcon(kit, pin.icon);
    const selected = pin.id === selectedId;
    const movable = movablePinIds?.has(pin.id);
    return <g key={pin.id} transform={`translate(${pin.x} ${pin.y})`} className={`${styles.pin} ${mode === "editor" && pin.gm_only ? styles.gmOnly : ""} ${movable ? styles.movable : ""}`}>
      <title>{pin.label}</title>
      <circle r={radius + 22} fill="rgba(0,0,0,.45)" />
      {url
        ? <><clipPath id={`${uid}-clip-${pin.id}`}><circle r={radius} /></clipPath><image href={url} x={-radius} y={-radius} width={radius * 2} height={radius * 2} clipPath={`url(#${uid}-clip-${pin.id})`} preserveAspectRatio="xMidYMid slice" /></>
        : <circle r={radius} fill={pin.kind === "item" ? "#22302b" : "#2a2230"} />}
      {!url && pin.kind === "character" && <text className={styles.pinInitials} fontSize={radius * 0.8}>{initials(pin.label)}</text>}
      {icon && <path d={icon.path} fill="#f2eee8" transform={`translate(${-radius * 0.62} ${-radius * 0.62}) scale(${(radius * 1.24) / 24})`} />}
      <circle r={radius} fill="none" stroke={ring} strokeWidth={pin.kind === "item" ? 22 : 30} strokeDasharray={pin.kind === "item" ? "40 18" : undefined} />
      {selected && <circle r={radius + 50} fill="none" stroke="#f0c77f" strokeWidth="22" />}
      <text className={styles.pinLabel} y={radius + 110} fontSize="110">{pin.label}</text>
    </g>;
  }

  const floors = kit.floors;
  const legacy = document.legacy;
  const background = findFloor(kit, document.background);
  return <div className={styles.canvasFrame}>
    {view.scale > 1 && <button type="button" className={styles.resetView} onClick={() => setView({ x: 0, y: 0, scale: 1 })}>Ajustar vista</button>}
    <svg
    ref={svgRef}
    className={`${styles.canvas} ${panMode ? styles.panning : ""}`}
    viewBox={`${view.x} ${view.y} ${viewWidth} ${viewHeight}`}
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label={label}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerUp}
    onDoubleClick={(event) => onPointer?.({ kind: "double", point: toMap(event.clientX, event.clientY), shift: event.shiftKey, button: 0 })}
  >
    <defs>
      {floors.map((floor) => <pattern key={floor.id} id={`${uid}-floor-${floor.id}`} width="240" height="240" patternUnits="userSpaceOnUse">{patternMarkup(floor)}</pattern>)}
      <pattern id={`${uid}-grid`} width={document.grid.size} height={document.grid.size} patternUnits="userSpaceOnUse">
        <path d={`M${document.grid.size} 0H0V${document.grid.size}`} fill="none" stroke="rgba(230,236,226,.18)" strokeWidth="8" />
      </pattern>
    </defs>
    <rect width={width} height={height} fill={`url(#${uid}-floor-${background.id})`} />
    {legacy && <g aria-hidden="true">{legacy.terrain.map((cell) => {
      const cellWidth = width / legacy.width;
      const cellHeight = height / legacy.height;
      const color = LEGACY_COLORS[cell.kind];
      return color ? <rect key={`${cell.x}-${cell.y}`} x={cell.x * cellWidth} y={cell.y * cellHeight} width={cellWidth + 1} height={cellHeight + 1} fill={color} /> : null;
    })}</g>}
    {layers.areas && document.structures.filter((item) => item.type === "area").map(renderStructure)}
    {layers.grid && document.grid.visible && <rect width={width} height={height} fill={`url(#${uid}-grid)`} pointerEvents="none" />}
    {layers.shadows && document.structures.filter((item) => item.type === "shadow").map(renderStructure)}
    {layers.walls && document.structures.filter((item) => item.type === "wall").map(renderStructure)}
    {layers.walls && document.structures.filter((item) => item.type === "door").map(renderStructure)}
    {layers.props && document.structures.filter((item) => item.type === "prop").map(renderStructure)}
    {mode === "editor" && legacy?.markers.map((marker) => <circle key={marker.id} cx={marker.x} cy={(marker.y / 10_000) * height} r="70" fill={marker.color} stroke="#111714" strokeWidth="14"><title>{marker.label}</title></circle>)}
    {layers.pins && document.pins.map(renderPin)}
    {draft?.type === "polyline" && <polyline className={styles.draft}
      points={pointsAttr(draft.cursor ? [...draft.points, draft.cursor] : draft.points)}
      fill={draft.closed ? "rgba(240,199,127,.12)" : "none"} />}
    {draft?.type === "polyline" && draft.points.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="45" className={styles.draftPoint} />)}
    {draft?.type === "rect" && <rect className={styles.draft} x={Math.min(draft.from[0], draft.to[0])} y={Math.min(draft.from[1], draft.to[1])}
      width={Math.abs(draft.to[0] - draft.from[0])} height={Math.abs(draft.to[1] - draft.from[1])} fill="rgba(240,199,127,.12)" />}
  </svg>
  </div>;
}
