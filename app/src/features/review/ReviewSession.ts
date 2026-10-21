// Suggestion review session: Command pattern with undo and the full set of
// coexistence rules:
// (a) suggestions born on a different hash than the current text → stale;
// (b) on acceptance, the remaining pending spans are re-mapped
//     (multiple patches are applied from the highest offset to the lowest);
// (c) a manual edit touching a pending span invalidates it (stale);
// (d) every patch verifies `original` before applying: a clean rejection;
// (e) a proposal that would delete or replace text instead of changing it
//     (proposalGuard, same rule as the server) is never applied.
//
// The class is PURE DOMAIN: no I/O. Decisions produce RevisionRecords
// that the caller (useChapterReview) persists to `revisions`; undo
// returns the ids of the revisions to remove. Rule: undo covers only
// the local session's command history; a manual edit or a new refinement
// round clears the history (stated assumption: undo is for immediate
// second thoughts during review, not time travel).

import { applyPatch, diffAsPatch, invertPatch, remapSpan } from './patches';
import { checkProposal } from './proposalGuard';
import type { PatchFailure, TextPatch } from './patches';
import { textHash } from './textHash';
import type { RefineResult, Span, Suggestion, SuggestionKind } from './types';

/** A row of the `revisions` subcollection. */
export interface RevisionRecord {
  id: string;
  span: Span;
  before: string;
  after: string;
  decision: 'accepted' | 'rejected';
  at: number;
  /** Rejected suggestions: the other proposals, rejected together with `after`. */
  alternatives?: string[];
}

export type AcceptFailure =
  PatchFailure | 'unknown-suggestion' | 'not-pending' | 'invalid-proposal' | 'unsafe-proposal';

export type AcceptOutcome =
  { ok: true; text: string; revision: RevisionRecord } | { ok: false; reason: AcceptFailure };

export type RejectOutcome =
  | { ok: true; revision: RevisionRecord }
  | { ok: false; reason: 'unknown-suggestion' | 'not-pending' };

export interface AcceptAllOutcome {
  accepted: number;
  /** Pendings of the category that became stale because the patch did not match. */
  staled: number;
  /** Pendings skipped because their proposal would delete or replace text. */
  unsafe: number;
  text: string;
  revisions: RevisionRecord[];
}

export type UndoOutcome =
  | { ok: true; text: string; removedRevisionIds: string[]; patches: TextPatch[] }
  | { ok: false; reason: 'nothing-to-undo' | PatchFailure };

export interface ManualEditOutcome {
  changed: boolean;
  /** Pendings invalidated because the edit touched their span. */
  staled: number;
}

export interface IngestOutcome {
  added: number;
  /** true if the batch was born on a text different from the current one. */
  bornStale: boolean;
}

interface UndoEntry {
  /** Inverses of the applied patches, in application order. */
  inverses: TextPatch[];
  /** Snapshot of the suggestions before the command (immutable). */
  suggestionsBefore: readonly Suggestion[];
  revisionIds: string[];
}

export interface ReviewSessionOptions {
  initialText: string;
  /** Injectable in tests; defaults: Date.now and sequential ids. */
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
   * Replaces the suggestion batch with the outcome of a refinement.
   * If the text changed while the provider was working (different hash), the
   * batch is born stale; in any case every pending is verified
   * against the current text (slice === original), never blind trust.
   */
  ingest(result: RefineResult): IngestOutcome {
    const currentHash = textHash(this.currentText);
    const bornStale = result.textHash !== currentHash;
    this.items = result.suggestions.map((sug) =>
      bornStale && sug.state === 'pending' ? { ...sug, state: 'stale' as const } : { ...sug },
    );
    this.revalidatePending();
    // new batch = new review: the undo history no longer makes sense
    this.undoStack.length = 0;
    return { added: this.items.length, bornStale };
  }

