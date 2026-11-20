import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Btn, Empty, Panel } from "@/components/nexus/ui";
import { useNexus } from "@/lib/nexus/store";
import { MUSIC_TITLE_LIMIT, musicLinkInput, spotifyUrl, type MusicLink } from "./more-model";

const errorMessage = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

export function MusicPanel() {
  const { list, create, update, remove } = useNexus();
  const links = list<MusicLink>("music_links");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reset = () => {
    setTitle("");
    setUrl("");
    setEditing(null);
    setError("");
  };

  const startEditing = (id: string, link: MusicLink) => {
    setEditing(id);
    setTitle(link.title);
    setUrl(link.url);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const input = musicLinkInput(title, url);
    if ("error" in input) {
      setError(input.error);
      return;
    }
    try {
      if (editing) await update("music_links", editing, Object.entries(input.data).map(([key, value]) => ({ path: [key], value })));
      else await create("music_links", input.data);
      toast.success("Link salvo neste aparelho.");
      reset();
    } catch (caught) {
      setError(errorMessage(caught, "Falha ao salvar link."));
    }
  };

  const removeLink = (id: string) =>
    void remove("music_links", id)
      .then(() => toast.success("Link removido."))
      .catch((caught) => toast.error(errorMessage(caught, "Falha ao remover.")));

  return (
    <div className="space-y-4">
      <Panel title="Música">
        <p className="mb-3 text-sm text-ink-muted">Cadastre links públicos do Spotify. Não há OAuth nem reprodução integrada.</p>
        <form className="grid gap-2 sm:grid-cols-2" onSubmit={(event) => void save(event)}>
          <label className="text-sm font-semibold text-ink">
            Título
            <input className="field-input mt-1" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={MUSIC_TITLE_LIMIT} required />
          </label>
          <label className="text-sm font-semibold text-ink">
            Link Spotify
            <input className="field-input mt-1" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://open.spotify.com/..." required />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Btn type="submit">{editing ? "Salvar edição" : "Adicionar link"}</Btn>
            {editing && <Btn variant="outline" onClick={reset}>Cancelar</Btn>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
        </form>
      </Panel>
      {!links.length ? (
        <Empty>Nenhum link cadastrado.</Empty>
      ) : (
        <ul className="grid gap-2">
          {links.map((item) => (
            <li key={item.id}>
              <Panel>
                <p className="font-semibold text-ink">{item.data.title}</p>
                <a href={spotifyUrl(item.data.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-ink underline">
                  Abrir no Spotify
                </a>
                <div className="mt-3 flex gap-2">
                  <Btn size="sm" variant="outline" onClick={() => startEditing(item.id, item.data)}>Editar</Btn>
                  <Btn size="sm" variant="danger" onClick={() => removeLink(item.id)}>Excluir</Btn>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
