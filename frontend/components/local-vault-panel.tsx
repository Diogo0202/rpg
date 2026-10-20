"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { printableSheetHtml } from "../lib/printable-sheet";
import {
  createSheetBackup,
  createVaultBackup,
  mechanicallyEquivalentFields,
  MAX_VAULT_DOCUMENTS,
  parseBackupText,
  validateBackup,
  type SheetBackup,
} from "../lib/sheet-backup";
import styles from "./local-vault-panel.module.css";
import { EMPTY_VAULT_METADATA, filterAndSortVault, parseTagsInput, validateNamedVaultFilters, validateVaultFilter, validateVaultMetadata, type NamedVaultFilter, type VaultMetadata, type VaultSort } from "../lib/vault-metadata";

type Props = {
  campaignId: string;
  viewerId: string;
  canEditSheets: boolean;
  canManageTemplates: boolean;
};

type StoredCopy = { id: string; createdAt: string; updatedAt: string; backup: SheetBackup; metadata?: VaultMetadata };
type RemoteTemplate = { id: string; name: string; version: number; schema: unknown };
type RemoteSheet = { id: string; name: string; template_id: string; values: unknown; effects: unknown };
type RemoteInventory = {
  sheet_id: string; name: string; category: string; quantity: number; resource_cost: number;
  damage_bonus: number; protection: number; notes: string; acquired: boolean; equipped: boolean; sort_order: number;
};

function vaultKey(viewerId: string): string {
  return `rpg-nexus:vault:v1:${encodeURIComponent(viewerId)}`;
}
function filtersKey(viewerId: string): string { return `rpg-nexus:vault-filters:v1:${encodeURIComponent(viewerId)}`; }

function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function makeRemoteBackup(sheet: RemoteSheet, template: RemoteTemplate, inventory: RemoteInventory[]): SheetBackup {
  const rawTemplate = template.schema as { fields?: unknown } | null;
  const fields = Array.isArray(rawTemplate?.fields) ? rawTemplate.fields.map((field) => {
    if (!field || typeof field !== "object") return field;
    const row = field as Record<string, unknown>;
    return { id: row.id, label: row.label, kind: row.kind, required: row.required, options: row.options ?? [], expression: row.expression ?? null, ...(row.depends_on ? { depends_on: row.depends_on } : {}) };
  }) : rawTemplate?.fields;
  const effects = Array.isArray(sheet.effects) ? sheet.effects.map((effect) => {
    if (!effect || typeof effect !== "object") return effect;
    const row = effect as Record<string, unknown>;
    return {
      id: row.id, label: row.label, delta: row.delta, enabled: row.enabled ?? true,
      applies_to_tags: row.applies_to_tags ?? [], exempt_tags: row.exempt_tags ?? [],
      remaining_scenes: row.remaining_scenes ?? null, source_note: row.source_note ?? null,
    };
  }) : sheet.effects;
  return createSheetBackup({
    name: sheet.name,
    template: { name: template.name, version: template.version, fields },
    values: sheet.values,
    effects,
    inventory: inventory.map((item) => ({
      name: item.name, category: item.category, quantity: item.quantity,
      resource_cost: item.resource_cost, damage_bonus: item.damage_bonus,
      protection: item.protection, notes: item.notes, acquired: item.acquired,
      equipped: item.equipped, sort_order: item.sort_order,
    })),
  });
}

function makeStoredCopy(backup: SheetBackup, name = backup.name): StoredCopy {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    backup: validateBackup({ ...backup, name }),
    metadata: { ...EMPTY_VAULT_METADATA },
  };
}

