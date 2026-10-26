/**
 * MAP-02: parameters for POST /api/v1/maps/generate. Limits mirror
 * MapGenerationRequest (backend/app/routes/generators.py) and the capacity
 * rule of backend/app/services/tactical_maps.py, so the form explains a
 * refusal before the API returns 422.
 */
export const MAP_GENERATION_LIMITS = { minDimension: 12, maxDimension: 64, minRooms: 1, maxRooms: 32, maxSeedLength: 128 } as const;

export type MapGenerationRequest = { width: number; height: number; room_count: number; seed: number | string };

/** Each room needs a 5×5 partition (3-cell interior plus margins). */
export function roomCapacity(width: number, height: number): number {
  return Math.floor(width / 5) * Math.floor(height / 5);
}

/**
 * Builds the request from form text. An empty seed draws a random one; a
 * non-negative integer seed is sent as a number and anything else as text
 * (the API accepts both and reproduces the same map for the same seed).
 */
export function buildMapGenerationRequest(
  input: { width: string; height: string; rooms: string; seed: string },
  randomSeed: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0],
): { request: MapGenerationRequest; error: "" } | { request: null; error: string } {
  const { minDimension, maxDimension, minRooms, maxRooms, maxSeedLength } = MAP_GENERATION_LIMITS;
  const width = Number(input.width);
  const height = Number(input.height);
  const rooms = Number(input.rooms);
  for (const [label, value] of [["Largura", width], ["Altura", height]] as const) {
    if (!Number.isInteger(value) || value < minDimension || value > maxDimension) return { request: null, error: `${label} precisa ser um inteiro entre ${minDimension} e ${maxDimension} células.` };
  }
  if (!Number.isInteger(rooms) || rooms < minRooms || rooms > maxRooms) return { request: null, error: `O número de salas precisa ficar entre ${minRooms} e ${maxRooms}.` };
  const capacity = roomCapacity(width, height);
  if (rooms > capacity) return { request: null, error: `Um mapa de ${width}×${height} comporta no máximo ${capacity} salas.` };
  const text = input.seed.trim();
  let seed: number | string;
  if (!text) seed = randomSeed();
  else if (/^\d+$/.test(text) && Number.isSafeInteger(Number(text))) seed = Number(text);
  else if (text.length > maxSeedLength) return { request: null, error: `A seed em texto aceita até ${maxSeedLength} caracteres.` };
  else seed = text;
  return { request: { width, height, room_count: rooms, seed }, error: "" };
}
