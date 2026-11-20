import assert from "node:assert/strict";
import { test } from "node:test";
import { pointInPolygon } from "../lib/map-geometry.ts";
import { createEmptyDocument, parseMapDocument, validateMapDocument } from "../lib/map-document.ts";
import {
  blockingSegments, fogCellRect, fogRegionsFor, hasLineOfSight, pointRevealed, redactForViewer, splitPolylineAtGaps, viewerMasks, visibilityPolygon,
} from "../lib/map-visibility.ts";
import { buildUniversalVtt, prepareMapImport, vttImageSize, vttPixelsPerGrid } from "../lib/map-transfer.ts";
import { buildMapGenerationRequest, roomCapacity } from "../lib/map-generation.ts";

const LIA = "13000000-0000-0000-0000-000000000001";
const BRAM = "13000000-0000-0000-0000-000000000003";
const LIA_SHEET = "43000000-0000-0000-0000-000000000001";
const BRAM_SHEET = "43000000-0000-0000-0000-000000000002";
const rect = (l, t, r, b) => [[l, t], [r, t], [r, b], [l, b]];

/** A room 1000..3000 with a vertical wall at x=2000 and a door in its middle. */
function room(doorState = "closed") {
  const document = createEmptyDocument("one-ring");
  document.structures.push(
    { id: "wall", type: "wall", points: [[2000, 0], [2000, 4000]], material: "stone", thickness: 60 },
    { id: "door", type: "door", wall_id: "wall", at: 0.5, width: 400, style: "wooden", state: doorState },
    { id: "barrel", type: "prop", kind: "barrel", x: 3500, y: 3500, rotation: 0, scale: 1 },
    { id: "floor", type: "area", points: rect(2500, 500, 4500, 1500), material: "wood_planks", label: "Depósito" },
  );
  document.pins.push(
    { id: "lia", kind: "character", sheet_id: LIA_SHEET, label: "Lia", x: 1000, y: 2000, gm_only: false },
    { id: "bram", kind: "character", sheet_id: BRAM_SHEET, label: "Bram", x: 1200, y: 3000, gm_only: false },
    { id: "orc", kind: "npc", label: "Orc", x: 3000, y: 2000, gm_only: false },
  );
  return document;
}

test("fog regions apply in order and per player", () => {
  const regions = [
    { id: "r1", mode: "reveal", points: rect(0, 0, 5000, 5000), players: null },
    { id: "r2", mode: "hide", points: rect(0, 0, 1000, 1000), players: [BRAM] },
    { id: "r3", mode: "reveal", points: rect(8000, 0, 9000, 1000), players: [LIA] },
  ];
  const lia = fogRegionsFor(regions, LIA);
  const bram = fogRegionsFor(regions, BRAM);
  assert.deepEqual(lia.map((item) => item.id), ["r1", "r3"]);
  assert.ok(pointRevealed(lia, [500, 500]));
  assert.ok(!pointRevealed(bram, [500, 500]), "a later hide region wins for that player");
  assert.ok(pointRevealed(lia, [8500, 500]) && !pointRevealed(bram, [8500, 500]));
  assert.ok(!pointRevealed(lia, [7000, 7000]), "uncovered points stay hidden");
  assert.deepEqual(fogRegionsFor(regions, null).map((item) => item.id), ["r1"]);
});

test("fog cells snap to the grid; a click covers one cell", () => {
  assert.deepEqual(fogCellRect([260, 740], [260, 740], 250, 10000, 7500), rect(250, 500, 500, 750));
  assert.deepEqual(fogCellRect([900, 100], [10, 600], 250, 10000, 7500), rect(0, 0, 1000, 750));
  assert.deepEqual(fogCellRect([9990, 7490], [9990, 7490], 250, 10000, 7500), rect(9750, 7250, 10000, 7500));
});

test("fog parses, validates and rejects malformed regions", () => {
  const document = room();
  document.fog = { enabled: true, line_of_sight: true, regions: [{ id: "f1", mode: "reveal", points: rect(0, 0, 2000, 4000), players: [LIA] }] };
  assert.equal(validateMapDocument(document), "");
  assert.deepEqual(parseMapDocument(JSON.parse(JSON.stringify(document))).document, document);
  for (const fog of [
    { enabled: "yes", regions: [] },
    { enabled: true, regions: [{ id: "f", mode: "peek", points: rect(0, 0, 1, 1), players: null }] },
    { enabled: true, regions: [{ id: "f", mode: "reveal", points: [[0, 0], [1, 1]], players: null }] },
    { enabled: true, regions: [{ id: "f", mode: "reveal", points: rect(0, 0, 1, 1), players: ["not-a-uuid"] }] },
  ]) assert.match(parseMapDocument({ ...document, fog }).error, /névoa/);
  const duplicate = { ...document, fog: { ...document.fog, regions: [{ ...document.fog.regions[0], id: "wall" }] } };
  assert.match(validateMapDocument(duplicate), /identificador/);
});

