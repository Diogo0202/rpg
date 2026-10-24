import { useState, type FormEvent } from "react";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import type { JsonValue } from "@/lib/mobile-sync/index.ts";
import { useNexus, type Entity, type PathSet } from "@/lib/nexus/store";
import { Btn, Empty, Panel, Tag } from "./ui";

type WorldData = { kind: string; name: string; description: string; tags: string[] };
type WorldDraft = { id?: string; kind: string; name: string; description: string; tags: string };

const LOCAL_KIND_OPTIONS = ["npc", "local", "fação", "objeto", "ameaça", "criatura"];
const REMOTE_KIND_OPTIONS = [
  "character",
  "npc",
  "item",
  "rule",
  "location",
  "quest",
  "event",
  "scene",
];
const REMOTE_KIND_LABELS: Record<string, string> = {
  character: "Personagem",
  npc: "NPC",
  item: "Item",
  rule: "Regra",
  location: "Local",
  quest: "Missão",
  event: "Evento",
  scene: "Cena",
};
const entityFields: (keyof WorldData)[] = ["kind", "name", "description", "tags"];

function parseTags(input: string): string[] {
  const tags = [
    ...new Set(
      input
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  if (tags.length > 12) throw new Error("Use no máximo 12 tags.");
  if (tags.some((tag) => tag.length > 40)) throw new Error("Cada tag pode ter até 40 caracteres.");
  return tags;
}

function checkedWorld(draft: WorldDraft, mode: "local" | "connected"): WorldData {
  const name = draft.name.trim(),
    description = draft.description.trim(),
    tags = parseTags(draft.tags);
  if (name.length < 2 || name.length > 120)
    throw new Error("O nome precisa ter entre 2 e 120 caracteres.");
  if (!(mode === "connected" ? REMOTE_KIND_OPTIONS : LOCAL_KIND_OPTIONS).includes(draft.kind))
    throw new Error("Escolha um tipo válido.");
  if (description.length > 3000) throw new Error("A descrição pode ter até 3.000 caracteres.");
  return { kind: draft.kind, name, description, tags };
}

function sets<T extends object>(data: T, fields: readonly (keyof T)[]): PathSet[] {
  return fields.map((key) => ({ path: [String(key)], value: data[key] as JsonValue }));
}

function worldDraft(entity?: Entity<WorldData>): WorldDraft {
  return entity
    ? {
        id: entity.id,
        kind: entity.data.kind,
        name: entity.data.name,
        description: entity.data.description ?? "",
        tags: Array.isArray(entity.data.tags) ? entity.data.tags.join(", ") : "",
      }
    : { kind: "npc", name: "", description: "", tags: "" };
}

// The tactical map creator is desktop/web only; the mobile app keeps world entities.
export function WorldPanel() {
  const { list, create, update, remove, mode } = useNexus();
  const connected = mode === "connected";
  const kindOptions = connected ? REMOTE_KIND_OPTIONS : LOCAL_KIND_OPTIONS;
  const entities = list<WorldData>("world_entities").sort((a, b) =>
    a.data.name.localeCompare(b.data.name, "pt-BR"),
  );
  const [worldForm, setWorldForm] = useState<WorldDraft | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const saveWorld = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!worldForm) return;
    setBusy(true);
    setError("");
    try {
      const value = checkedWorld(worldForm, mode);
      if (worldForm.id) await update("world_entities", worldForm.id, sets(value, entityFields));
      else await create("world_entities", value as unknown as Record<string, JsonValue>);
      setWorldForm(null);
      setStatus(
        connected
          ? "Entidade adicionada à fila; aguardando confirmação do servidor."
          : "Entidade guardada neste aparelho.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível guardar a entidade.");
    } finally {
      setBusy(false);
    }
  };

  const deleteWorld = async (entity: Entity<WorldData>) => {
    if (!window.confirm(`Excluir “${entity.data.name}” deste aparelho?`)) return;
    setError("");
    try {
      await remove("world_entities", entity.id);
      setStatus(
        connected
          ? "Remoção adicionada à fila; aguardando confirmação do servidor."
          : "Entidade removida deste aparelho.",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível excluir a entidade.");
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Entidades"
        actions={
          <Btn
            type="button"
            onClick={() => {
              setWorldForm(worldDraft());
              setError("");
            }}
          >
            <Plus className="size-4" aria-hidden />
            Nova entidade
          </Btn>
        }
      >
        <p className="mb-3 text-sm text-ink-muted">
          {connected
            ? "Entidades da campanha carregadas com as permissões da sua conta."
            : "NPCs, lugares, facções e outros registros guardados neste aparelho."}
        </p>
        {!entities.length ? (
          <Empty>Nenhuma entidade cadastrada.</Empty>
        ) : (
          <ul className="space-y-2">
            {entities.map((entity) => (
              <li key={entity.id} className="parchment-inset p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-ink">{entity.data.name}</p>
                    <p className="text-xs capitalize text-ink-muted">
                      {entity.data.kind}
                      {entity.pending
                        ? connected
                          ? " · aguardando servidor"
                          : " · pendente local"
                        : ""}
                      {entity.conflict ? " · conflito" : ""}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Btn
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Editar ${entity.data.name}`}
                      onClick={() => {
                        setWorldForm(worldDraft(entity));
                        setError("");
                      }}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Btn>
                    <Btn
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Excluir ${entity.data.name}`}
                      onClick={() => void deleteWorld(entity)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Btn>
                  </div>
                </div>
                {entity.data.description && (
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">
                    {entity.data.description}
                  </p>
                )}
                {!!entity.data.tags?.length && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {entity.data.tags.map((tag, index) => (
                      <Tag key={`${tag}-${index}`}>{tag}</Tag>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {worldForm && (
          <form
            className="mt-4 space-y-3 border-t border-border pt-4"
            onSubmit={(event) => void saveWorld(event)}
          >
            <h3 className="font-semibold text-ink">
              {worldForm.id ? "Editar entidade" : "Nova entidade"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-semibold text-ink">
                Tipo
                <select
                  className="field-input mt-1"
                  value={worldForm.kind}
                  onChange={(event) => setWorldForm({ ...worldForm, kind: event.target.value })}
                >
                  {kindOptions.map((kind) => (
                    <option key={kind} value={kind}>
                      {connected ? REMOTE_KIND_LABELS[kind] : kind}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-ink">
                Nome
                <input
                  className="field-input mt-1"
                  value={worldForm.name}
                  maxLength={120}
                  required
                  onChange={(event) => setWorldForm({ ...worldForm, name: event.target.value })}
                />
              </label>
            </div>
            <label className="block text-sm font-semibold text-ink">
              Descrição
              <textarea
                className="field-input mt-1"
                rows={3}
                maxLength={3000}
                value={worldForm.description}
                onChange={(event) => setWorldForm({ ...worldForm, description: event.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Tags, separadas por vírgula
              <input
                className="field-input mt-1"
                value={worldForm.tags}
                maxLength={520}
                placeholder="rio, aliada"
                onChange={(event) => setWorldForm({ ...worldForm, tags: event.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Btn type="submit" disabled={busy}>
                {busy ? "Guardando…" : "Guardar entidade"}
              </Btn>
              <Btn
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setWorldForm(null)}
              >
                Cancelar
              </Btn>
            </div>
          </form>
        )}
      </Panel>

      <Panel title="Mapas">
        <p className="text-sm text-ink-muted">
          O criador de mapas táticos é exclusivo da versão web para computador. Abra a campanha no
          navegador do computador para desenhar mapas; os mapas compartilhados pelo narrador também
          aparecem lá.
        </p>
      </Panel>
      {error && (
        <p
          className="parchment border border-destructive p-3 text-sm font-semibold text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
      {status && (
        <p
          className="parchment p-3 text-sm font-semibold text-ink"
          role="status"
          aria-live="polite"
        >
          {status}
        </p>
      )}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <MapPin className="size-3.5" aria-hidden />
        {connected
          ? "Campanha conectada: alterações ficam pendentes até confirmação do servidor."
          : "Entidades ficam no armazenamento local deste aparelho."}
      </p>
    </div>
  );
}