  /** Accepts a suggestion by applying the chosen proposal (the first by default). */
  accept(suggestionId: string, proposalIndex = 0): AcceptOutcome {
    const suggestion = this.items.find((s) => s.id === suggestionId);
    if (!suggestion) return { ok: false, reason: 'unknown-suggestion' };
    if (suggestion.state !== 'pending') return { ok: false, reason: 'not-pending' };
    const proposal = suggestion.proposals[proposalIndex];
    if (proposal === undefined) return { ok: false, reason: 'invalid-proposal' };
    if (!checkProposal(suggestion.kind, suggestion.original, proposal).ok) {
      this.markStale(suggestionId);
      return { ok: false, reason: 'unsafe-proposal' };
    }

    const snapshot = this.items;
    const patch: TextPatch = {
      span: suggestion.span,
      before: suggestion.original,
      after: proposal,
    };
    const applied = applyPatch(this.currentText, patch);
    if (!applied.ok) {
      // clean rejection; the suggestion is no longer applicable
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

  /** Rejects a suggestion; the revision records the discarded proposal. */
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
      ...(suggestion.proposals.length > 1 ? { alternatives: suggestion.proposals.slice(1) } : {}),
    };
    this.undoStack.push({ inverses: [], suggestionsBefore: snapshot, revisionIds: [revision.id] });
    return { ok: true, revision };
  }

  /**
   * Accepts all pendings of a category with their first
   * proposal, applying patches from the highest offset to the lowest.
   * A single command: one undo restores them all together.
   */
  acceptAll(kind: SuggestionKind): AcceptAllOutcome {
    // history hints are unchecked facts: each one is accepted on its own, never in bulk
    if (kind === 'history') {
      return { accepted: 0, staled: 0, unsafe: 0, text: this.currentText, revisions: [] };
    }
    const targets = [...this.pendingOf(kind)].sort((a, b) => b.span.from - a.span.from);
    if (targets.length === 0) {
      return { accepted: 0, staled: 0, unsafe: 0, text: this.currentText, revisions: [] };
    }

    const snapshot = this.items;
    const inverses: TextPatch[] = [];
    const revisions: RevisionRecord[] = [];
    let staled = 0;
    let unsafe = 0;

    for (const target of targets) {
      // re-read the suggestion: earlier patches may have re-mapped it
      const current = this.items.find((s) => s.id === target.id);
      if (!current || current.state !== 'pending') continue;
      if (!checkProposal(current.kind, current.original, current.proposals[0]).ok) {
        this.markStale(current.id);
        unsafe += 1;
        continue;
      }
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
    return { accepted: revisions.length, staled, unsafe, text: this.currentText, revisions };
  }

  /**
   * Undoes the last command (LIFO): applies the inverse patches in reverse
   * order and restores the suggestions snapshot. Each inverse is still
   * verified: a mismatch empties the history instead of applying blindly.
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
    return {
      ok: true,
      text: this.currentText,
      removedRevisionIds: entry.revisionIds,
      patches: entry.inverses,
    };
  }

  /**
   * Records a manual user edit: re-maps the pending spans
   * and invalidates those touched by the edit. The manual edit does not
   * enter the undo history (which covers only review commands) and it
   * clears it: the remaining inverses no longer describe the current text.
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

  /** Re-maps a pending's span after a patch; overlap → stale. */
  private remapAfterPatch(suggestion: Suggestion, patch: TextPatch): Suggestion {
    if (suggestion.state !== 'pending') return suggestion;
    const remapped = remapSpan(suggestion.span, patch);
    if (remapped === 'overlap') {
      return { ...suggestion, state: 'stale' as const };
    }
    return remapped === suggestion.span ? suggestion : { ...suggestion, span: remapped };
  }

  /**
   * Safety invariant ("never apply blindly"): after EVERY
   * mutation, a pending whose `original` no longer matches the text at its
   * span becomes stale. A safety net beneath the re-mapping.
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
