import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RPG Nexus",
    short_name: "RPG Nexus",
    description: "Campanhas privadas de RPG para celular e computador.",
    start_url: "/app",
    display: "standalone",
    background_color: "#f2f0e7",
    theme_color: "#1c2b28",
    lang: "pt-BR",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" }],
  };
}