test("walls and closed doors block sight; open doors let it through", () => {
  const closed = room("closed");
  assert.ok(!hasLineOfSight(blockingSegments(closed), [1000, 2000], [3000, 2000]));
  const open = room("open");
  const segments = blockingSegments(open);
  assert.ok(hasLineOfSight(segments, [1000, 2000], [3000, 2000]), "through the open door");
  assert.ok(!hasLineOfSight(segments, [1000, 500], [3000, 500]), "the rest of the wall still blocks");
  assert.ok(!hasLineOfSight(blockingSegments(room("locked")), [1000, 2000], [3000, 2000]));
});

test("a wall split at a door gap keeps both solid pieces", () => {
  const pieces = splitPolylineAtGaps([[0, 0], [1000, 0], [1000, 1000]], [[800, 1200]]);
  assert.deepEqual(pieces, [[[0, 0], [800, 0]], [[1000, 200], [1000, 1000]]]);
  assert.deepEqual(splitPolylineAtGaps([[0, 0], [100, 0]], []), [[[0, 0], [100, 0]]]);
});

test("the visibility polygon stops at walls and passes open doors", () => {
  const document = room("closed");
  const polygon = visibilityPolygon([1000, 2000], blockingSegments(document), document.width, document.height);
  assert.ok(pointInPolygon([1500, 1000], polygon));
  assert.ok(!pointInPolygon([3000, 2000], polygon), "behind the closed door");
  const opened = room("open");
  const through = visibilityPolygon([1000, 2000], blockingSegments(opened), opened.width, opened.height);
  assert.ok(pointInPolygon([3000, 2000], through));
  assert.ok(!pointInPolygon([3000, 300], through), "beside the doorway the wall still hides");
});

test("redaction for one player removes what is under fog or out of sight", () => {
  const document = room("closed");
  document.fog = { enabled: true, line_of_sight: true, regions: [
    { id: "f-all", mode: "reveal", points: rect(0, 0, 3200, 4000), players: null },
    { id: "f-lia", mode: "reveal", points: rect(3200, 3000, 4000, 4000), players: [LIA] },
  ] };
  const lia = { userId: LIA, ownSheetIds: new Set([LIA_SHEET]) };
  const view = redactForViewer(document, lia);
  assert.deepEqual(view.pins.map((pin) => pin.id), ["lia", "bram"], "the orc behind the closed door is out of sight");
  assert.ok(view.structures.some((item) => item.id === "barrel"), "Lia's own region reveals the barrel");
  assert.ok(view.structures.some((item) => item.id === "door"), "doors follow their visible wall");
  assert.ok(view.structures.some((item) => item.id === "floor"), "an area partly under a revealed region is kept");
  assert.ok(view.fog.regions.every((region) => region.players === null), "player lists never reach the client");
  assert.deepEqual(view.fog.regions.map((region) => region.id), ["f-all", "f-lia"]);

  const bram = redactForViewer(document, { userId: BRAM, ownSheetIds: new Set([BRAM_SHEET]) });
  assert.ok(!bram.structures.some((item) => item.id === "barrel"), "another player's reveal does not apply");
  assert.deepEqual(bram.fog.regions.map((region) => region.id), ["f-all"]);

  const opened = redactForViewer({ ...document, structures: room("open").structures }, lia);
  assert.ok(opened.pins.some((pin) => pin.id === "orc"), "opening the door shows the orc");

  const hidden = { ...document, fog: { ...document.fog, regions: [] } };
  assert.deepEqual(redactForViewer(hidden, lia).pins.map((pin) => pin.id), ["lia"], "own pin stays even under fog");
  const covered = { ...document, fog: { ...document.fog, regions: [...document.fog.regions, { id: "f-hide", mode: "hide", points: rect(0, 0, 10000, 7500), players: [LIA] }] } };
  assert.deepEqual(redactForViewer(covered, lia).structures, [], "a later hide over everything wins, floors included");
  assert.ok(viewerMasks(view, lia).sight?.length === 1);
});

