import type { Namespace } from './index';

export const dictation: Namespace = {
  en: {
    'dictation.preflight.unavailable.title': 'Speech recognition unavailable',
    'dictation.preflight.unavailable.detail':
      'This device has no active speech recognition service. On Android you need the Google app (or the manufacturer’s voice services).',
    'dictation.preflight.permission.title': 'Microphone permission denied',
    'dictation.preflight.permission.retry':
      'You can’t dictate without microphone permission. Try again and grant it.',
    'dictation.preflight.permission.permanent':
      'Permission was permanently denied: grant it from the system settings.',
    'dictation.preflight.offline.title': 'Offline language pack not installed',
    'dictation.preflight.offline.detail':
      'Without a connection dictation will stop: recognition will use the cloud. You can download the language pack to dictate offline too.',
    'dictation.preflight.openSettings': 'Open settings',
    'dictation.preflight.downloadOffline': 'Download offline language pack',
    'dictation.preflight.retry': 'Check again',
    'dictation.preflight.dismiss': 'Dismiss',
    'dictation.mic.idle': 'Start dictating',
    'dictation.mic.listening': 'Pause dictation',
    'dictation.mic.paused': 'Resume dictation',
    'dictation.mic.reconnecting': 'Reconnecting: tap to pause',
    'dictation.outline.open': 'Open the outline',
    'dictation.outline.close': 'Close the outline',
    'dictation.outline.label': 'Outline',
    'dictation.outline.labelWith': 'Outline · {chapter}',
    'dictation.error.permissionDenied': 'Microphone permission denied: grant it in settings.',
    'dictation.error.audioInterruption': 'The microphone was interrupted by another app.',
    'dictation.error.noSpeech': 'The engine hasn’t heard any speech for a while.',
    'dictation.error.network': 'No connection: recognition can’t reach the cloud.',
    'dictation.error.busy': 'Speech recognition is busy: tap the microphone to try again.',
    'dictation.error.unknown': 'The dictation engine stopped unexpectedly.',
    'dictation.backToBook': 'Back to the book',
    'dictation.loadError':
      'Unable to read the saved chapter. Close and reopen the app; if the problem persists, don’t dictate: the new text wouldn’t attach to the existing text.',
    'dictation.emptyHint': 'Tap the microphone and start dictating:\nthe text will appear here.',
    'dictation.sessionWords_one': '{formatted} word this session',
    'dictation.sessionWords_other': '{formatted} words this session',
    'dictation.caption.loading': 'Opening the chapter…',
    'dictation.caption.loadError': 'Chapter can’t be read',
    'dictation.caption.preflight': 'Checking microphone and language…',
    'dictation.caption.fixIssues': 'Fix the issues above to dictate',
    'dictation.caption.listening': 'Listening…',
    'dictation.caption.reconnecting': 'Reconnecting…',
    'dictation.caption.pausedAuto':
      'Paused automatically: a call or another app took the microphone — tap to resume',
    'dictation.caption.pausedSilence':
      'Paused automatically: no voice for 2 minutes — tap to resume',
    'dictation.caption.pausedEngine':
      'Paused automatically: speech recognition isn’t answering, check the connection — tap to resume',
    'dictation.caption.paused': 'Paused — tap to resume',
    'dictation.caption.committing': 'Finishing dictation…',
    'dictation.caption.offline': 'You’re offline: without a language pack dictation may stop',
    'dictation.caption.idle': 'Tap the microphone to dictate',
    'dictation.save.saved': 'Saved',
    'dictation.save.savedLocal': 'Saved on the phone, syncing as soon as possible',
    'dictation.save.error': 'Not saved yet: retrying, keep the app open',
    'dictation.save.saving': 'Saving…',
  },
  it: {
    'dictation.preflight.unavailable.title': 'Riconoscimento vocale non disponibile',
    'dictation.preflight.unavailable.detail':
      'Questo dispositivo non ha un servizio di riconoscimento vocale attivo. Su Android serve l’app Google (o i servizi vocali del produttore).',
    'dictation.preflight.permission.title': 'Permesso microfono negato',
    'dictation.preflight.permission.retry':
      'Senza il permesso del microfono non si può dettare. Riprova e concedilo.',
    'dictation.preflight.permission.permanent':
      'Il permesso è stato negato in modo permanente: concedilo dalle impostazioni di sistema.',
    'dictation.preflight.offline.title': 'Italiano offline non installato',
    'dictation.preflight.offline.detail':
      'Senza rete la dettatura si interrompe: il riconoscimento userà il cloud. Puoi scaricare il pacchetto lingua per dettare anche offline.',
    'dictation.preflight.openSettings': 'Apri impostazioni',
    'dictation.preflight.downloadOffline': 'Scarica l’italiano offline',
    'dictation.preflight.retry': 'Ricontrolla',
    'dictation.preflight.dismiss': 'Ignora',
    'dictation.mic.idle': 'Inizia a dettare',
    'dictation.mic.listening': 'Metti in pausa la dettatura',
    'dictation.mic.paused': 'Riprendi la dettatura',
    'dictation.mic.reconnecting': 'Riconnessione: tocca per mettere in pausa',
    'dictation.outline.open': 'Apri la traccia',
    'dictation.outline.close': 'Chiudi la traccia',
    'dictation.outline.label': 'Traccia',
    'dictation.outline.labelWith': 'Traccia · {chapter}',
    'dictation.error.permissionDenied': 'Permesso microfono negato: concedilo dalle impostazioni.',
    'dictation.error.audioInterruption': 'Il microfono è stato interrotto da un’altra app.',
    'dictation.error.noSpeech': 'Il motore non sente parlato da un po’.',
    'dictation.error.network': 'Rete assente: il riconoscimento non raggiunge il cloud.',
    'dictation.error.busy':
      'Il riconoscimento vocale è occupato: tocca il microfono per riprovare.',
    'dictation.error.unknown': 'Il motore di dettatura si è fermato in modo inatteso.',
    'dictation.backToBook': 'Torna al Libro',
    'dictation.loadError':
      'Impossibile leggere il capitolo salvato. Chiudi e riapri l’app; se il problema resta, non dettare: il testo nuovo non si aggancerebbe a quello esistente.',
    'dictation.emptyHint': 'Tocca il microfono e inizia a dettare:\nil testo apparirà qui.',
    'dictation.sessionWords_one': '{formatted} parola in questa sessione',
    'dictation.sessionWords_other': '{formatted} parole in questa sessione',
    'dictation.caption.loading': 'Apertura del capitolo…',
    'dictation.caption.loadError': 'Capitolo non leggibile',
    'dictation.caption.preflight': 'Controllo di microfono e lingua…',
    'dictation.caption.fixIssues': 'Risolvi i problemi qui sopra per dettare',
    'dictation.caption.listening': 'Sto ascoltando…',
    'dictation.caption.reconnecting': 'Riconnessione…',
    'dictation.caption.pausedAuto':
      'In pausa automatica: una chiamata o un’altra app ha preso il microfono — tocca per riprendere',
    'dictation.caption.pausedSilence':
      'In pausa automatica: nessuna voce da 2 minuti — tocca per riprendere',
    'dictation.caption.pausedEngine':
      'In pausa automatica: il riconoscimento vocale non risponde, controlla la connessione — tocca per riprendere',
    'dictation.caption.paused': 'In pausa — tocca per riprendere',
    'dictation.caption.committing': 'Chiusura della dettatura…',
    'dictation.caption.offline': 'Sei offline: senza pacchetto lingua la dettatura può fermarsi',
    'dictation.caption.idle': 'Tocca il microfono per dettare',
    'dictation.save.saved': 'Salvato',
    'dictation.save.savedLocal': 'Salvato sul telefono, sincronizzo appena possibile',
    'dictation.save.error': 'Non ancora salvato: riprovo, tieni aperta l’app',
    'dictation.save.saving': 'Salvataggio…',
  },
};
