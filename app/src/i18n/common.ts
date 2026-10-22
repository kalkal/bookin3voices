import type { Namespace } from './index';

export const common: Namespace = {
  en: {
    'common.chapterTitle': 'Chapter {roman} · {title}',
    'common.retry': 'Retry',
    'common.callable.refine.unreachable': 'The suggestions didn’t arrive. Try again shortly.',
    'common.callable.outline.unreachable': 'The outline didn’t arrive. Try again shortly.',
    'common.callable.export.unreachable': 'The export didn’t work. Try again shortly.',
    'common.callable.title.unreachable': 'The titles didn’t arrive. Try again shortly.',
    'common.callable.export.notReady':
      'The book isn’t ready for export yet: check the chapters and the book details, then try again.',
    'common.callable.sessionExpired':
      'Your session has expired: close and reopen the app, then try again.',
    'common.callable.dailyLimit':
      'You’ve reached today’s limit for this feature. Try again tomorrow.',
  },
  it: {
    'common.chapterTitle': 'Capitolo {roman} · {title}',
    'common.retry': 'Riprova',
    'common.callable.refine.unreachable': 'I suggerimenti non sono arrivati. Riprova tra poco.',
    'common.callable.outline.unreachable': 'La scaletta non è arrivata. Riprova tra poco.',
    'common.callable.export.unreachable': 'L’esportazione non è riuscita. Riprova tra poco.',
    'common.callable.title.unreachable': 'I titoli non sono arrivati. Riprova tra poco.',
    'common.callable.export.notReady':
      'Il libro non è ancora pronto per l’esportazione: controlla i capitoli e i dati del libro, poi riprova.',
    'common.callable.sessionExpired': 'La sessione è scaduta: chiudi e riapri l’app, poi riprova.',
    'common.callable.dailyLimit':
      'Hai raggiunto il limite di oggi per questa funzione. Riprova domani.',
  },
};