export function LocalVaultPanel({ campaignId, viewerId, canEditSheets, canManageTemplates }: Props) {
  const [copies, setCopies] = useState<StoredCopy[]>([]);
  const [templates, setTemplates] = useState<RemoteTemplate[]>([]);
  const [sheets, setSheets] = useState<RemoteSheet[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<VaultSort>("updated");
  const [levelFilter, setLevelFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [savedFilters, setSavedFilters] = useState<NamedVaultFilter[]>([]);
  const [filtersReady, setFiltersReady] = useState(false);
  const [filterName, setFilterName] = useState("");
  const [metadataDrafts, setMetadataDrafts] = useState<Record<string, VaultMetadata>>({});
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [importText, setImportText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const mayCopy = canEditSheets || canManageTemplates;
  const key = vaultKey(viewerId);
  const copiesRef=useRef(copies);copiesRef.current=copies;
  const liveContext=useRef({key,campaignId});liveContext.current={key,campaignId};

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setMetadataDrafts({});
    setTagDrafts({});
    setRenameDrafts({});
    setCopies([]);
    copiesRef.current=[];
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        if (new TextEncoder().encode(raw).byteLength > MAX_VAULT_DOCUMENTS * 1_048_576) throw new Error("O cofre local excede o limite de 50 MB.");
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || parsed.length > MAX_VAULT_DOCUMENTS) throw new Error("O cofre local está inválido ou excede 50 fichas.");
        const recovered = parsed.map((item): StoredCopy => {
          if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("O cofre local contém um registro inválido.");
          const row = item as Record<string, unknown>;
          if (typeof row.id !== "string" || typeof row.createdAt !== "string" || typeof row.updatedAt !== "string") throw new Error("O cofre local contém metadados inválidos.");
          return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, backup: validateBackup(row.backup), metadata: row.metadata === undefined ? { ...EMPTY_VAULT_METADATA } : validateVaultMetadata(row.metadata) };
        });
        if (active) { setCopies(recovered);copiesRef.current=recovered; }
      }
      if (active) setNotice("");
      if (active) setLoaded(true);
    } catch (error) {
      if (active) setNotice(`Não foi possível ler o cofre local: ${error instanceof Error ? error.message : "acesso ao armazenamento recusado"}`);
    }
    return () => { active = false; };
  }, [key]);

  const namedFiltersKey = filtersKey(viewerId);
  useEffect(() => {
    let active = true;
    setFiltersReady(false);
    setSavedFilters([]);
    try {
      const raw = window.localStorage.getItem(namedFiltersKey);
      if (raw) {
        if (new TextEncoder().encode(raw).byteLength > 256_000) throw new Error("O arquivo de filtros excede o limite local.");
        const parsed = validateNamedVaultFilters(JSON.parse(raw));
        if (active) setSavedFilters(parsed);
      }
      if (active) setFiltersReady(true);
    } catch (error) { if (active) setNotice(`N\u00e3o foi poss\u00edvel ler filtros salvos: ${error instanceof Error ? error.message : "dados inv\u00e1lidos"}`); }
    return () => { active = false; };
  }, [namedFiltersKey]);

  useEffect(() => {
    let active = true;
    setTemplates([]);
    setSheets([]);
    async function loadRemote() {
      setBusy(true);
      try {
        const supabase = createClient();
        const [templateResult, sheetResult] = await Promise.all([
          supabase.from("system_templates").select("id, name, version, schema").eq("campaign_id", campaignId).eq("status", "approved").order("name"),
          supabase.from("character_sheets").select("id, name, template_id, values, effects").eq("campaign_id", campaignId).order("name"),
        ]);
        if (templateResult.error || sheetResult.error) throw new Error("O Supabase recusou a leitura conforme as permissões da campanha.");
        if (!active) return;
        setTemplates((templateResult.data ?? []) as RemoteTemplate[]);
        setSheets((sheetResult.data ?? []) as RemoteSheet[]);
      } catch (error) {
        if (active) { setTemplates([]); setSheets([]); setNotice(error instanceof Error ? error.message : "Falha ao carregar dados remotos."); }
      } finally {
        if (active) setBusy(false);
      }
    }
    void loadRemote();
    return () => { active = false; };
  }, [campaignId, viewerId]);

  function commit(next: StoredCopy[], successMessage: string) {
    if (!loaded) {
      setNotice("Aguarde a leitura do cofre local antes de alterá-lo.");
      return false;
    }
    if (next.length > MAX_VAULT_DOCUMENTS) {
      setNotice("O cofre aceita até 50 fichas.");
      return false;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      copiesRef.current=next;
      setCopies(next);
      setNotice(successMessage);
      return true;
    } catch (error) {
      setNotice(error instanceof DOMException && error.name === "QuotaExceededError"
        ? "O armazenamento local está sem espaço. Nenhuma alteração foi salva."
        : "O navegador recusou o acesso ao armazenamento. Nenhuma alteração foi salva.");
      return false;
    }
  }

  async function copyRemote(sheet: RemoteSheet) {
    const requestedKey=key;
    const template = templates.find((item) => item.id === sheet.template_id);
    if (!template) { setNotice("O modelo aprovado desta ficha não está disponível nesta campanha."); return; }
    try {
      const inventoryResult = await createClient().from("character_inventory")
        .select("sheet_id, name, category, quantity, resource_cost, damage_bonus, protection, notes, acquired, equipped, sort_order")
        .eq("sheet_id", sheet.id).eq("campaign_id",campaignId).order("sort_order");
      if(liveContext.current.key!==requestedKey||liveContext.current.campaignId!==campaignId)return;
      if (inventoryResult.error) throw new Error("Não foi possível ler o equipamento conforme as permissões da campanha.");
      const backup = makeRemoteBackup(sheet, template, (inventoryResult.data ?? []) as RemoteInventory[]);
      const row = makeStoredCopy(backup);
      commit([...copiesRef.current, row], `Cópia local de “${row.backup.name}” salva.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "A ficha não pôde ser copiada.");
    }
  }

  function renameCopy(row: StoredCopy) {
    const name = (renameDrafts[row.id] ?? row.backup.name).trim();
    if (!name || name.length > 120) { setNotice("O nome deve ter entre 1 e 120 caracteres."); return; }
    const next = copiesRef.current.map((item) => item.id === row.id ? { ...item, updatedAt: new Date().toISOString(), backup: validateBackup({ ...item.backup, name }) } : item);
    if (commit(next, "Cópia renomeada no cofre local.")) setRenameDrafts((current) => { const copy = { ...current }; delete copy[row.id]; return copy; });
  }

  function duplicateCopy(row: StoredCopy) {
    const duplicate = makeStoredCopy(row.backup, `${row.backup.name.slice(0,112)} (cópia)`);
    duplicate.metadata = validateVaultMetadata(row.metadata ?? EMPTY_VAULT_METADATA);
    commit([...copiesRef.current, duplicate], "Cópia duplicada no cofre local.");
  }

  function saveMetadata(row: StoredCopy) {
    try {
      const draft = metadataDrafts[row.id] ?? row.metadata ?? EMPTY_VAULT_METADATA;
      const metadata = validateVaultMetadata({ ...draft, tags: tagDrafts[row.id] === undefined ? draft.tags : parseTagsInput(tagDrafts[row.id]) });
      const next = copiesRef.current.map((item) => item.id === row.id ? { ...item, metadata, updatedAt: new Date().toISOString() } : item);
      if (commit(next, "Metadados guardados neste navegador.")) setTagDrafts((current) => { const nextDrafts = { ...current }; delete nextDrafts[row.id]; return nextDrafts; });
    } catch (error) { setNotice(error instanceof Error ? error.message : "Metadados inválidos."); }
  }

  function saveNamedFilter() {
    if (!filtersReady) { setNotice("Filtros salvos indispon\u00edveis enquanto os dados locais s\u00e3o lidos ou est\u00e3o inv\u00e1lidos."); return; }
    const name = filterName.trim();
    if (!name || name.length > 48) { setNotice("O nome do filtro deve ter entre 1 e 48 caracteres."); return; }
    if (savedFilters.length >= 20) { setNotice("O limite de filtros salvos por conta é 20."); return; }
    const next = [...savedFilters, { id: crypto.randomUUID(), name, query, level: levelFilter, tag: tagFilter, sort }];
    try { window.localStorage.setItem(namedFiltersKey, JSON.stringify(next)); setSavedFilters(next); setFilterName(""); setNotice("Filtro salvo nesta conta e neste navegador."); }
    catch { setNotice("O navegador recusou o armazenamento do filtro."); }
  }

  function deleteNamedFilter(id: string) {
    if (!filtersReady) return;
    const next = savedFilters.filter((filter) => filter.id !== id);
    try { window.localStorage.setItem(namedFiltersKey, JSON.stringify(next)); setSavedFilters(next); setNotice("Filtro salvo removido."); }
    catch { setNotice("O navegador recusou a remoção do filtro."); }
  }

  function compatibleTemplate(backup:SheetBackup){
    return templates.find(template=>{
      const schema=template.schema as {fields?:unknown}|null;
      if(!Array.isArray(schema?.fields))return false;
      return mechanicallyEquivalentFields(schema.fields, backup.template.fields);
    });
  }

  async function restoreRemote(input:SheetBackup){
    if(!mayCopy||busy)return;
    const requestedKey=key;
    setBusy(true);
    try{
      const backup=validateBackup(input);
      const template=compatibleTemplate(backup);
      if(!template)throw new Error("A campanha precisa ter um modelo aprovado com os mesmos campos antes de restaurar esta cópia.");
      const {data,error}=await createClient().rpc("restore_character_backup",{p_campaign_id:campaignId,p_template_id:template.id,p_backup:backup});
      if(liveContext.current.key!==requestedKey||liveContext.current.campaignId!==campaignId)return;
      if(error||!data)throw new Error("A restauração foi recusada. Confira o modelo, as permissões e a migration de restauração.");
      const row=(Array.isArray(data)?data[0]:data)as RemoteSheet;
      setSheets(current=>[...current,row]);
      setNotice("Nova ficha restaurada na campanha, com efeitos e inventário. Selecione-a na barra da sessão para editar.");
    }catch(error){if(liveContext.current.key===requestedKey&&liveContext.current.campaignId===campaignId)setNotice(error instanceof Error?error.message:"Falha ao restaurar a ficha.");}
    finally{if(liveContext.current.key===requestedKey&&liveContext.current.campaignId===campaignId)setBusy(false);}
  }

  function importCopies() {
    try {
      const backups = parseBackupText(importText);
      if (backups.length === 0) throw new Error("O arquivo não contém fichas.");
      if (copies.length + backups.length > MAX_VAULT_DOCUMENTS) throw new Error("A importação ultrapassa o limite de 50 fichas.");
      const imported = backups.map((backup) => makeStoredCopy(backup));
      if (commit([...copies, ...imported], `${imported.length} ficha(s) importada(s) apenas para este cofre local.`)) setImportText("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "A importação foi recusada.");
    }
  }

  async function readImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 50 * 1_048_576) { setNotice("O arquivo ultrapassa o limite de 50 MB."); return; }
    try { setImportText(await file.text()); setNotice("Arquivo carregado. Revise e importe para o cofre local."); }
    catch { setNotice("Não foi possível ler o arquivo selecionado."); }
  }

  function openPrintable(backup: SheetBackup) {
    const url = URL.createObjectURL(new Blob([printableSheetHtml(backup)], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setNotice("Solicitei a abertura da versão de impressão em uma nova aba. Use a opção Imprimir do navegador e escolha salvar como PDF; se a aba não aparecer, confira o bloqueio de pop-ups.");
  }

  const visibleCopies = useMemo(() => filterAndSortVault(copies.map((row) => ({ ...row, name: row.backup.name, system: row.backup.template.name, concept: row.metadata?.concept ?? "", tags: row.metadata?.tags ?? [], level: row.metadata?.level ?? null })), { query, level: levelFilter, tag: tagFilter, sort }), [copies, query, levelFilter, tagFilter, sort]);

  function applySavedFilter(filter: NamedVaultFilter) {
    try {
      const checked = validateVaultFilter(filter);
      setQuery(checked.query); setLevelFilter(checked.level); setTagFilter(checked.tag); setSort(checked.sort);
      setNotice(`Filtro \u201c${filter.name}\u201d aplicado.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Filtro salvo inv\u00e1lido."); }
  }

  return <section className={styles.panel} aria-labelledby="local-vault-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>DADOS DESTE NAVEGADOR</p><h2 id="local-vault-title">Cofre local de fichas</h2>
        <p>As copias ficam isoladas pela conta atual. Nivel, conceito, tags e filtros ficam somente neste navegador e nao sao exportados no backup JSON v1. Restaurar uma copia na campanha cria uma nova ficha usando um modelo aprovado com os mesmos campos.</p></div>
      <span className={styles.count}>{copies.length}/{MAX_VAULT_DOCUMENTS}</span>
    </header>
    <p className={styles.notice} role="status" aria-live="polite">{notice || (!loaded ? "Lendo cofre local…" : busy ? "Consultando fichas permitidas nesta campanha…" : "")}</p>

    <section className={styles.remote} aria-labelledby="remote-vault-title">
      <div className={styles.sectionHeading}><h3 id="remote-vault-title">Fichas visíveis nesta campanha</h3><span>Templates aprovados pela campanha</span></div>
      {sheets.length === 0 ? <p className={styles.muted}>{busy ? "Carregando…" : "Nenhuma ficha visível pelas permissões atuais."}</p> : <ul className={styles.remoteList}>
        {sheets.map((sheet) => <li key={sheet.id}><span><strong>{sheet.name}</strong><small>{templates.find((item) => item.id === sheet.template_id)?.name ?? "Modelo não disponível"}</small></span>
          <button type="button" disabled={!mayCopy || !loaded || copies.length >= MAX_VAULT_DOCUMENTS} onClick={() => copyRemote(sheet)}>Copiar para cofre local</button></li>)}
      </ul>}
    </section>

    <section className={styles.local} aria-labelledby="local-copies-title">
      <div className={styles.sectionHeading}><h3 id="local-copies-title">Minhas copias</h3><label>Buscar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, modelo, conceito ou tag" maxLength={120} disabled={busy} /></label>
        <label>Nivel<select disabled={busy} value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}><option value="">Todos</option>{Array.from({ length: 100 }, (_, index) => <option key={index + 1} value={String(index + 1)}>{index + 1}</option>)}</select></label>
        <label>Tag<input disabled={busy} value={tagFilter} maxLength={32} onChange={(event) => setTagFilter(event.target.value)} placeholder="Filtrar tag" /></label>
        <label>Ordenar<select disabled={busy} value={sort} onChange={(event) => setSort(event.target.value as VaultSort)}><option value="updated">Atualizacao</option><option value="created">Criacao</option><option value="name">Nome</option><option value="system">Sistema/modelo</option></select></label>
        <label>Nome do filtro<input disabled={busy || !filtersReady} value={filterName} maxLength={48} onChange={(event) => setFilterName(event.target.value)} placeholder="Salvar filtro atual" /></label><button type="button" disabled={busy || !filtersReady || savedFilters.length >= 20} onClick={saveNamedFilter}>Salvar filtro</button>
        {savedFilters.map((filter) => <span key={filter.id}><button type="button" disabled={busy || !filtersReady} onClick={() => applySavedFilter(filter)}>{filter.name}</button><button type="button" disabled={!filtersReady} aria-label={`Excluir filtro ${filter.name}`} onClick={() => deleteNamedFilter(filter.id)}>Excluir</button></span>)}</div>
      {visibleCopies.length === 0 ? <p className={styles.muted}>O cofre ainda não tem cópias.</p> : <ul className={styles.copyList}>{visibleCopies.map((row) => <li key={row.id}>
        <div className={styles.copyTitle}><strong>{row.backup.name}</strong><small>{row.backup.template.name} · atualizado {new Date(row.updatedAt).toLocaleString("pt-BR")}</small></div>
        <label className={styles.rename}>Renomear<input disabled={busy} value={renameDrafts[row.id] ?? row.backup.name} maxLength={120} onChange={(event) => setRenameDrafts((current) => ({ ...current, [row.id]: event.target.value }))} /></label>
        <fieldset className={styles.metadata} disabled={busy || !loaded}>
          <legend>Metadados locais, fora do backup JSON v1</legend>
          <label>Nivel opcional<input type="number" min={1} max={100} value={(metadataDrafts[row.id] ?? row.metadata ?? EMPTY_VAULT_METADATA).level ?? ""} onChange={(event) => setMetadataDrafts((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? row.metadata ?? EMPTY_VAULT_METADATA), level: event.target.value ? Number(event.target.value) : null } }))} /></label>
          <label>Conceito<textarea maxLength={500} value={(metadataDrafts[row.id] ?? row.metadata ?? EMPTY_VAULT_METADATA).concept} onChange={(event) => setMetadataDrafts((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? row.metadata ?? EMPTY_VAULT_METADATA), concept: event.target.value } }))} /></label>
          <label>Tags, separadas por virgula<input maxLength={700} value={tagDrafts[row.id] ?? (metadataDrafts[row.id] ?? row.metadata ?? EMPTY_VAULT_METADATA).tags.join(", ")} onChange={(event) => setTagDrafts((current) => ({ ...current, [row.id]: event.target.value }))} /></label>
          <button type="button" disabled={busy} onClick={() => saveMetadata(row)}>Salvar metadados</button>
        </fieldset>
        <div className={styles.actions}><button type="button" disabled={busy || !loaded} onClick={() => renameCopy(row)}>Salvar nome</button><button type="button" onClick={() => duplicateCopy(row)} disabled={busy || !loaded || copies.length >= MAX_VAULT_DOCUMENTS}>Duplicar</button>
          <button type="button" disabled={busy} onClick={() => downloadJson(`${row.backup.name.replace(/[^\p{L}\p{N}_-]+/gu, "-")}.json`, row.backup)}>Exportar JSON</button><button type="button" disabled={busy} onClick={() => openPrintable(row.backup)}>Abrir versão de impressão / salvar PDF</button>
          <button type="button" disabled={busy||!mayCopy||!compatibleTemplate(row.backup)} onClick={()=>void restoreRemote(row.backup)}>Restaurar cópia na campanha</button>
          <button type="button" className={styles.danger} disabled={busy || !loaded} onClick={() => commit(copies.filter((item) => item.id !== row.id), "Cópia removida apenas do cofre local.")}>Excluir</button></div>
      </li>)}</ul>}
    </section>

    <section className={styles.portability} aria-labelledby="vault-transfer-title">
      <h3 id="vault-transfer-title">Portabilidade JSON</h3>
      <div className={styles.actions}><button type="button" disabled={copies.length === 0} onClick={() => {
        try { downloadJson("rpg-nexus-cofre.json", createVaultBackup(copies.map((row) => row.backup))); setNotice("Backup completo do cofre preparado para baixar."); }
        catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao preparar o backup."); }
      }}>Exportar cofre completo</button></div>
      <label className={styles.fileInput}>Selecionar arquivo JSON<input disabled={busy} type="file" accept="application/json,.json" onChange={(event) => void readImportFile(event)} /></label>
      <label className={styles.importLabel}>Ou cole o conteúdo JSON<textarea disabled={busy} value={importText} onChange={(event) => setImportText(event.target.value)} rows={6} maxLength={50 * 1_048_576} placeholder="Backup de uma ficha ou do cofre completo" /></label>
      <div className={styles.actions}><button type="button" onClick={importCopies} disabled={busy || !loaded || !importText.trim() || copies.length >= MAX_VAULT_DOCUMENTS}>Validar e importar para cofre local</button></div>
      <p className={styles.muted}>O arquivo individual aceita até 1 MB. O backup completo aceita até 50 fichas e 50 MB. Expressões de fórmula e rolagem são texto, nunca executado durante a importação.</p>
    </section>
  </section>;
}
