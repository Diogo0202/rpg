import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { title: "RPG Nexus", description: "Campanhas de RPG conectadas, privadas e livres de sistema.", type: "website", locale: "pt_BR" },
};

export default function HomePage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "RPG Nexus",
    applicationCategory: "GameApplication",
    operatingSystem: "Web",
    inLanguage: "pt-BR",
    description: "Plataforma privada para fichas livres, mundos conectados e mesas de RPG.",
  };
  return <main className="landing"><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
    <p className="eyebrow">BETA EM PREPARAÇÃO</p><h1>Seu mundo de RPG,<br />em movimento.</h1>
    <p className="landing-copy">Crie fichas sem se prender a um sistema. Conecte regras, livros autorizados, personagens, locais, mapas e as consequências de cada sessão.</p>
    <div className="actions"><a className="primary" href="/login">Entrar na mesa</a><a className="quiet" href="#como-funciona">Como funciona</a></div>
    <section id="como-funciona" className="landing-grid"><article><b>Regras sob controle</b><p>Fontes autorizadas ficam restritas à campanha. O envio de PDFs está em preparação.</p></article><article><b>Ficha realmente livre</b><p>O mestre define os campos e as fórmulas. Modelos iniciais ajudam a começar a ficha.</p></article><article><b>Mundo conectado</b><p>Cadastre personagens e locais, registre suas relações e acompanhe os eventos no diário da campanha.</p></article></section>
  </main>;
}
