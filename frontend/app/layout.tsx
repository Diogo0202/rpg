import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
  manifest: "/manifest.webmanifest",
  title: "RPG Nexus | Sua campanha, conectada",
  description: "Fichas, regras, mundos e mesas táticas privadas para RPG de mesa.",
};

export const viewport = {
  themeColor: "#1c2b28",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
