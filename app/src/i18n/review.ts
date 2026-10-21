import type { Namespace } from './index';

export const review: Namespace = {
  en: {
    'review.kind.style': 'Style',
    'review.kind.grammar': 'Grammar',
    'review.kind.pacing': 'Pacing',
    'review.kind.history': 'History',

    'review.editor.backToBook': 'Back to the Book',
    'review.editor.chapterFallback': 'Chapter',
    'review.editor.subtitle_one': '{count} word · in draft',
    'review.editor.subtitle_other': '{count} words · in draft',
    'review.editor.suggestions_one': '{count} suggestion',
    'review.editor.suggestions_other': '{count} suggestions',
    'review.editor.loadError':
      'Could not read the saved chapter. Close and reopen the app before editing.',
    'review.editor.emptyHint':
      'The chapter is empty: dictate or write something,\nthen "Refine with AI".',
    'review.editor.refineStale':
      'The text changed during refinement: suggestions need to be regenerated.',
    'review.editor.freeKeyTitle': 'Development AI key active — refine ONLY sample text',
    'review.editor.freeKeyBody':
      'With the free key, submitted text may be used to train the models: the real text of the book waits for the final key.',
    'review.editor.refining': 'Refining…',
    'review.editor.refine': 'Refine with AI',

    'review.screen.title': 'Suggestions',
    'review.screen.pending': '{count} pending',
    'review.screen.all': 'All',
    'review.screen.acceptAll': 'Accept all ({count})',
    'review.screen.empty': 'No pending suggestions.\nGo back to the editor and "Refine with AI".',
    'review.screen.stale_one': '{count} suggestion no longer applies because the text changed.',
    'review.screen.stale_other': '{count} suggestions no longer apply because the text changed.',
    'review.screen.undo': 'Undo last change',
    'review.screen.swipeHint': 'Swipe a card right to accept, left to reject',
    'review.card.line': 'line {line}',
    'review.card.variants': '{count} variants — tap to choose',
    'review.card.reject': 'Reject',
    'review.card.accept': 'Accept',
    'review.history.period': 'Period detail',
    'review.history.anachronism': 'Possible anachronism',
    'review.history.toCheck': 'A hint to check on a reliable source, not a certain fact.',
    'review.history.oneByOne': 'History hints are accepted one at a time.',
  },
  it: {
    'review.kind.style': 'Stile',
    'review.kind.grammar': 'Grammatica',
    'review.kind.pacing': 'Ritmo',
    'review.kind.history': 'Storico',

    'review.editor.backToBook': 'Torna al Libro',
    'review.editor.chapterFallback': 'Capitolo',
    'review.editor.subtitle_one': '{count} parola · in stesura',
    'review.editor.subtitle_other': '{count} parole · in stesura',
    'review.editor.suggestions_one': '{count} suggerimento',
    'review.editor.suggestions_other': '{count} suggerimenti',
    'review.editor.loadError':
      'Impossibile leggere il capitolo salvato. Chiudi e riapri l’app prima di modificare.',
    'review.editor.emptyHint':
      'Il capitolo è vuoto: detta o scrivi qualcosa,\npoi «Rifinisci con AI».',
    'review.editor.refineStale':
      'Il testo è cambiato durante la rifinitura: suggerimenti da rigenerare.',
    'review.editor.freeKeyTitle': 'Chiave AI di sviluppo attiva — rifinisci SOLO testi di prova',
    'review.editor.freeKeyBody':
      'Con la chiave gratuita i testi inviati possono essere usati per addestrare i modelli: il testo vero del libro aspetta la chiave definitiva.',
    'review.editor.refining': 'Rifinitura in corso…',
    'review.editor.refine': 'Rifinisci con AI',

    'review.screen.title': 'Suggerimenti',
    'review.screen.pending': '{count} in attesa',
    'review.screen.all': 'Tutti',
    'review.screen.acceptAll': 'Accetta tutti ({count})',
    'review.screen.empty': 'Nessun suggerimento in attesa.\nTorna all’editor e «Rifinisci con AI».',
    'review.screen.stale_one':
      '{count} suggerimento non è più applicabile perché il testo è cambiato.',
    'review.screen.stale_other':
      '{count} suggerimenti non sono più applicabili perché il testo è cambiato.',
    'review.screen.undo': 'Annulla ultima modifica',
    'review.screen.swipeHint': 'Scorri una scheda a destra per accettare, a sinistra per rifiutare',
    'review.card.line': 'riga {line}',
    'review.card.variants': '{count} varianti — tocca per scegliere',
    'review.card.reject': 'Rifiuta',
    'review.card.accept': 'Accetta',
    'review.history.period': 'Dettaglio d’epoca',
    'review.history.anachronism': 'Possibile anacronismo',
    'review.history.toCheck': 'Spunto da verificare su una fonte affidabile, non un fatto certo.',
    'review.history.oneByOne': 'Gli spunti storici si accettano uno alla volta.',
  },
};
