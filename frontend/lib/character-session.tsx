"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { createClient } from "./supabase/client";

export type CharacterEffect = {
  id: string;
  label: string;
  delta: number;
  enabled: boolean;
  applies_to_tags: string[];
  exempt_tags: string[];
  remaining_scenes: number | null;
  source_note: string | null;
};

export type SessionCharacter = {
  id: string;
  name: string;
  version: number;
  values: Record<string, unknown>;
  effects: CharacterEffect[];
};

export function normalizeCharacter<T extends SessionCharacter>(character: T): T {
  return { ...character, effects: (character.effects ?? []).map((effect) => ({
    ...effect, enabled: effect.enabled !== false, applies_to_tags: effect.applies_to_tags ?? [],
    exempt_tags: effect.exempt_tags ?? [], remaining_scenes: effect.remaining_scenes ?? null, source_note: effect.source_note ?? null,
  })) };
}

type CharacterSession = {
  character: SessionCharacter | null;
  contextTags: string[];
  selectCharacter: (character: SessionCharacter | null) => void;
  acceptSavedCharacter: (character: SessionCharacter) => void;
  setContextTags: (tags: string[]) => void;
};

function makeStore() {
  return createStore<CharacterSession>()((set) => ({
    character: null,
    contextTags: [],
    selectCharacter: (character) => set({ character: character ? normalizeCharacter(character) : null }),
    acceptSavedCharacter: (character) => set((state) => state.character?.id === character.id && character.version >= state.character.version ? { character: normalizeCharacter(character) } : {}),
    setContextTags: (contextTags) => set({ contextTags }),
  }));
}

const SessionContext = createContext<ReturnType<typeof makeStore> | null>(null);

export function CharacterSessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>;
}

export function useCharacterSession() {
  const store = useContext(SessionContext);
  if (!store) throw new Error("A sessão do personagem precisa estar dentro da campanha.");
  return useStore(store);
}

export function parseTags(value: string): string[] {
  const tags = [...new Set(value.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > 20 || tags.some((tag) => tag.length > 64)) throw new Error("Informe até 20 tags, com no máximo 64 caracteres em cada uma.");
  return tags;
}

export function CharacterSessionBar({ campaignId }: { campaignId: string }) {
  const { character, selectCharacter } = useCharacterSession();
  const selectedRef = useRef(character);
  selectedRef.current = character;
  const [sheets, setSheets] = useState<SessionCharacter[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let request = 0;
    let client: ReturnType<typeof createClient>;
    try { client = createClient(); } catch {
      setError("Configure o Supabase para selecionar uma ficha salva.");
      return;
    }
    async function load() {
      const current = ++request;
      const { data, error: queryError } = await client.from("character_sheets")
        .select("id,name,version,values,effects").eq("campaign_id", campaignId).order("name");
      if (!active || current !== request) return;
      if (queryError) { setError("Não foi possível ler as fichas. Confira a conexão e as migrations de efeitos."); return; }
      const rows = ((data ?? []) as SessionCharacter[]).map(normalizeCharacter);
      setSheets(rows);
      setError("");
      const selected = selectedRef.current;
      if (selected) {
        const next = rows.find((row) => row.id === selected.id);
        if (!next) selectCharacter(null);
        else if (next.version >= selected.version) selectCharacter(next);
      }
    }
    const channel = client.channel(`selected-character-${campaignId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "character_sheet_notifications", filter: `campaign_id=eq.${campaignId}` }, () => void load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "character_sheet_notifications", filter: `campaign_id=eq.${campaignId}` }, () => void load())
      .subscribe((status) => { if (active && status === "SUBSCRIBED") void load(); });
    void load();
    return () => { active = false; void client.removeChannel(channel); };
  }, [campaignId, revision, selectCharacter]);

  return <div className="character-session-bar">
    <label htmlFor="session-character">Personagem da sessão
      <select id="session-character" value={character?.id ?? ""} onChange={(event) => selectCharacter(sheets.find((sheet) => sheet.id === event.target.value) ?? null)}>
        <option value="">Selecione uma ficha salva</option>
        {character && !sheets.some((sheet) => sheet.id === character.id) && <option value={character.id}>{character.name}</option>}
        {sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}
      </select>
    </label>
    <button className="quiet" type="button" onClick={() => setRevision((value) => value + 1)}>Atualizar fichas</button>
    <p role="status">{error || (character ? `Efeitos e rolagens vinculados a ${character.name}.` : "Escolha o personagem para aplicar condições nas rolagens.")}</p>
  </div>;
}
