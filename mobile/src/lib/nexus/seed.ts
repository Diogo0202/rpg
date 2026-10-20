import type { SyncChange, SyncEngine, JsonValue } from "@/lib/mobile-sync/index.ts";

/** Demo content for the local demo partition only. Labelled "demonstrativo" in the UI. */
function changes(data: Record<string, JsonValue>): SyncChange[] {
  return Object.entries(data).map(([k, v]) => ({ path: [k], before: { exists: false }, after: { exists: true, value: v } }));
}

export async function seedDemo(engine: SyncEngine): Promise<void> {
  const session = await engine.enqueue({ entityType: "journal_sessions", action: "create", changes: changes({
    title: "Sessão 1 — A névoa sobre o vale (demonstrativa)", session_date: new Date().toISOString().slice(0, 10),
    summary: "Sessão de exemplo criada no modo local.",
  }) });
  await engine.enqueue({ entityType: "campaign_state", action: "create", dependsOn: [session.operation_id], changes: changes({
    current_session_id: session.entity_id, scene: "O grupo chega à ponte de pedra ao anoitecer.",
  }) });
  await engine.enqueue({ entityType: "world_entities", action: "create", changes: changes({
    kind: "npc", name: "Edda, a barqueira (demonstrativa)", description: "Conhece as travessias do rio e cobra em segredos.", tags: ["rio", "aliada"],
  }) });
  await engine.enqueue({ entityType: "world_entities", action: "create", changes: changes({
    kind: "local", name: "Ponte de pedra (demonstrativa)", description: "Antiga, coberta de musgo, marca a fronteira do vale.", tags: ["fronteira"],
  }) });
  const map = await engine.enqueue({ entityType: "maps", action: "create", changes: changes({
    name: "Vale da névoa (demonstrativo)", columns: 12, rows: 9, description: "Mapa de exemplo com grid.",
  }) });
  await engine.enqueue({ entityType: "map_pins", action: "create", dependsOn: [map.operation_id], changes: changes({
    map_id: map.entity_id, label: "Entrada norte", x: 0.42, y: 0.18, note: "",
  }) });
}

