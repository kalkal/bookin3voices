// Contratto di accesso ai capitoli (Repository pattern): la UI non
// importa mai l'SDK di persistenza. Due livelli di contratto:
//  - ChapterTextRepository: il minimo che serve a Dettatura ed Editor
// — caricare e salvare il testo grezzo;
//  - ChapterRepository: il Contratto completo (CRUD, riordino
//    e sottoscrizioni `observe*`), implementato su Firestore dalla integrazione Firestore.

import { z } from 'zod';

/** Coordinate di un capitolo dentro un libro (rispecchia il path del). */
export interface ChapterRef {
  bookId: string;
  chapterId: string;
}

/** Stati del capitolo: bozza → rifinito → finale. */
export const CHAPTER_STATUSES = ['draft', 'refined', 'final'] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

/**
 * Traccia del capitolo generata dalla scaletta (Fase 2):
 * riassunto e beat principali. Il titolo proposto vive nel `title` del
 * capitolo stesso. Visibile in dettatura come traccia.
 */
export const chapterOutlineSchema = z.object({
  summary: z.string(),
  beats: z.array(z.string()),
  /**
   * Indici (0-based) dei beat spuntati in dettatura: puro segno visivo
   * di "coperto", nessuna automazione. Additivo come `outline`: i documenti
   * nati prima si normalizzano a [] senza bump di schemaVersion. Vive DENTRO
   * l'outline così una rigenerazione della traccia riparte con i beat da fare.
   */
  beatsDone: z.array(z.number().int().min(0)).default([]),
});

export type ChapterOutline = z.infer<typeof chapterOutlineSchema>;

/**
 * Documento capitolo come vive su Firestore, validato al confine.
 * `updatedAt` viaggia nel dominio come millisecondi epoch: i tipi dell'SDK
 * (Timestamp) non escono mai dal repository.
 * `outline` è additivo (Fase 2): i documenti nati prima non ce l'hanno,
 * il default li normalizza a null senza bump di schemaVersion.
 */
export const chapterDocSchema = z.object({
  schemaVersion: z.literal(1),
  order: z.number().int().min(0),
  title: z.string(),
  status: z.enum(CHAPTER_STATUSES),
  wordCount: z.number().int().min(0),
  rawText: z.string(),
  outline: chapterOutlineSchema.nullable().default(null),
  updatedAt: z.number(),
});

export type ChapterDoc = z.infer<typeof chapterDocSchema>;

/** Capitolo completo (documento + coordinate), per editor e dettatura. */
export interface Chapter extends ChapterDoc {
  id: string;
  bookId: string;
}

/**
 * Riga della lista capitoli (tab Capitoli del Libro). Niente rawText:
 * la lista non deve dipendere dal testo integrale.
 */
export interface ChapterSummary {
  id: string;
  bookId: string;
  order: number;
  title: string;
  status: ChapterStatus;
  wordCount: number;
  updatedAt: number;
}

/** Campi modificabili di un capitolo (il testo passa da saveRawText). */
export interface ChapterPatch {
  title?: string;
  status?: ChapterStatus;
  outline?: ChapterOutline | null;
}

export interface CreateChapterInput {
  title: string;
  /** Traccia dalla scaletta (Fase 2); assente = capitolo senza outline. */
  outline?: ChapterOutline;
}

/**
 * Contratto minimo usato da Dettatura ed Editor: solo il testo grezzo.
 * Le schermate che scrivono testo dipendono da questo, non dal CRUD completo.
 */
export interface ChapterTextRepository {
  /**
   * Testo grezzo del capitolo, o null se il capitolo non è mai stato salvato.
   * Un errore di lettura è un'eccezione: mai confondere "vuoto" con "rotto".
   */
  loadRawText(ref: ChapterRef): Promise<string | null>;
  /** Sostituisce il testo grezzo del capitolo (fonte di verità). */
  saveRawText(ref: ChapterRef, rawText: string): Promise<void>;
}

/** Ferma una sottoscrizione observe* (Observer del). */
export type Unsubscribe = () => void;

/**
 * Contratto completo. Le scritture sono ottimistiche
 * (Optimistic UI): risolvono appena la mutazione è presa in carico dal
 * layer di persistenza; l'esito consolidato arriva dagli observe*.
 */
export interface ChapterRepository extends ChapterTextRepository {
  /** Lista ordinata per `order`; si riemette a ogni cambiamento. */
  observeChapters(
    bookId: string,
    onChange: (chapters: ChapterSummary[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
  observeChapter(
    ref: ChapterRef,
    onChange: (chapter: Chapter | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe;
  getChapter(ref: ChapterRef): Promise<Chapter | null>;
  /** Crea in coda (order = max + 1) e incrementa book.chapterCount. */
  createChapter(bookId: string, input: CreateChapterInput): Promise<Chapter>;
  updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void>;
  /**
   * Riscrive `order` secondo l'ordine degli id ricevuti (drag&drop del).
   * Id mancanti o estranei sono un errore: il riordino è totale, mai parziale.
   */
  reorderChapters(bookId: string, orderedIds: readonly string[]): Promise<void>;
  /** Elimina il capitolo e aggiorna i contatori denormalizzati del libro. */
  deleteChapter(ref: ChapterRef): Promise<void>;
}
