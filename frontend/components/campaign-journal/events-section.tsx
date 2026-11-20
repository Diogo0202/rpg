"use client";

import { FormEvent, useState } from "react";

import styles from "../campaign-journal-panel.module.css";
import {
  dateLabel, emptyEvent, ENTITY_KIND_LABELS, EVENT_STATUS_LABELS, eventDraftOf, filterEvents, LINK_KIND_LABELS, LINKABLE_KINDS,
  type CampaignEvent, type EventDraft, type EventFilters, type EventStatus, type LinkDraft, type LinkKind,
} from "./model";
import type { CampaignJournal } from "./use-campaign-journal";

type Props = { journal: CampaignJournal; canManage: boolean; inputId: (name: string) => string };

function EventLinks({ journal, canManage, inputId, item }: Props & { item: CampaignEvent }) {
  const { entityLinks, worldEntities, saving } = journal;
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const links = entityLinks.filter((link) => link.event_id === item.id);
  const current = draft ?? { entity_id: "", link_kind: (item.status === "consequence" ? "consequence" : "involves") as LinkKind };

  async function link() {
    if (await journal.addEntityLink(item, current)) setDraft(null);
  }

  return <div className={styles.recordMeta} aria-label={`Registros do mundo ligados a ${item.title}`}>
    {links.length ? <ul className={styles.entityLinks}>{links.map((entry) => {
      const entity = worldEntities.find((candidate) => candidate.id === entry.entity_id);
      return <li key={entry.id}>{LINK_KIND_LABELS[entry.link_kind] ?? entry.link_kind}: <strong>{entity?.name ?? "Registro do mundo"}</strong>{entity ? ` (${ENTITY_KIND_LABELS[entity.kind]})` : ""}{canManage && <button type="button" className={styles.textButton} disabled={saving} onClick={() => void journal.removeEntityLink(entry)}>Desligar</button>}</li>;
    })}</ul> : <span>Nenhum NPC, item, missão ou local ligado.</span>}
    {canManage && worldEntities.length > 0 && <div className={styles.rowActions}>
      <label htmlFor={inputId(`link-entity-${item.id}`)}>Ligar a<select id={inputId(`link-entity-${item.id}`)} value={current.entity_id} disabled={saving} onChange={(event) => setDraft({ ...current, entity_id: event.target.value })}><option value="">Selecione</option>{LINKABLE_KINDS.map((kind) => <optgroup key={kind} label={ENTITY_KIND_LABELS[kind]}>{worldEntities.filter((entry) => entry.kind === kind).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</optgroup>)}</select></label>
      <label htmlFor={inputId(`link-kind-${item.id}`)}>Tipo<select id={inputId(`link-kind-${item.id}`)} value={current.link_kind} disabled={saving} onChange={(event) => setDraft({ ...current, link_kind: event.target.value as LinkKind })}>{Object.entries(LINK_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className={styles.secondaryButton} disabled={saving || !current.entity_id} onClick={() => void link()}>Ligar</button>
    </div>}
  </div>;
}

export function EventsSection(props: Props) {
  const { journal, canManage, inputId } = props;
  const { sessions, factions, events, loading, saving } = journal;
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [filters, setFilters] = useState<EventFilters>({ query: "", session: "", faction: "", status: "" });
  const filteredEvents = filterEvents(events, filters);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft && await journal.saveEvent(draft)) setDraft(null);
  }

  return (
    <section className={styles.section} aria-labelledby={inputId("events-title")}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>HISTÓRICO CRONOLÓGICO</p><h3 id={inputId("events-title")}>Linha do tempo</h3></div>
        {canManage && <button className={styles.primaryButton} type="button" disabled={saving} onClick={() => setDraft(emptyEvent())}>Novo evento</button>}
      </div>
      <div className={styles.filters}>
        <label htmlFor={inputId("event-query")}>Buscar evento<input id={inputId("event-query")} type="search" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="Título ou descrição" /></label>
        <label htmlFor={inputId("event-session-filter")}>Sessão<select id={inputId("event-session-filter")} value={filters.session} onChange={(event) => setFilters({ ...filters, session: event.target.value })}><option value="">Todas</option>{sessions.map((item) => <option key={item.id} value={item.id}>Sessão {item.sequence}: {item.title}</option>)}</select></label>
        <label htmlFor={inputId("event-faction-filter")}>Facção<select id={inputId("event-faction-filter")} value={filters.faction} onChange={(event) => setFilters({ ...filters, faction: event.target.value })}><option value="">Todas</option>{factions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label htmlFor={inputId("event-status-filter")}>Status<select id={inputId("event-status-filter")} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {draft && canManage && (
        <form className={styles.form} onSubmit={submit}>
          <fieldset disabled={saving} className={styles.editingFields}>
            <div className={styles.formGrid}>
              <label htmlFor={inputId("event-title")}>Título<input id={inputId("event-title")} maxLength={200} required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label htmlFor={inputId("event-date")}>Data<input id={inputId("event-date")} type="date" required value={draft.occurred_on} onChange={(event) => setDraft({ ...draft, occurred_on: event.target.value })} /></label>
              <label htmlFor={inputId("event-status")}>Status<select id={inputId("event-status")} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as EventStatus })}>{Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label htmlFor={inputId("event-session")}>Sessão<select id={inputId("event-session")} value={draft.session_id} onChange={(event) => setDraft({ ...draft, session_id: event.target.value })}><option value="">Sem vínculo</option>{sessions.map((item) => <option key={item.id} value={item.id}>Sessão {item.sequence}: {item.title}</option>)}</select></label>
              <label htmlFor={inputId("event-faction")}>Facção<select id={inputId("event-faction")} value={draft.faction_id} onChange={(event) => setDraft({ ...draft, faction_id: event.target.value })}><option value="">Sem vínculo</option>{factions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>
            <label htmlFor={inputId("event-description")}>Descrição<textarea id={inputId("event-description")} rows={3} maxLength={12000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <div className={styles.formActions}><button className={styles.primaryButton} disabled={saving}>{draft.id ? "Salvar evento" : "Criar evento"}</button><button className={styles.secondaryButton} type="button" onClick={() => setDraft(null)}>Cancelar</button></div>
          </fieldset>
        </form>
      )}
      {loading ? <p className={styles.empty}>Carregando eventos…</p> : events.length === 0 ? <p className={styles.empty}>Nenhum evento registrado nesta campanha.</p> : filteredEvents.length === 0 ? <p className={styles.empty}>Nenhum evento corresponde a estes filtros.</p> : (
        <ol className={styles.timeline}>
          {filteredEvents.map((item) => {
            const session = sessions.find((entry) => entry.id === item.session_id);
            const faction = factions.find((entry) => entry.id === item.faction_id);
            return <li className={styles.eventCard} key={item.id}>
              <p className={styles.eventDate}>{dateLabel(item.occurred_on)}</p>
              <div className={styles.recordHeading}><h4>{item.title}</h4><span className={styles.badge}>{EVENT_STATUS_LABELS[item.status]}</span></div>
              <p className={styles.recordText}>{item.description || "Sem descrição registrada."}</p>
              <p className={styles.recordMeta}>Sessão: {session ? `Sessão ${session.sequence}: ${session.title}` : "Sem vínculo"} · Facção: {faction?.name ?? "Sem vínculo"}</p>
              <EventLinks {...props} item={item} />
              {canManage && <div className={styles.rowActions}><button type="button" className={styles.textButton} disabled={saving} onClick={() => setDraft(eventDraftOf(item))}>Editar</button><button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void journal.deleteEvent(item)}>Excluir</button></div>}
            </li>;
          })}
        </ol>
      )}
    </section>
  );
}
