import { supportLinks } from "../lib/support-links";

export function SupportLinks() {
  const links = supportLinks(process.env);
  if (!links.length) return null;
  return <footer aria-label="Apoio ao projeto">
    <h2>Apoie o projeto</h2>
    <p>As funções centrais continuam disponíveis sem pagamento. Os livros são adquiridos nas lojas oficiais.</p>
    <ul>{links.map((link) => <li key={link.name}><a href={link.href} rel={link.affiliate ? "sponsored nofollow noreferrer" : "nofollow noreferrer"}>{link.name}</a>{link.affiliate && " (pode gerar comissão para o projeto)"}</li>)}</ul>
  </footer>;
}
