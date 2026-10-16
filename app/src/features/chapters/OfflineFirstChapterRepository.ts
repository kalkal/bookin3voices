// Composito offline-first: Firestore + mirror locale su disco.
//
// Perché esiste: il JS SDK di Firestore su React Native ha SOLO la cache in
// memoria (niente IndexedDB), quindi una scrittura in coda offline muore con
// l'app. Regola:  il testo dettato non viva mai solo in RAM:
// qui ogni salvataggio tocca PRIMA il mirror AsyncStorage (durabile) e poi
// Firestore; alla lettura vince il più recente, e un mirror più fresco del
// remoto viene rispinto verso Firestore (recovery della sessione morta offline).
//
// Regola di convivenza 2: durante una sessione il capitolo ha un solo
// scrittore, quindi il confronto per updatedAt è un recupero post-crash, non
// una risoluzione di conflitti tra dispositivi.

import { countWords } from '../../lib/text';
import type { LocalChapterRepository } from './LocalChapterRepository';
import type {
  Chapter,
  ChapterPatch,
  ChapterRef,
  ChapterRepository,
  ChapterSummary,
  CreateChapterInput,
  Unsubscribe,
} from './types';

export interface OfflineFirstChapterRepositoryOptions {
  remote: ChapterRepository;
  mirror: LocalChapterRepository;
  /**
   * Parole AGGIUNTE a ogni salvataggio (delta positivo): alimenta l'obiettivo
   * del giorno in Libreria. Le cancellazioni non tolgono parole al
   * conteggio motivazionale.
   */
  onWordsAdded?: (delta: number) => void;
}

export class OfflineFirstChapterRepository implements ChapterRepository {
  private readonly remote: ChapterRepository;
  private readonly mirror: LocalChapterRepository;
  private readonly onWordsAdded?: (delta: number) => void;
  /** Parole dell'ultimo testo visto per capitolo (per i delta dell'obiettivo). */
  private readonly lastWords = new Map<string, number>();

  constructor(options: OfflineFirstChapterRepositoryOptions) {
    this.remote = options.remote;
    this.mirror = options.mirror;
    this.onWordsAdded = options.onWordsAdded;
  }

  private keyFor(ref: ChapterRef): string {
    return `${ref.bookId}/${ref.chapterId}`;
  }

  async loadRawText(ref: ChapterRef): Promise<string | null> {
    let remoteChapter: Chapter | null = null;
    let remoteFailed = false;
    try {
      remoteChapter = await this.remote.getChapter(ref);
    } catch {
      remoteFailed = true;
    }

    let mirrorEntry = null;
    try {
      mirrorEntry = await this.mirror.loadEntry(ref);
    } catch {
      // mirror illeggibile: si prosegue col solo remoto
    }

    if (remoteFailed && mirrorEntry === null) {
      // né remoto né mirror: NON è un capitolo vuoto, è una lettura fallita —
      // tornare null qui farebbe ripartire la dettatura da zero sovrascrivendo
      throw new Error(`Capitolo ${this.keyFor(ref)} irraggiungibile e senza copia locale`);
    }

    let text: string | null;
    if (mirrorEntry === null) {
      text = remoteChapter === null ? null : remoteChapter.rawText;
    } else if (remoteChapter === null) {
      // il remoto risponde ma non ha (più) il capitolo: si riparte dal mirror,
      // che risalirà col prossimo salvataggio
      text = mirrorEntry.rawText;
    } else if (
      mirrorEntry.updatedAt > remoteChapter.updatedAt &&
      mirrorEntry.rawText !== remoteChapter.rawText
    ) {
      // recovery: la sessione precedente è morta offline dopo il mirror ma
      // prima del sync — si rispinge la copia locale verso Firestore
      text = mirrorEntry.rawText;
      this.remote.saveRawText(ref, mirrorEntry.rawText).catch((error) => {
        console.warn('Recovery del mirror verso Firestore non riuscito', error);
      });
    } else {
      text = remoteChapter.rawText;
    }

    this.lastWords.set(this.keyFor(ref), countWords(text ?? ''));
    return text;
  }

  async saveRawText(ref: ChapterRef, rawText: string): Promise<void> {
    // durabilità prima di tutto: il mirror su disco è il salvataggio "vero";
    // Firestore segue (e offline resta in coda solo per la sessione corrente)
    await this.mirror.saveRawText(ref, rawText);
    try {
      await this.remote.saveRawText(ref, rawText);
    } catch (error) {
      // il testo è già al sicuro nel mirror: il remoto recupererà al prossimo
      // salvataggio o col recovery in loadRawText
      console.warn('Salvataggio Firestore non riuscito (testo al sicuro nel mirror)', error);
    }

    const key = this.keyFor(ref);
    const words = countWords(rawText);
    const previous = this.lastWords.get(key);
    if (previous !== undefined && words > previous) {
      this.onWordsAdded?.(words - previous);
    }
    this.lastWords.set(key, words);
  }

  // Il CRUD e le sottoscrizioni restano al remoto: i metadati sono
  // ricostruibili e la Libreria/il Libro vivono di observe* (Observer).

  observeChapters(
    bookId: string,
    onChange: (chapters: ChapterSummary[]) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return this.remote.observeChapters(bookId, onChange, onError);
  }

  observeChapter(
    ref: ChapterRef,
    onChange: (chapter: Chapter | null) => void,
    onError?: (error: Error) => void,
  ): Unsubscribe {
    return this.remote.observeChapter(ref, onChange, onError);
  }

  getChapter(ref: ChapterRef): Promise<Chapter | null> {
    return this.remote.getChapter(ref);
  }

  createChapter(bookId: string, input: CreateChapterInput): Promise<Chapter> {
    return this.remote.createChapter(bookId, input);
  }

  updateChapter(ref: ChapterRef, patch: ChapterPatch): Promise<void> {
    return this.remote.updateChapter(ref, patch);
  }

  reorderChapters(bookId: string, orderedIds: readonly string[]): Promise<void> {
    return this.remote.reorderChapters(bookId, orderedIds);
  }

  async deleteChapter(ref: ChapterRef): Promise<void> {
    // la voce di mirror orfana è innocua (verrà sovrascritta se l'id rinasce),
    // ma il conteggio di sessione va dimenticato
    this.lastWords.delete(this.keyFor(ref));
    return this.remote.deleteChapter(ref);
  }
}
