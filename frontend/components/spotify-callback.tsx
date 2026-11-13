"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { safeReturnPath, spotifyApi, SpotifyApiError } from "../lib/spotify-api";

type CallbackResult = { return_to: string; display_name: string | null };

export function SpotifyCallback() {
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const denied = params.get("error");
    // Tira o código do histórico antes de qualquer outra coisa.
    window.history.replaceState(null, "", window.location.pathname);

    if (denied) {
      setError(denied === "access_denied" ? "Você não autorizou o RPG-Atlas no Spotify. Nada foi conectado." : "O Spotify não concluiu a autorização.");
      return;
    }
    if (!code || !state) {
      setError("Este endereço não traz uma autorização do Spotify.");
      return;
    }
    spotifyApi<CallbackResult>("/callback", { method: "POST", body: { code, state } })
      .then((result) => {
        const target = safeReturnPath(result.return_to);
        window.location.replace(target === "/app" ? "/app?spotify=connected" : `${target}?area=musica&spotify=connected`);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof SpotifyApiError ? reason.message : "Não foi possível concluir a conexão.");
      });
  }, []);

  return (
    <main className="auth-page">
      <section className="auth-card" aria-live="polite">
        <h1>{error ? "Conta não conectada" : "Conectando o Spotify"}</h1>
        <p className="auth-copy">{error || "Confirmando a autorização. Você volta para a mesa em instantes."}</p>
        {error && <Link className="primary auth-link" href="/app">Voltar às campanhas</Link>}
      </section>
    </main>
  );
}
