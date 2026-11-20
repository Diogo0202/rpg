"use client";

import { useEffect, useRef, useState } from "react";

import { browserDb } from "../../lib/data/browser";
import type { Db } from "../../lib/data/db";
import * as journal from "../../lib/data/journal";
import { downloadText } from "../../lib/download";
import { bindCampaignJournalRealtime } from "../../lib/campaign-journal-sync";
import { useRealtimeSync } from "../../lib/realtime/hooks";
import {
  journalJson, journalMarkdown, LINKABLE_KINDS, safePart,
  type CampaignEvent, type CampaignFaction, type CampaignSession, type EventDraft, type EventEntityLink, type FactionDraft,
  type LinkableEntity, type LinkDraft, type SessionDraft,
} from "./model";

type Result = { data?: unknown; error: unknown };

/** Lança o erro da consulta; com `requireRow`, uma linha ausente também indica versão antiga. */
function ensure(result: Result, requireRow = false): void {
  if (result.error) throw result.error;
  if (requireRow && !result.data) throw new Error("stale row");
}

/** Estado, leitura, tempo real e escritas do diário de uma campanha. */
export function useCampaignJournal(campaignId: string, canManage: boolean) {
  const [sessions, setSessions] = useState<CampaignSession[]>([]);
  const [factions, setFactions] = useState<CampaignFaction[]>([]);
  const [events, setEvents] = useState<CampaignEvent[]>([]);
  const [worldEntities, setWorldEntities] = useState<LinkableEntity[]>([]);
  const [entityLinks, setEntityLinks] = useState<EventEntityLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const campaignRef = useRef(campaignId);
  const refreshRef = useRef<() => void>(() => undefined);
  useEffect(() => { campaignRef.current = campaignId; });

  useEffect(() => {
    let active = true;
    let requestId = 0;
    const requestCampaignId = campaignId;
    setSessions([]); setFactions([]); setEvents([]); setWorldEntities([]); setEntityLinks([]);
    setLoading(true); setSaving(false); setMessage("");

    async function load() {
      const currentRequest = ++requestId;
      try {
        const db = browserDb();
        const [sessionResult, factionResult, eventResult] = await Promise.all([
          journal.listSessions(db, requestCampaignId),
          journal.listFactions(db, requestCampaignId),
          journal.listEvents(db, requestCampaignId),
        ]);
        if (!active || currentRequest !== requestId) return;
        if (sessionResult.error || factionResult.error || eventResult.error) throw new Error("query failed");
        setSessions((sessionResult.data ?? []) as CampaignSession[]);
        setFactions((factionResult.data ?? []) as CampaignFaction[]);
        setEvents((eventResult.data ?? []) as CampaignEvent[]);
        // Links are optional: a missing migration must not hide the rest of the journal.
        const [entityResult, linkResult] = await Promise.all([
          journal.listLinkableEntities(db, requestCampaignId, LINKABLE_KINDS),
          journal.listEventLinks(db, requestCampaignId),
        ]);
        if (!active || currentRequest !== requestId) return;
        setWorldEntities(entityResult.error ? [] : (entityResult.data ?? []) as LinkableEntity[]);
        setEntityLinks(linkResult.error ? [] : (linkResult.data ?? []) as EventEntityLink[]);
      } catch {
        if (active && currentRequest === requestId) setMessage("Não foi possível carregar o diário desta campanha.");
      } finally {
        if (active && currentRequest === requestId) setLoading(false);
      }
    }

    refreshRef.current = () => void load();
    void load();
    return () => {
      active = false;
      refreshRef.current = () => undefined;
    };
  }, [campaignId]);

  const { status: syncStatus } = useRealtimeSync({
    topic: `campaign-journal-${campaignId}`,
    bind: (channel) => bindCampaignJournalRealtime(channel, campaignId, () => refreshRef.current()),
    onResync: () => refreshRef.current(),
  });

  /**
   * Roda uma escrita do narrador. Se a campanha mudar no meio, o resultado é descartado;
   * em caso de sucesso a lista é relida, porque o tempo real pode chegar depois.
   */
  async function mutate(work: (db: Db) => Promise<void>, done: string, failure: string, options: { clearMessage?: boolean } = {}): Promise<boolean> {
    if (!canManage) return false;
    const requestCampaignId = campaignId;
    const current = () => campaignRef.current === requestCampaignId;
    setSaving(true);
    if (options.clearMessage) setMessage("");
    try {
      await work(browserDb());
      if (!current()) return false;
      setMessage(done);
      refreshRef.current();
      return true;
    } catch {
      if (current()) setMessage(failure);
      return false;
    } finally {
      if (current()) setSaving(false);
    }
  }

  function saveSession(draft: SessionDraft): Promise<boolean> {
    const sequence = Number(draft.sequence);
    if (!Number.isInteger(sequence) || sequence < 1 || !draft.title.trim()) {
      setMessage("Informe uma sequência positiva e um título para a sessão.");
      return Promise.resolve(false);
    }
    const values = { sequence, title: draft.title.trim(), summary: draft.summary.trim(), status: draft.status, played_on: draft.played_on || null };
    return mutate(async (db) => {
      if (!draft.id) { ensure(await journal.insertDated(db, "campaign_sessions", campaignId, values)); return; }
      const existing = sessions.find((item) => item.id === draft.id);
      if (!existing) throw new Error("stale row");
      ensure(await journal.updateDated(db, "campaign_sessions", existing, campaignId, values), true);
    }, "Sessão salva.", "Não foi possível salvar. Atualize a lista e confira se alguém alterou este registro.", { clearMessage: true });
  }

  function deleteSession(item: CampaignSession): Promise<boolean> {
    if (!window.confirm(`Excluir a sessão ${item.sequence}: ${item.title}? Os eventos continuarão no diário sem esse vínculo.`)) return Promise.resolve(false);
    return mutate(async (db) => ensure(await journal.deleteDated(db, "campaign_sessions", item, campaignId), true),
      "Sessão removida.", "Não foi possível remover a sessão. Atualize a lista e tente novamente.");
  }

  function saveFaction(draft: FactionDraft): Promise<boolean> {
    const tension = Number(draft.tension);
    const limit = Number(draft.limit);
    if (!draft.name.trim() || !Number.isInteger(tension) || tension < 0 || tension > 12 || !Number.isInteger(limit) || limit < 1 || limit > 12) {
      setMessage("Informe nome, tensão entre 0 e 12 e limite entre 1 e 12.");
      return Promise.resolve(false);
    }
    const values = { name: draft.name.trim(), description: draft.description.trim(), goal: draft.goal.trim(), tension, limit, consequence: draft.consequence.trim() };
    return mutate(async (db) => {
      if (!draft.id) { ensure(await journal.insertFaction(db, campaignId, values)); return; }
      const existing = factions.find((item) => item.id === draft.id);
      if (!existing) throw new Error("stale row");
      ensure(await journal.updateFaction(db, existing, campaignId, values), true);
    }, "Facção salva.", "Não foi possível salvar. Atualize a lista e confira se alguém alterou esta facção.", { clearMessage: true });
  }

  function changeTension(item: CampaignFaction, amount: number): Promise<boolean> {
    const tension = Math.max(0, Math.min(12, item.tension + amount));
    if (tension === item.tension) return Promise.resolve(false);
    return mutate(async (db) => ensure(await journal.updateFaction(db, item, campaignId, { tension }), true),
      tension >= item.limit ? `Ruptura: ${item.name} atingiu o limite.` : `Tensão atualizada para ${item.name}.`,
      "Não foi possível atualizar a tensão. Atualize o painel para receber a versão atual.");
  }

  function deleteFaction(item: CampaignFaction): Promise<boolean> {
    if (!window.confirm(`Excluir a facção ${item.name}? Os eventos continuarão no diário sem esse vínculo.`)) return Promise.resolve(false);
    return mutate(async (db) => ensure(await journal.deleteFaction(db, item, campaignId), true),
      "Facção removida.", "Não foi possível remover a facção. Atualize a lista e tente novamente.");
  }

  function saveEvent(draft: EventDraft): Promise<boolean> {
    if (!draft.title.trim() || !draft.occurred_on) {
      setMessage("Informe título e data para o evento.");
      return Promise.resolve(false);
    }
    const values = {
      session_id: draft.session_id || null,
      faction_id: draft.faction_id || null,
      title: draft.title.trim(),
      description: draft.description.trim(),
      occurred_on: draft.occurred_on,
      status: draft.status,
    };
    return mutate(async (db) => {
      if (!draft.id) { ensure(await journal.insertDated(db, "campaign_events", campaignId, values)); return; }
      const existing = events.find((item) => item.id === draft.id);
      if (!existing) throw new Error("stale row");
      ensure(await journal.updateDated(db, "campaign_events", existing, campaignId, values), true);
    }, "Evento salvo.", "Não foi possível salvar. Confira os vínculos e atualize a lista.", { clearMessage: true });
  }

  function deleteEvent(item: CampaignEvent): Promise<boolean> {
    if (!window.confirm(`Excluir o evento ${item.title}?`)) return Promise.resolve(false);
    return mutate(async (db) => ensure(await journal.deleteDated(db, "campaign_events", item, campaignId), true),
      "Evento removido.", "Não foi possível remover o evento. Atualize a lista e tente novamente.");
  }

  function addEntityLink(item: CampaignEvent, draft: LinkDraft): Promise<boolean> {
    if (!draft.entity_id) return Promise.resolve(false);
    return mutate(async (db) => ensure(await journal.linkEventEntity(db, { campaignId, eventId: item.id, entityId: draft.entity_id, kind: draft.link_kind })),
      "Vínculo com o mundo salvo.", "Não foi possível ligar o registro. Ele pode já estar ligado com esse tipo.", { clearMessage: true });
  }

  function removeEntityLink(link: EventEntityLink): Promise<boolean> {
    return mutate(async (db) => ensure(await journal.unlinkEventEntity(db, link.id, campaignId), true),
      "Vínculo removido.", "Não foi possível remover o vínculo. Atualize a lista.");
  }

  function exportJson() {
    try {
      downloadText(`diario-${safePart(campaignId)}.json`, journalJson(campaignId, { sessions, factions, events, entityLinks }, new Date().toISOString()), "application/json;charset=utf-8");
      setMessage("Arquivo JSON do diário salvo.");
    } catch {
      setMessage("Não foi possível gerar o arquivo JSON.");
    }
  }

  function exportMarkdown() {
    try {
      downloadText(`diario-${safePart(campaignId)}.md`, journalMarkdown(campaignId, { sessions, factions, events, entityLinks }), "text/markdown;charset=utf-8");
      setMessage("Arquivo Markdown do diário salvo.");
    } catch {
      setMessage("Não foi possível gerar o arquivo Markdown.");
    }
  }

  return {
    sessions, factions, events, worldEntities, entityLinks, loading, saving, message, syncStatus,
    refresh: () => refreshRef.current(),
    saveSession, deleteSession, saveFaction, changeTension, deleteFaction, saveEvent, deleteEvent, addEntityLink, removeEntityLink,
    exportJson, exportMarkdown,
  };
}

export type CampaignJournal = ReturnType<typeof useCampaignJournal>;
