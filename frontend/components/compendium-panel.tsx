"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  CompendiumEntry,
  compendiumEntries,
  findCompendiumEntry,
  searchCompendium,
} from "../lib/compendium";
import styles from "./compendium-panel.module.css";

type CompendiumPanelProps = {
  selectedNames?: string[];
  onSelect?: (name: string) => void;
};

function EntryDialog({ entry, onClose }: { entry?: CompendiumEntry; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog className={styles.dialog} ref={dialogRef} onClose={onClose} aria-labelledby="compendium-dialog-title">
      <div className={styles.dialogHeader}>
        <div>
          <p className={styles.eyebrow}>DETALHE DO ACERVO</p>
          <h2 id="compendium-dialog-title">{entry?.title ?? "Sem verbete cadastrado"}</h2>
        </div>
        <button className={styles.closeButton} type="button" onClick={() => dialogRef.current?.close()} autoFocus>
          Fechar
        </button>
      </div>
      {entry ? (
        <>
          <p className={styles.description}>{entry.description}</p>
          <dl className={styles.details}>
            <div><dt>Tipo e nível</dt><dd>{entry.type === "discipline" ? "Disciplina" : "Vantagem"}, {entry.level}</dd></div>
            <div><dt>Custo</dt><dd>{entry.cost}</dd></div>
            <div><dt>Parada</dt><dd>{entry.pool}</dd></div>
            <div><dt>Duração</dt><dd>{entry.duration}</dd></div>
            <div><dt>Etiquetas</dt><dd>{entry.tags.join(", ")}</dd></div>
            <div><dt>Proveniência</dt><dd>{entry.source.title}{entry.source.page ? `, página ${entry.source.page}` : ""} ({entry.source.kind})</dd></div>
          </dl>
        </>
      ) : <p className={styles.description}>Este nome não possui verbete cadastrado neste acervo.</p>}
    </dialog>
  );
}

export function CompendiumReference({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const entry = findCompendiumEntry(name);
  return <>
    <button className={styles.reference} type="button" onClick={() => setOpen(true)}>{name}</button>
    {open && <EntryDialog entry={entry} onClose={() => setOpen(false)} />}
  </>;
}

export function CompendiumPanel({ selectedNames = [], onSelect }: CompendiumPanelProps) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [level, setLevel] = useState("all");
  const [preservedMask, setPreservedMask] = useState(false);
  const [detail, setDetail] = useState<CompendiumEntry | undefined>();
  const baseResults = useMemo(() => searchCompendium(query), [query]);
  const results = baseResults.filter((entry) =>
    (type === "all" || entry.type === type) &&
    (level === "all" || entry.level === Number(level)) &&
    (!preservedMask || entry.tags.includes("mascara-preservada")),
  );
  const selected = new Set(selectedNames.map((name) => name.toLocaleLowerCase("pt-BR")));

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>ACERVO DA CAMPANHA</p>
          <h2 id={`${id}-title`}>Compêndio</h2>
          <p>Acervo com exemplos homebrew originais. Dados V5 autorizados estão pendentes.</p>
        </div>
        <span className={styles.count}>{compendiumEntries.length} exemplos</span>
      </header>

      <div className={styles.filters}>
        <label className={styles.searchLabel} htmlFor={`${id}-query`}>Buscar por nome, etiqueta ou descrição
          <input id={`${id}-query`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: contato" />
        </label>
        <label htmlFor={`${id}-type`}>Tipo
          <select id={`${id}-type`} value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">Todos</option><option value="discipline">Disciplina</option><option value="advantage">Vantagem</option>
          </select>
        </label>
        <label htmlFor={`${id}-level`}>Nível
          <select id={`${id}-level`} value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="all">Todos</option>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className={styles.checkbox} htmlFor={`${id}-mask`}>
          <input id={`${id}-mask`} type="checkbox" checked={preservedMask} onChange={(event) => setPreservedMask(event.target.checked)} />
          Etiqueta manual: mascara-preservada
        </label>
      </div>

      <div className={styles.results} aria-live="polite">
        {results.length === 0 && <p>Nenhum exemplo corresponde aos filtros.</p>}
        {results.map((entry) => {
          const isSelected = selected.has(entry.title.toLocaleLowerCase("pt-BR"));
          return <article className={styles.card} key={entry.id}>
            <div className={styles.cardTop}>
              <div><p className={styles.cardMeta}>{entry.type === "discipline" ? "Disciplina" : "Vantagem"} · nível {entry.level}</p><h3>{entry.title}</h3></div>
              <button type="button" className={isSelected ? styles.selectedButton : styles.selectButton} aria-pressed={isSelected} onClick={() => onSelect?.(entry.title)}>
                {isSelected ? "Selecionado" : "Adicionar à ficha"}
              </button>
            </div>
            <p>{entry.description}</p>
            <div className={styles.cardBottom}>
              <span>{entry.tags.join(" · ")}</span>
              <button type="button" className={styles.detailButton} onClick={() => setDetail(entry)}>Ver detalhe</button>
            </div>
          </article>;
        })}
      </div>
      {detail && <EntryDialog entry={detail} onClose={() => setDetail(undefined)} />}
    </section>
  );
}
