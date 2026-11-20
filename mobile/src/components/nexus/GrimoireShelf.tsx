import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  BOOKS_PER_SHELF,
  canAnimateGrimoire,
  closeGrimoire,
  grimoireCover,
  grimoireStyle,
  openGrimoire,
  shelfNumeral,
  shelvesOf,
} from "../../../../shared/grimoire-shelf";
import "../../../../shared/grimoire-shelf.css";

export type GrimoireBook = {
  id: string;
  title: string;
  subtitle?: string;
  systemKey?: string | null;
  /** Texto do rodapé da capa; o gênero do sistema entra quando falta. */
  footnote?: string;
  selected?: boolean;
  /** Mostra a ilustração do sistema na capa (livros de sistema; fichas ficam no couro). */
  art?: boolean;
};

type Props = {
  label: string;
  books: GrimoireBook[];
  /** Ação ao abrir; chamada depois da animação da capa. */
  onOpen: (book: GrimoireBook) => void;
  /** Rótulo do rodapé ao passar o mouse. */
  openLabel?: string;
  /** Sem animação de abrir: o livro só fica destacado (escolha dentro de um passo). */
  selectOnly?: boolean;
  disabled?: boolean;
  addSlot?: { title: string; hint?: string; onClick: () => void };
};

type Slot = { kind: "book"; book: GrimoireBook } | { kind: "add" };

export function GrimoireShelf({
  label,
  books,
  onOpen,
  openLabel = "Abrir tomo",
  selectOnly = false,
  disabled = false,
  addSlot,
}: Props) {
  const caseRef = useRef<HTMLDivElement>(null);
  const slots: Slot[] = books.map((book) => ({ kind: "book", book }));
  if (addSlot) slots.push({ kind: "add" });
  const shelves = shelvesOf(slots);

  function open(book: GrimoireBook, element: HTMLElement) {
    if (disabled || caseRef.current?.dataset.active) return;
    if (selectOnly || !canAnimateGrimoire(element)) {
      onOpen(book);
      return;
    }
    void openGrimoire(element).then(() => {
      onOpen(book);
      if (element.isConnected) closeGrimoire(element);
    });
  }

  return (
    <div className="grimoire-case" ref={caseRef} role="region" aria-label={label}>
      <div className="grimoire-cornice">
        <span className="grimoire-cornice-label">{label}</span>
      </div>
      <div className="grimoire-body">
        {shelves.map((shelf, index) => {
          const filled = shelf.filter((slot) => slot.kind === "book").length;
          const free = BOOKS_PER_SHELF - shelf.length;
          return (
            <section
              className="grimoire-shelf"
              key={index}
              aria-label={`Prateleira ${shelfNumeral(index + 1)}`}
            >
              <div className="grimoire-niche">
                <div className="grimoire-plaque" aria-hidden="true">
                  <span className="grimoire-plaque-name">Prateleira {shelfNumeral(index + 1)}</span>
                  <span className="grimoire-plaque-count">
                    {filled} / {BOOKS_PER_SHELF} tomos
                  </span>
                </div>
                <ul className="grimoire-row">
                  {shelf.map((slot) =>
                    slot.kind === "book" ? (
                      <li className="grimoire-slot" key={slot.book.id}>
                        <Book
                          book={slot.book}
                          openLabel={openLabel}
                          disabled={disabled}
                          onOpen={open}
                        />
                      </li>
                    ) : (
                      <li className="grimoire-slot" key="add-slot">
                        <button
                          type="button"
                          className="grimoire-empty grimoire-empty--action"
                          disabled={disabled}
                          onClick={addSlot?.onClick}
                        >
                          <span className="grimoire-empty-plus" aria-hidden="true">
                            +
                          </span>
                          <span className="grimoire-empty-title">{addSlot?.title}</span>
                          {addSlot?.hint && (
                            <span className="grimoire-empty-hint">{addSlot.hint}</span>
                          )}
                        </button>
                      </li>
                    ),
                  )}
                  {Array.from({ length: free }, (_, slot) => (
                    <li className="grimoire-slot" key={`free-${slot}`} aria-hidden="true">
                      <span className="grimoire-empty">Espaço livre</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grimoire-plank" aria-hidden="true" />
            </section>
          );
        })}
      </div>
      <div className="grimoire-base" aria-hidden="true" />
    </div>
  );
}

function Book({
  book,
  openLabel,
  disabled,
  onOpen,
}: {
  book: GrimoireBook;
  openLabel: string;
  disabled: boolean;
  onOpen: (book: GrimoireBook, element: HTMLElement) => void;
}) {
  const cover = grimoireCover(book.systemKey, book.title);
  const footnote = book.footnote ?? cover.genre;
  const [artFailed, setArtFailed] = useState(false);
  const art = book.art && cover.art && !artFailed ? cover.art : undefined;
  const artRef = useRef<HTMLImageElement>(null);
  // Com HTML vindo do servidor, a imagem pode falhar antes de o React ligar o onError.
  useEffect(() => {
    const image = artRef.current;
    if (image?.complete && image.naturalWidth === 0) setArtFailed(true);
  }, [art]);
  return (
    <button
      type="button"
      className="grimoire-book"
      style={grimoireStyle(cover) as CSSProperties}
      data-selected={book.selected ? "true" : undefined}
      aria-pressed={book.selected === undefined ? undefined : book.selected}
      aria-label={book.subtitle ? `${book.title} — ${book.subtitle}` : book.title}
      disabled={disabled}
      onClick={(event) => onOpen(book, event.currentTarget)}
    >
      <span className="grimoire-pages" aria-hidden="true">
        <span>
          <span className="grimoire-pages-engine">{cover.engine}</span>
          <span className="grimoire-pages-title">{book.title}</span>
        </span>
        <span className="grimoire-pages-lines" />
        <span className="grimoire-pages-note">Abrindo grimório…</span>
      </span>
      <span className="grimoire-spine" aria-hidden="true">
        <span className="grimoire-spine-code">{cover.code}</span>
        <span className="grimoire-spine-mark">{cover.mark}</span>
      </span>
      <span className="grimoire-cover" aria-hidden="true" data-art={art ? "true" : undefined}>
        {art && (
          <img
            className="grimoire-art"
            ref={artRef}
            src={art}
            alt=""
            draggable={false}
            onError={() => setArtFailed(true)}
          />
        )}
        <span className="grimoire-frame">
          <span className="grimoire-top">
            <span className="grimoire-engine">{cover.engine}</span>
            <span className="grimoire-mark">{cover.mark}</span>
          </span>
          <span className="grimoire-heading">
            <span className="grimoire-title">{book.title}</span>
            <span className="grimoire-rule" />
            {book.subtitle && <span className="grimoire-subtitle">{book.subtitle}</span>}
          </span>
          <span className="grimoire-genre">
            <span className="grimoire-genre-rest">{footnote}</span>
            <span className="grimoire-genre-hover">{openLabel}</span>
          </span>
        </span>
      </span>
    </button>
  );
}
