import type { Metadata } from "next";
import { getSiteMetadataConfig } from "../lib/site-metadata";
import "./globals.css";

const site = getSiteMetadataConfig();

export const metadata: Metadata = {
  ...(site.metadataBase ? { metadataBase: site.metadataBase } : {}),
  manifest: "/manifest.webmanifest",
  title: { default: "RPG-Atlas | Sua campanha, conectada", template: "%s | RPG-Atlas" },
  description: "Organize campanhas privadas de RPG, com fichas, regras autorizadas, personagens, locais e diário de sessões.",
  applicationName: "RPG-Atlas",
  ...(site.indexable ? { alternates: { canonical: site.publicUrl!.toString() } } : {}),
  robots: site.indexable ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "RPG-Atlas",
    title: "RPG-Atlas | Sua campanha, conectada",
    description: "Organize campanhas privadas de RPG, com fichas, regras autorizadas, personagens, locais e diário de sessões.",
    ...(site.indexable ? { url: site.publicUrl!.toString() } : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "RPG-Atlas | Sua campanha, conectada",
    description: "Organize campanhas privadas de RPG, com fichas, regras autorizadas, personagens, locais e diário de sessões.",
  },
};

export const viewport = {
  themeColor: "#1c2b28",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body data-clarity-mask="True">{children}</body>
    </html>
  );
}
