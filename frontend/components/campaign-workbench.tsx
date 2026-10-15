"use client";

import { useMemo, useState } from "react";

import { GenerationPanel } from "./generation-panel";
import { V5ProbabilityPanel } from "./v5-probability-panel";
import { SheetBuilder } from "./sheet-builder";
import SpotifyPlaylistPanel from "./spotify-playlist-panel";
import { RulesSearchPanel } from "./rules-search-panel";
import { PartyStatusPanel } from "./party-status-panel";
import { CharacterEffectsPanel } from "./character-effects-panel";
import { CompendiumPanel } from "./compendium-panel";
import { CharacterSessionBar, CharacterSessionProvider } from "../lib/character-session";
import { LocalVaultPanel } from "./local-vault-panel";
import { V5ActionPanel } from "./v5-action-panel";
import { CampaignJournalPanel } from "./campaign-journal-panel";
import { CharacterInventoryPanel } from "./character-inventory-panel";
import { WorldLibraryPanel } from "./world-library-panel";
import { SavedMapsPanel } from "./saved-maps-panel";
import { SceneModePanel } from "./scene-mode-panel";
import { ExperiencePanel } from "./experience-panel";
import { MusicCuesPanel } from "./music-cues-panel";
import { SecondInquisitionPanel } from "./second-inquisition-panel";
import { ChronicleDiagnosticPanel } from "./chronicle-diagnostic-panel";
import { SystemRollPanel } from "./system-roll-panel";

type Area = "biblioteca" | "regras" | "compendio" | "grupo" | "si" | "cronica" | "efeitos" | "fichas" | "cofre" | "inventario" | "acoes" | "sistemas" | "diario" | "experiencia" | "musica" | "mundo" | "mapa" | "mesa" | "geracao" | "v5";
type Book = { name: string; kind: string; state: "Pronto" | "Em revisão" | "Na fila" };

const initialBooks: Book[] = [];

const areas: Array<{ id: Area; label: string; detail: string }> = [
  { id: "biblioteca", label: "Biblioteca", detail: "Livros autorizados e extração" },
  { id: "regras", label: "Regras", detail: "Busca com página de origem" },
  { id: "compendio", label: "Compêndio", detail: "Poderes e vantagens por tags" },
  { id: "grupo", label: "Grupo", detail: "Status para o narrador" },
  { id: "si", label: "Segunda Inquisição", detail: "Eventos e alerta da cidade" },
  { id: "cronica", label: "Diagnóstico", detail: "Oportunidades da crônica" },
  { id: "efeitos", label: "Condições", detail: "Modificadores da rolagem" },
  { id: "fichas", label: "Fichas", detail: "Templates sem sistema fixo" },
  { id: "cofre", label: "Cofre local", detail: "Backup, JSON e impressão" },
  { id: "inventario", label: "Inventário", detail: "Equipamento e aquisições" },
  { id: "acoes", label: "Ações V5", detail: "Dados de Fome e trilhas" },
  { id: "sistemas", label: "Outros roladores", detail: "Caçador e O Um Anel" },
  { id: "diario", label: "Diário", detail: "Sessões, facções e tensão" },
  { id: "experiencia", label: "Experiência", detail: "Custos e histórico local" },
  { id: "musica", label: "Música", detail: "Playlists e trilhas de sessão" },
  { id: "mundo", label: "Mundo", detail: "Entidades e consequências" },
  { id: "mapa", label: "Mapas", detail: "Mapas salvos e marcadores" },
  { id: "mesa", label: "Mesa", detail: "Iniciativa e turnos" },
  { id: "geracao", label: "Geração", detail: "Mapas, personagens e itens" },
  { id: "v5", label: "V5: risco", detail: "Fome, críticos e Vontade" },
];

type WorkbenchProps = { campaignId: string; campaignName: string; viewerId: string; isOwner: boolean; canManageTemplates: boolean; canEditSheets: boolean };

export function CampaignWorkbench(props: WorkbenchProps) {
  return <CharacterSessionProvider key={props.campaignId}><Workbench {...props} /></CharacterSessionProvider>;
}

