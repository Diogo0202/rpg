import type { Metadata } from "next";

import { SpotifyCallback } from "../../../../components/spotify-callback";

export const metadata: Metadata = {
  title: "Conectando o Spotify | RPG-Atlas",
  robots: { index: false, follow: false },
  // O código de autorização está na URL desta página: nunca vai como Referer.
  referrer: "no-referrer",
};

export default function SpotifyCallbackPage() {
  return <SpotifyCallback />;
}
