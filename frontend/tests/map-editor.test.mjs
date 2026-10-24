import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampPoint, closedOutline, nearestOnPolyline, pointAlongPolyline, pointInPolygon, rectanglePoints, snapAngle, snapToGrid, snapToPoints,
} from "../lib/map-geometry.ts";
import { kitForSystem, themeForSystem, MEDIEVAL_KIT, MODERN_KIT } from "../lib/map-kits.ts";
import {
  createEmptyDocument, houseStructures, parseMapDocument, redactForPlayers, removeElement, validateMapDocument,
} from "../lib/map-document.ts";

test("geometry snaps angles, grid and nearby endpoints", () => {
  assert.deepEqual(snapAngle([0, 0], [1000, 40]), [1001, 0], "angle locks to horizontal and keeps the drawn length");
  const diagonal = snapAngle([0, 0], [1000, 1080]);
  assert.ok(Math.abs(diagonal[0] - diagonal[1]) <= 1, "close to 45 degrees snaps to the diagonal");
  assert.deepEqual(snapToGrid([260, 740], 250), [250, 750]);
  assert.deepEqual(snapToPoints([1010, 995], [[1000, 1000], [5000, 5000]], 40), [1000, 1000]);
  assert.deepEqual(snapToPoints([1100, 1100], [[1000, 1000]], 40), [1100, 1100]);
  assert.deepEqual(clampPoint([-20, 12000]), [0, 10000]);
});

test("doors attach to the closest position along a wall", () => {
  const wall = [[0, 0], [1000, 0], [1000, 1000]];
  const hit = nearestOnPolyline([1010, 500], wall);
  assert.equal(Math.round(hit.at * 100), 75);
  assert.equal(Math.round(hit.distance), 10);
  const placed = pointAlongPolyline(wall, hit.at);
  assert.deepEqual(placed.point.map(Math.round), [1000, 500]);
  assert.equal(Math.round((placed.angle * 180) / Math.PI), 90, "door follows the vertical segment");
});

test("a dragged rectangle becomes a house with floor and closed walls", () => {
  const rectangle = rectanglePoints([4000, 3000], [1000, 1000]);
  assert.deepEqual(rectangle, [[1000, 1000], [4000, 1000], [4000, 3000], [1000, 3000]]);
  const [area, wall] = houseStructures(rectangle, "stone", "wood_planks", 70);
  assert.equal(area.type, "area");
  assert.equal(wall.points.length, 5);
  assert.deepEqual(wall.points[4], wall.points[0]);
  assert.deepEqual(closedOutline(wall.points), wall.points, "already closed outlines stay unchanged");
  assert.ok(pointInPolygon([2000, 2000], rectangle));
  assert.ok(!pointInPolygon([5000, 2000], rectangle));
});

test("kits follow the system: O Um Anel is medieval, V5 and Hunter are the modern city", () => {
  assert.equal(themeForSystem("one-ring"), "medieval");
  assert.equal(themeForSystem("vampire-v5"), "modern");
  assert.equal(themeForSystem("hunter"), "modern");
  assert.equal(themeForSystem(null), "modern");
  assert.equal(kitForSystem("one-ring"), MEDIEVAL_KIT);
  for (const kit of [MEDIEVAL_KIT, MODERN_KIT]) {
    for (const group of [kit.floors, kit.walls, kit.doors, kit.props, kit.npcIcons, kit.itemIcons]) {
      assert.ok(group.length > 0);
      for (const item of group) assert.match(item.id, /^[a-z_]{1,40}$/, "ids satisfy the database slug check");
    }
    assert.ok(kit.floors.some((floor) => floor.id === kit.background));
    assert.ok(kit.floors.some((floor) => floor.id === kit.houseFloor));
    assert.notEqual(kit.houseFloor, kit.background, "new houses stand out from the outdoor ground");
  }
});

function sampleDocument() {
  const document = createEmptyDocument("one-ring");
  const [area, wall] = houseStructures(rectanglePoints([1000, 1000], [4000, 3000]), "stone", "wood_planks", 70);
  document.structures.push(area, wall,
    { id: "door-1", type: "door", wall_id: wall.id, at: 0.1, width: 300, style: "wooden", state: "closed" },
    { id: "shade", type: "shadow", points: [[1000, 1000], [2000, 1000], [2000, 2000]], opacity: 0.6, gm_only: true },
    { id: "barrel", type: "prop", kind: "barrel", x: 1500, y: 1500, rotation: 0, scale: 1 });
  document.pins.push(
    { id: "pc", kind: "character", sheet_id: "43000000-0000-0000-0000-000000000001", label: "Lia", x: 2000, y: 2000, gm_only: false },
    { id: "trap", kind: "item", icon: "trap", label: "Armadilha", x: 3000, y: 2500, gm_only: true, notes: "segredo" },
  );
  return { document, wall };
}

test("v2 documents round-trip through parse and validation", () => {
  const { document } = sampleDocument();
  assert.equal(validateMapDocument(document), "");
  const parsed = parseMapDocument(JSON.parse(JSON.stringify(document)));
  assert.equal(parsed.error, "");
  assert.deepEqual(parsed.document, document);
});

test("validation rejects orphan doors, missing labels and out-of-range points", () => {
  const { document, wall } = sampleDocument();
  assert.match(validateMapDocument(removeElement({ ...document, structures: document.structures.filter((item) => item.id !== wall.id) }, "nothing")), /porta/);
  assert.match(validateMapDocument({ ...document, pins: [{ ...document.pins[0], label: "  " }] }), /nome/);
  const broken = JSON.parse(JSON.stringify(document));
  broken.structures[1].points[0] = [20000, 0];
  assert.match(parseMapDocument(broken).error, /estrutura/);
});

test("removing a wall also removes its doors", () => {
  const { document, wall } = sampleDocument();
  const next = removeElement(document, wall.id);
  assert.ok(!next.structures.some((item) => item.type === "door"));
});

test("player view hides GM-only shadows, pins and notes", () => {
  const { document } = sampleDocument();
  const view = redactForPlayers(document);
  assert.ok(!view.structures.some((item) => item.type === "shadow"));
  assert.deepEqual(view.pins.map((pin) => pin.id), ["pc"]);
  assert.ok(view.pins.every((pin) => pin.notes === undefined));
});

test("generated v1 grid maps open as a legacy background", () => {
  const parsed = parseMapDocument({ version: 1, width: 32, height: 24, layers: [{ id: "terrain", cells: [{ x: 1, y: 1, kind: "room" }] }], markers: [{ id: "m", label: "Porta", x: 10, y: 10, color: "#b55b32", type: "location", description: "" }] }, "vampire-v5");
  assert.equal(parsed.error, "");
  assert.equal(parsed.document.version, 2);
  assert.equal(parsed.document.height, 7500);
  assert.equal(parsed.document.legacy.terrain.length, 1);
  assert.equal(parsed.document.legacy.markers.length, 1);
  assert.equal(parsed.document.background, "asphalt");
  assert.equal(redactForPlayers(parsed.document).legacy.markers.length, 0);
});