test("JSON import accepts exports, strips foreign references and enforces limits", () => {
  const document = room();
  document.pins.push({ id: "npc2", kind: "npc", entity_id: "63000000-0000-0000-0000-000000000009", label: "Velho", x: 10, y: 10, gm_only: false, notes: "x" });
  document.fog = { enabled: true, line_of_sight: false, regions: [{ id: "f1", mode: "reveal", points: rect(0, 0, 10, 10), players: [BRAM] }] };
  const text = JSON.stringify({ name: "Taverna", system_key: "one-ring", document });
  const result = prepareMapImport(text, "arquivo", { sheetIds: new Set([LIA_SHEET]), entityIds: new Set(), playerIds: new Set([LIA]) });
  assert.equal(result.ok, true);
  assert.equal(result.name, "Taverna");
  assert.deepEqual(result.document.pins.map((pin) => pin.id), ["lia", "orc", "npc2"]);
  assert.equal(result.document.pins[2].entity_id, undefined);
  assert.equal(result.document.fog.regions.length, 0);
  assert.equal(result.warnings.length, 3);

  const bare = prepareMapImport(JSON.stringify(createEmptyDocument("hunter")), "Beco", { sheetIds: new Set(), entityIds: new Set() });
  assert.equal(bare.ok && bare.name, "Beco");
  assert.match(prepareMapImport("{nope", "x", { sheetIds: new Set(), entityIds: new Set() }).error, /JSON/);
  const broken = JSON.parse(text);
  broken.document.structures[0].points[0] = [20000, 0];
  assert.match(prepareMapImport(JSON.stringify(broken), "x", { sheetIds: new Set(), entityIds: new Set() }).error, /estrutura/);
  const crowded = { ...createEmptyDocument(null), pins: Array.from({ length: 301 }, (_, index) => ({ id: `p${index}`, kind: "npc", label: "N", x: 1, y: 1, gm_only: false })) };
  assert.match(prepareMapImport(JSON.stringify(crowded), "x", { sheetIds: new Set(), entityIds: new Set() }).error, /300 pins/);
});

test("Universal VTT export carries walls, portals and resolution in grid cells", () => {
  const document = room("open");
  const vtt = buildUniversalVtt(document, "iVBORw0KGgo=");
  assert.equal(vtt.format, 0.3);
  assert.deepEqual(vtt.resolution.map_size, { x: 40, y: 30 });
  assert.equal(vtt.resolution.pixels_per_grid, vttPixelsPerGrid(document));
  assert.deepEqual(vttImageSize(document), { width: 40 * vtt.resolution.pixels_per_grid, height: 30 * vtt.resolution.pixels_per_grid });
  assert.deepEqual(vtt.line_of_sight, [[{ x: 8, y: 0 }, { x: 8, y: 7.2 }], [{ x: 8, y: 8.8 }, { x: 8, y: 16 }]]);
  assert.equal(vtt.portals.length, 1);
  assert.deepEqual(vtt.portals[0].position, { x: 8, y: 8 });
  assert.deepEqual(vtt.portals[0].bounds, [{ x: 8, y: 7.2 }, { x: 8, y: 8.8 }]);
  assert.equal(vtt.portals[0].closed, false);
  assert.equal(buildUniversalVtt(room("locked"), "").portals[0].closed, true);
  assert.equal(vtt.image, "iVBORw0KGgo=");
  assert.ok(vttImageSize({ width: 10000, height: 10000, grid: { size: 50 } }).width <= 8192, "large grids keep the image within 8192 px");
});

test("map generation parameters follow the API limits and capacity", () => {
  assert.equal(roomCapacity(32, 24), 24);
  assert.deepEqual(buildMapGenerationRequest({ width: "40", height: "30", rooms: "12", seed: "77" }).request, { width: 40, height: 30, room_count: 12, seed: 77 });
  assert.equal(buildMapGenerationRequest({ width: "20", height: "20", rooms: "3", seed: "cripta-norte" }).request.seed, "cripta-norte");
  assert.equal(buildMapGenerationRequest({ width: "20", height: "20", rooms: "3", seed: "" }, () => 5).request.seed, 5);
  assert.match(buildMapGenerationRequest({ width: "65", height: "20", rooms: "3", seed: "" }).error, /Largura/);
  assert.match(buildMapGenerationRequest({ width: "12", height: "12", rooms: "5", seed: "" }).error, /no máximo 4 salas/);
  assert.match(buildMapGenerationRequest({ width: "32", height: "32", rooms: "0", seed: "" }).error, /salas/);
  assert.match(buildMapGenerationRequest({ width: "32", height: "32", rooms: "2", seed: "x".repeat(129) }).error, /128/);
});