function Workbench({ campaignId, campaignName, viewerId, isOwner, canManageTemplates, canEditSheets }: WorkbenchProps) {
  const [area, setArea] = useState<Area>(canManageTemplates ? "grupo" : "fichas");
  const [books] = useState<Book[]>(initialBooks);
  const active = useMemo(() => areas.find((item) => item.id === area)!, [area]);

  return (
    <main className="shell">
      <aside className="rail" aria-label="Navegação da campanha">
        <div className="brand"><span>R</span><strong>RPG<br />NEXUS</strong></div>
        <p className="campaign">{campaignName}<br /><small>{isOwner ? "Você é o mestre" : "Você é membro"}</small></p>
        <nav>
          {areas.filter((item) => !["grupo", "si", "cronica"].includes(item.id) || canManageTemplates).map((item) => (
            <button key={item.id} type="button" aria-pressed={area === item.id} className={area === item.id ? "nav active" : "nav"} onClick={() => setArea(item.id)}>
              <strong>{item.label}</strong><small>{item.detail}</small>
            </button>
          ))}
        </nav>
        <form action="/auth/signout" method="post"><button className="nav" type="submit">Sair da conta</button></form>
        <a className="created-by" href="https://deerflow.tech" target="_blank" rel="noreferrer">Created By Deerflow</a>
        <div className="privacy">Painéis em desenvolvimento<br /><span>confira o estado de gravação em cada ferramenta</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">CAMPANHA / {active.label.toUpperCase()}</p><h1>{active.label}</h1></div>
          <div className="live"><button type="button" className="quiet" onClick={() => setArea("efeitos")}>Abrir rolador</button></div>
        </header>
        <CharacterSessionBar campaignId={campaignId} />

        {area === "biblioteca" && (
          <section className="content two-columns">
            <article className="hero-panel">
              <p className="eyebrow">ACERVO PRIVADO</p><h2>Regras que continuam ligadas à mesa.</h2>
              <p>Importe do Drive ou envie um arquivo autorizado. A extração cria um rascunho com páginas de origem; nada vira regra ativa sem revisão do mestre.</p>
              <div className="actions"><button className="primary" disabled>Envio de PDF em preparação</button><button className="quiet" disabled>Conectar Drive</button></div>
              <p className="notice">O envio será aberto quando a validação de PDF e as permissões da biblioteca estiverem prontas.</p>
            </article>
            <article className="list-panel"><div className="panel-title"><h2>Na campanha</h2><span>{books.length} fontes</span></div>
              {books.length === 0 ? <p>Nenhuma fonte autorizada cadastrada nesta campanha.</p> : null}
              {books.map((book) => <div className="book" key={`${book.name}-${book.state}`}><b>{book.name}</b><small>{book.kind}</small><em className={book.state === "Pronto" ? "ready" : "review"}>{book.state}</em></div>)}
            </article>
          </section>
        )}

        {area === "fichas" && <SheetBuilder campaignId={campaignId} viewerId={viewerId} canManageTemplates={canManageTemplates} canEditSheets={canEditSheets} />}
        {area === "regras" && <RulesSearchPanel campaignId={campaignId} />}
        {area === "musica" && <><SpotifyPlaylistPanel campaignId={campaignId} /><MusicCuesPanel campaignId={campaignId} canManage={canManageTemplates} /></>}
        {area === "grupo" && canManageTemplates && <PartyStatusPanel campaignId={campaignId} />}
        {area === "si" && canManageTemplates && <SecondInquisitionPanel campaignId={campaignId} canManage={canManageTemplates} />}
        {area === "cronica" && canManageTemplates && <ChronicleDiagnosticPanel campaignId={campaignId} canManage={canManageTemplates} />}
        {area === "efeitos" && <CharacterEffectsPanel campaignId={campaignId} canEdit={canEditSheets} />}
        {area === "compendio" && <CompendiumPanel />}
        {area === "cofre" && <LocalVaultPanel campaignId={campaignId} viewerId={viewerId} canEditSheets={canEditSheets} canManageTemplates={canManageTemplates} />}
        {area === "inventario" && <CharacterInventoryPanel campaignId={campaignId} canEdit={canEditSheets} />}
        {area === "acoes" && <V5ActionPanel campaignId={campaignId} canEdit={canEditSheets} />}
        {area === "sistemas" && <SystemRollPanel />}
        {area === "diario" && <CampaignJournalPanel campaignId={campaignId} canManage={canManageTemplates} />}
        {area === "experiencia" && <ExperiencePanel viewerId={viewerId} />}
        {area === "mapa" && <SavedMapsPanel campaignId={campaignId} viewerId={viewerId} canManage={canManageTemplates} />}
        {area === "mesa" && <SceneModePanel campaignId={campaignId} viewerId={viewerId} canManage={canManageTemplates} />}

        {area === "mundo" && <WorldLibraryPanel campaignId={campaignId} viewerId={viewerId} canManage={canManageTemplates} />}

        {area === "geracao" && <GenerationPanel campaignId={campaignId} viewerId={viewerId} canManage={canManageTemplates} />}
        {area === "v5" && <V5ProbabilityPanel />}
      </section>
    </main>
  );
}
