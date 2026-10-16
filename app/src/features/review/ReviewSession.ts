// Sessione di review dei suggerimenti: Command pattern con undo e
// regole di convivenza al completo:
// (a) suggerimenti nati su un hash diverso dal testo corrente → stale;
// (b) all'accettazione, ri-mappatura degli span dei pending rimasti
//     (le patch multiple si applicano dall'offset più alto al più basso);
// (c) un edit manuale che tocca lo span di un pending lo invalida (stale);
// (d) ogni patch verifica `original` prima di applicarsi — rifiuto pulito.
//
// La classe è DOMINIO PURO: niente I/O. Le decisioni producono RevisionRecord
// che il chiamante (useChapterReview) persiste su `revisions`; l'undo
// restituisce gli id delle revisioni da togliere. Regola: l'undo copre
// solo la cronologia dei comandi della sessione locale — un edit manuale o un
// nuovo giro di rifinitura azzerano la cronologia (assunzione dichiarata:
// l'undo è per ripensamenti immediati sulla review, non un time-travel).

import { applyPatch, diffAsPatch, invertPatch, remapSpan } from './patches';
import type { PatchFailure, TextPatch } from './patches';
import { textHash } from './textHash';
import type { RefineResult, Span, Suggestion, SuggestionKind } from './types';

/** Riga della sottocollezione `revisions` . */
export interface RevisionRecord {
  id: string;
  span: Span;
  before: string;
  after: string;
  decision: 'accepted' | 'rejected';
  at: number;
}

export type AcceptFailure =
  PatchFailure | 'unknown-suggestion' | 'not-pending' | 'invalid-proposal';

export type AcceptOutcome =
  { ok: true; text: string; revision: RevisionRecord } | { ok: false; reason: AcceptFailure };

export type RejectOutcome =
  | { ok: true; revision: RevisionRecord }
  | { ok: false; reason: 'unknown-suggestion' | 'not-pending' };

export interface AcceptAllOutcome {
  accepted: number;
  /** Pending della categoria diventati stale perché la patch non combaciava. */
  staled: number;
  text: string;
  revisions: RevisionRecord[];
}

export type UndoOutcome =
  | { ok: true; text: string; removedRevisionIds: string[] }
  | { ok: false; reason: 'nothing-to-undo' | PatchFailure };

export interface ManualEditOutcome {
  changed: boolean;
  /** Pending invalidati perché l'edit toccava il loro span. */
  staled: number;
}

export interface IngestOutcome {
  added: number;
  /** true se il batch è nato su un testo diverso da quello corrente. */
  bornStale: boolean;
}

interface UndoEntry {
  /** Inverse delle patch applicate, nell'ordine di applicazione. */
  inverses: TextPatch[];
  /** Fotografia dei suggerimenti prima del comando (immutabili). */
  suggestionsBefore: readonly Suggestion[];
  revisionIds: string[];
}

export interface ReviewSessionOptions {
  initialText: string;
  /** Iniettabili nei test; default: Date.now e id progressivi. */
  now?: () => number;
  newId?: () => string;
}

export class ReviewSession {
  private currentText: string;
  private items: readonly Suggestion[] = [];
  private readonly undoStack: UndoEntry[] = [];
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(options: ReviewSessionOptions) {
    this.currentText = options.initialText;
    this.now = options.now ?? Date.now;
    let counter = 0;
    this.newId = options.newId ?? (() => `rev-${this.now()}-${(counter += 1)}`);
  }

  get text(): string {
    return this.currentText;
  }

  get suggestions(): readonly Suggestion[] {
    return this.items;
  }

  get pending(): readonly Suggestion[] {
    return this.items.filter((s) => s.state === 'pending');
  }

