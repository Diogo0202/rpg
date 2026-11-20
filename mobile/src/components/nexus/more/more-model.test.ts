import { describe, expect, it } from "vitest";
import { checkNote, checkSession, newestFirst } from "../journal/journal-model";
import { campaignLibrary, musicLinkInput, spotifyUrl } from "./more-model";

describe("more model", () => {
  it("accepts only HTTPS Spotify links without credentials", () => {
    expect(spotifyUrl(" https://open.spotify.com/playlist/x ")).toBe("https://open.spotify.com/playlist/x");
    expect(spotifyUrl("http://open.spotify.com/x")).toBeNull();
    expect(spotifyUrl("https://user:pw@open.spotify.com/x")).toBeNull();
    expect(spotifyUrl("https://evil.example/x")).toBeNull();
    expect(musicLinkInput(" ", "https://spotify.link/a")).toEqual({ error: "Informe um título de até 120 caracteres." });
    expect(musicLinkInput("Taverna", "https://spotify.link/a")).toEqual({ data: { title: "Taverna", url: "https://spotify.link/a" } });
  });

  it("lists only approved campaign templates and names known systems", () => {
    const rows: Parameters<typeof campaignLibrary>[0] = [
      { id: "a", data: { status: "approved", name: "Ficha", version: 2, schema: { system_key: "custom" } } },
      { id: "b", data: { status: "draft", name: "Rascunho", version: 1 } },
      { id: "c", data: { status: "approved", name: "Sem versão", version: 0 } },
      { id: "d", data: { status: "approved", name: "Sem sistema", version: 1 } },
    ];
    expect(campaignLibrary(rows)).toEqual([
      { id: "a", name: "Ficha", version: 2, system: "custom" },
      { id: "d", name: "Sem sistema", version: 1, system: "Sistema não informado" },
    ]);
  });
});

describe("journal model", () => {
  it("validates sessions and notes before saving", () => {
    expect(checkSession({ title: " Sessão 1 ", date: "2026-01-02", summary: " ok " })).toEqual({ values: { title: "Sessão 1", session_date: "2026-01-02", summary: "ok" } });
    expect(checkSession({ title: "", date: "2026-01-02", summary: "" })).toHaveProperty("error");
    expect(checkNote({ sessionId: "", title: "Nota", body: "" })).toHaveProperty("error");
    expect(checkNote({ sessionId: "s1", title: "Nota", body: "texto" })).toEqual({ values: { session_id: "s1", title: "Nota", body: "texto" } });
  });

  it("orders sessions from newest to oldest", () => {
    const sessions = [{ data: { title: "a", session_date: "2026-01-01" } }, { data: { title: "b", session_date: "2026-03-01" } }];
    expect(newestFirst(sessions).map((item) => item.data.title)).toEqual(["b", "a"]);
  });
});
