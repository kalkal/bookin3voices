// App copy of functions/src/ai/proposalGuard.ts (kept identical by proposalGuard.test.ts):
// Accept re-checks proposals stored before the server rule existed.
// Proposal guard: a proposal must CHANGE its original, never replace it.
// Deterministic, word-based (case, punctuation and apostrophes ignored):
//
// - grammar is a small edit. At most max(1, 20% of the original's words) may be
//   lost and at most as many new words may appear. "Lost" ignores words that
//   are still in the proposal, so a doubled phrase from dictation («la porta la
//   porta si aprì» → «la porta si aprì») is a valid fix as long as nothing else
//   goes; spoken punctuation left in the text («punto e virgola» → «;») is free
//   when the proposal adds the punctuation mark.
// - for EVERY kind but history (the label is the model's choice, so it cannot
//   be what keeps text safe), content words (4+ letters) may not go: at most
//   half of them, rounded down (min 1). New words never buy back lost ones,
//   except ONE word swapped in place («ammise Bruno sconsolatamente» → «disse
//   Bruno»), only in a short clause (up to 4 content words) and only when the
//   proposal keeps 60%+ of its length; so the phone sentence → «L'uomo osservò
//   stupito.» or «… in silenzio la stanza.» is still a deletion. A short
//   original (under 3 content words) may gain at most one
//   new content word and two words overall, so «punto e virgola» can become «;»
//   but never «. L'uomo osservò.»;
// - style and pacing may rewrite, but must keep part of the original: at least
//   one of its content words when it has 3 or more, and 30% of them when the
//   original is long (12+ words), so a passage can never be swapped for an
//   unrelated sentence.
// - history hints name facts to check: not judged here.
//
// Seen on the phone (21 Oct): «L'uomo osservò L'uomo osserva Allora sto cercando
// di dettare.» → «L'uomo osservò.» (half the sentence deleted), and
// «punto e virgola» → «. L'uomo osservò.» (unrelated). Both are now dropped.

import type { SuggestionKind } from './types';

export type ProposalDropReason = 'removes-words' | 'adds-words' | 'unrelated';

export type ProposalVerdict = { ok: true } | { ok: false; reason: ProposalDropReason };

const GRAMMAR_SHARE = 0.2;
const LONG_ORIGINAL_WORDS = 12;
const LONG_ORIGINAL_OVERLAP = 0.3;
const CONTENT_WORD_MIN_LENGTH = 4;
const SHORT_ORIGINAL_CONTENT_WORDS = 3;
const SWAP_MIN_LENGTH_SHARE = 0.6;
const SWAP_MAX_CONTENT_WORDS = 4;

// longest first: «punto e virgola» before «punto»
const SPOKEN_PUNCTUATION = [
  'punto e virgola',
  'punto interrogativo',
  'punto esclamativo',
  'apri virgolette',
  'chiudi virgolette',
  'due punti',
  'a capo',
  'punto',
  'virgola',
  'question mark',
  'exclamation mark',
  'full stop',
  'new line',
  'semicolon',
  'colon',
  'comma',
  'period',
];

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const punctuationMarks = (text: string): number => (text.match(/[.,;:!?…«»"—-]/g) ?? []).length;

/** Original words, minus spoken punctuation when the proposal writes the marks. */
function originalWords(original: string, proposal: string): string[] {
  if (punctuationMarks(proposal) <= punctuationMarks(original)) return words(original);
  let spoken = ` ${words(original).join(' ')} `;
  for (const phrase of SPOKEN_PUNCTUATION) spoken = spoken.split(` ${phrase} `).join(' ');
  return words(spoken);
}

export function checkProposal(
  kind: SuggestionKind,
  original: string,
  proposal: string,
): ProposalVerdict {
  if (kind === 'history') return { ok: true };
  if (kind === 'grammar') {
    const grammar = checkGrammar(original, proposal);
    if (!grammar.ok) return grammar;
  }
  const kept = checkContentKept(original, proposal);
  if (!kept.ok) return kept;
  return kind === 'grammar' ? { ok: true } : checkRewrite(original, proposal);
}

const contentWords = (list: string[]): string[] => [
  ...new Set(list.filter((w) => w.length >= CONTENT_WORD_MIN_LENGTH)),
];

/** Every kind: content words may be swapped, not dropped; short originals stay short. */
function checkContentKept(original: string, proposal: string): ProposalVerdict {
  const before = originalWords(original, proposal);
  const after = words(proposal);
  const content = contentWords(before);
  const afterSet = new Set(after);
  const beforeSet = new Set(before);
  const added = contentWords(after).filter((word) => !beforeSet.has(word)).length;
  if (content.length < SHORT_ORIGINAL_CONTENT_WORDS) {
    if (added > 1 || after.length > before.length + 2) return { ok: false, reason: 'adds-words' };
    return { ok: true };
  }
  const lost = content.filter((word) => !afterSet.has(word)).length;
  const allowed = Math.max(1, Math.floor(content.length / 2));
  const swap =
    content.length <= SWAP_MAX_CONTENT_WORDS &&
    after.length >= before.length * SWAP_MIN_LENGTH_SHARE
      ? Math.min(added, 1)
      : 0;
  return lost - swap > allowed ? { ok: false, reason: 'removes-words' } : { ok: true };
}

function checkGrammar(original: string, proposal: string): ProposalVerdict {
  const before = originalWords(original, proposal);
  const after = words(proposal);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const limit = Math.max(1, Math.floor(before.length * GRAMMAR_SHARE));
  const added = after.filter((word) => !beforeSet.has(word)).length;
  if (added > limit) return { ok: false, reason: 'adds-words' };
  const lost = before.filter((word) => !afterSet.has(word)).length;
  if (lost > limit) return { ok: false, reason: 'removes-words' };
  return { ok: true };
}

function checkRewrite(original: string, proposal: string): ProposalVerdict {
  const content = [...new Set(words(original).filter((w) => w.length >= CONTENT_WORD_MIN_LENGTH))];
  if (content.length < 3) return { ok: true };
  const kept = new Set(words(proposal));
  const shared = content.filter((word) => kept.has(word)).length;
  const needed =
    words(original).length >= LONG_ORIGINAL_WORDS
      ? Math.max(1, Math.ceil(content.length * LONG_ORIGINAL_OVERLAP))
      : 1;
  return shared >= needed ? { ok: true } : { ok: false, reason: 'unrelated' };
}