  pendingOf(kind: SuggestionKind): readonly Suggestion[] {
    return this.pending.filter((s) => s.kind === kind);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Sostituisce il lotto di suggerimenti con l'esito di una rifinitura.
   * Se il testo è cambiato mentre il provider lavorava (hash diverso), il
   * lotto nasce stale; in ogni caso ogni pending viene verificato
   * contro il testo corrente (slice === original), mai fiducia cieca.
   */
  ingest(result: RefineResult): IngestOutcome {
    const currentHash = textHash(this.currentText);
    const bornStale = result.textHash !== currentHash;
    this.items = result.suggestions.map((sug) =>
      bornStale && sug.state === 'pending' ? { ...sug, state: 'stale' as const } : { ...sug },
    );
    this.revalidatePending();
    // nuovo lotto = nuova review: la cronologia degli undo non ha più senso
    this.undoStack.length = 0;
    return { added: this.items.length, bornStale };
  }

  /** Accetta un suggerimento applicando la proposta scelta (default la prima). */
  accept(suggestionId: string, proposalIndex = 0): AcceptOutcome {
    const suggestion = this.items.find((s) => s.id === suggestionId);
    if (!suggestion) return { ok: false, reason: 'unknown-suggestion' };
    if (suggestion.state !== 'pending') return { ok: false, reason: 'not-pending' };
    const proposal = suggestion.proposals[proposalIndex];
    if (proposal === undefined) return { ok: false, reason: 'invalid-proposal' };

    const snapshot = this.items;
    const patch: TextPatch = {
      span: suggestion.span,
      before: suggestion.original,
      after: proposal,
    };
    const applied = applyPatch(this.currentText, patch);
    if (!applied.ok) {
      // rifiuto pulito; il suggerimento non è più applicabile
      this.markStale(suggestionId);
      return { ok: false, reason: applied.reason };
    }

    this.currentText = applied.text;
    this.items = this.items.map((s) => {
      if (s.id === suggestionId) {
        return { ...s, state: 'accepted' as const, acceptedProposal: proposalIndex };
      }
      return this.remapAfterPatch(s, patch);
    });
    this.revalidatePending();

    const revision: RevisionRecord = {
      id: this.newId(),
      span: suggestion.span,
      before: suggestion.original,
      after: proposal,
      decision: 'accepted',
      at: this.now(),
    };
    this.undoStack.push({
      inverses: [invertPatch(patch)],
      suggestionsBefore: snapshot,
      revisionIds: [revision.id],
    });
    return { ok: true, text: this.currentText, revision };
  }

  /** Rifiuta un suggerimento; la revisione registra la proposta scartata. */
  reject(suggestionId: string): RejectOutcome {
    const suggestion = this.items.find((s) => s.id === suggestionId);
    if (!suggestion) return { ok: false, reason: 'unknown-suggestion' };
    if (suggestion.state !== 'pending') return { ok: false, reason: 'not-pending' };

    const snapshot = this.items;
    this.items = this.items.map((s) =>
      s.id === suggestionId ? { ...s, state: 'rejected' as const } : s,
    );
    const revision: RevisionRecord = {
      id: this.newId(),
      span: suggestion.span,
      before: suggestion.original,
      after: suggestion.proposals[0] ?? suggestion.original,
      decision: 'rejected',
      at: this.now(),
    };
    this.undoStack.push({ inverses: [], suggestionsBefore: snapshot, revisionIds: [revision.id] });
    return { ok: true, revision };
  }

  /**
   * Accetta tutti i pending di una categoria con la prima
   * proposta, applicando le patch dall'offset più alto al più basso.
   * Un solo comando: un undo li ripristina tutti insieme.
   */
  acceptAll(kind: SuggestionKind): AcceptAllOutcome {
    const targets = [...this.pendingOf(kind)].sort((a, b) => b.span.from - a.span.from);
    if (targets.length === 0) {
      return { accepted: 0, staled: 0, text: this.currentText, revisions: [] };
    }

    const snapshot = this.items;
    const inverses: TextPatch[] = [];
    const revisions: RevisionRecord[] = [];
    let staled = 0;

    for (const target of targets) {
      // rilegge il suggerimento: le patch precedenti possono averlo ri-mappato
      const current = this.items.find((s) => s.id === target.id);
      if (!current || current.state !== 'pending') continue;
      const patch: TextPatch = {
        span: current.span,
        before: current.original,
        after: current.proposals[0],
      };
      const applied = applyPatch(this.currentText, patch);
      if (!applied.ok) {
        this.markStale(current.id);
        staled += 1;
        continue;
      }
      this.currentText = applied.text;
      this.items = this.items.map((s) => {
        if (s.id === current.id) {
          return { ...s, state: 'accepted' as const, acceptedProposal: 0 };
        }
        return this.remapAfterPatch(s, patch);
      });
      inverses.push(invertPatch(patch));
      revisions.push({
        id: this.newId(),
        span: current.span,
        before: current.original,
        after: current.proposals[0],
        decision: 'accepted',
        at: this.now(),
      });
    }
    this.revalidatePending();

    if (inverses.length > 0 || revisions.length > 0) {
      this.undoStack.push({
        inverses,
        suggestionsBefore: snapshot,
        revisionIds: revisions.map((r) => r.id),
      });
    }
    return { accepted: revisions.length, staled, text: this.currentText, revisions };
  }

  /**
   * Annulla l'ultimo comando (LIFO): applica le patch inverse in ordine
   * contrario e ripristina la fotografia dei suggerimenti. Ogni inversa viene
   * comunque verificata: un mismatch svuota la cronologia invece di
   * applicare alla cieca.
   */
  undo(): UndoOutcome {
    const entry = this.undoStack.pop();
    if (!entry) return { ok: false, reason: 'nothing-to-undo' };

    let text = this.currentText;
    for (const inverse of [...entry.inverses].reverse()) {
      const applied = applyPatch(text, inverse);
      if (!applied.ok) {
        this.undoStack.length = 0;
        return { ok: false, reason: applied.reason };
      }
      text = applied.text;
    }
    this.currentText = text;
    this.items = entry.suggestionsBefore;
    this.revalidatePending();
    return { ok: true, text: this.currentText, removedRevisionIds: entry.revisionIds };
  }

  /**
   * Registra un edit manuale dell'utente: ri-mappa gli span dei pending
   * e invalida quelli toccati dall'edit. L'edit manuale non
   * entra nella cronologia undo (che copre solo i comandi di review) e la
   * azzera: le inverse rimaste non descrivono più il testo corrente.
   */
  applyManualEdit(newText: string): ManualEditOutcome {
    const patch = diffAsPatch(this.currentText, newText);
    if (!patch) return { changed: false, staled: 0 };

    const pendingBefore = this.pending.length;
    this.currentText = newText;
    this.items = this.items.map((s) => this.remapAfterPatch(s, patch));
    this.revalidatePending();
    this.undoStack.length = 0;
    return { changed: true, staled: pendingBefore - this.pending.length };
  }

  /** Ri-mappa lo span di un pending dopo una patch; overlap → stale. */
  private remapAfterPatch(suggestion: Suggestion, patch: TextPatch): Suggestion {
    if (suggestion.state !== 'pending') return suggestion;
    const remapped = remapSpan(suggestion.span, patch);
    if (remapped === 'overlap') {
      return { ...suggestion, state: 'stale' as const };
    }
    return remapped === suggestion.span ? suggestion : { ...suggestion, span: remapped };
  }

  /**
   * Invariante di sicurezza ("mai applicazione cieca"): dopo OGNI
   * mutazione, un pending il cui `original` non combacia più col testo allo
   * span diventa stale. Rete di salvataggio sotto la ri-mappatura.
   */
  private revalidatePending(): void {
    this.items = this.items.map((s) => {
      if (s.state !== 'pending') return s;
      if (
        s.span.to <= this.currentText.length &&
        this.currentText.slice(s.span.from, s.span.to) === s.original
      ) {
        return s;
      }
      return { ...s, state: 'stale' as const };
    });
  }

  private markStale(suggestionId: string): void {
    this.items = this.items.map((s) =>
      s.id === suggestionId ? { ...s, state: 'stale' as const } : s,
    );
  }
}
