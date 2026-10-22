import type { Namespace } from './index';

export const review: Namespace = {
  en: {
    'review.accept.unsafe':
      'This suggestion would delete part of the text: I didn’t apply it. Your text is intact.',
    'review.accept.mismatch':
      'This suggestion no longer matches the text: I set it aside. Your text is intact.',
    'review.accept.skipped_one':
      '{count} suggestion not applied: it would have deleted or changed the wrong text. Your text is intact.',
    'review.accept.skipped_other':
      '{count} suggestions not applied: they would have deleted or changed the wrong text. Your text is intact.',
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
    'review.editor.refineSelection': 'Refine the selection',
    'review.editor.refiningStatus': 'Refining in progress… it can take a few seconds.',
    'review.empty.message': 'No suggestions for this part: {reason}',
    'review.empty.nothingToFix': 'the text is already fine.',
    'review.empty.unsafeDropped':
      'the AI’s proposals would have changed the text too much, so I dropped them. Try again or pick another part.',
    'review.empty.alreadyRejected': 'you had already rejected those proposals.',
    'review.empty.nothingUsable': 'the AI’s answers were not usable on this text. Try again.',
    'review.editor.refineParagraph': 'Refine the paragraph',
    'review.panel.scope': 'Refine: {scope}',
    'review.panel.scope.chapter': 'the whole chapter',
    'review.panel.scope.selection': 'the selection',
    'review.panel.scope.paragraph': 'the paragraph',
    'review.panel.start': 'Start',
    'review.panel.cancel': 'Cancel',
    'review.editor.paragraphHint': 'Choose this paragraph to refine just it',
    'review.title.hint': 'Shows «Refine the title»',
    'review.title.refine': 'Refine the title',
    'review.title.cancel': 'Cancel',
    'review.title.none': 'No better title came up: the current one stays.',
    'review.title.saveFailed': 'The new title was not saved: try again.',
    'review.editor.selectionTooShort':
      'Select at least {count} words to refine, or clear the selection to refine the whole chapter.',

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
    'review.accept.unsafe':
      'Questo suggerimento cancellerebbe parte del testo: non l’ho applicato. Il testo è intatto.',
    'review.accept.mismatch':
      'Questo suggerimento non corrisponde più al testo: l’ho messo da parte. Il testo è intatto.',
    'review.accept.skipped_one':
      '{count} suggerimento non applicato: avrebbe cancellato o cambiato il testo sbagliato. Il testo è intatto.',
    'review.accept.skipped_other':
      '{count} suggerimenti non applicati: avrebbero cancellato o cambiato il testo sbagliato. Il testo è intatto.',
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
    'review.editor.refineSelection': 'Rifinisci la selezione',
    'review.editor.refiningStatus': 'Rifinitura in corso… può volerci qualche secondo.',
    'review.empty.message': 'Nessun suggerimento per questa parte: {reason}',
    'review.empty.nothingToFix': 'il testo va già bene.',
    'review.empty.unsafeDropped':
      'le proposte dell’AI avrebbero cambiato troppo il testo e le ho scartate. Riprova o scegli un’altra parte.',
    'review.empty.alreadyRejected': 'avevi già rifiutato quelle proposte.',
    'review.empty.nothingUsable':
      'le risposte dell’AI non erano utilizzabili su questo testo. Riprova.',
    'review.editor.refineParagraph': 'Rifinisci il paragrafo',
    'review.panel.scope': 'Rifinisci: {scope}',
    'review.panel.scope.chapter': 'Tutto il capitolo',
    'review.panel.scope.selection': 'Selezione',
    'review.panel.scope.paragraph': 'Paragrafo',
    'review.panel.start': 'Avvia',
    'review.panel.cancel': 'Annulla',
    'review.editor.paragraphHint': 'Sceglie questo paragrafo per rifinire solo lui',
    'review.title.hint': 'Mostra «Rifinisci il titolo»',
    'review.title.refine': 'Rifinisci il titolo',
    'review.title.cancel': 'Annulla',
    'review.title.none': 'Nessun titolo migliore: resta quello attuale.',
    'review.title.saveFailed': 'Il nuovo titolo non è stato salvato: riprova.',
    'review.editor.selectionTooShort':
      'Seleziona almeno {count} parole da rifinire, oppure togli la selezione per rifinire tutto il capitolo.',

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
