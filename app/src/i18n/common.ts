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
    'common.callable.demo.accessCodeRequired':
      'This needs the access code from the Devpost testing instructions. Tap Retry, or «Enter code» at the top, to enter it.',
    'common.callable.demo.closed': 'The live AI of this demo is switched off.',
    'common.callable.demo.limit.user':
      'This phone has used today’s AI allowance for the demo. It resets at midnight UTC.',
    'common.callable.demo.limit.global':
      'Today’s AI allowance for the whole demo is used up. It resets at midnight UTC.',
    'common.callable.demo.limit.total': 'The demo’s total AI allowance is used up.',
    'common.callable.demo.sampleBook':
      'Meanwhile, the sample book shows pre-recorded example suggestions.',
    'common.callable.demo.textTooLong.refine':
      'This text is too long for the demo AI (at most {maxChars} characters): select a shorter part and refine that.',
    'common.callable.demo.textTooLong.outline':
      'The synopsis is too long for the demo AI (at most {maxChars} characters): shorten it and try again.',
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
    'common.callable.demo.accessCodeRequired':
      'Serve il codice d’accesso che trovi nelle istruzioni di prova su Devpost. Tocca Riprova, o «Inserisci codice» in alto, per inserirlo.',
    'common.callable.demo.closed': 'L’IA dal vivo di questa demo è spenta.',
    'common.callable.demo.limit.user':
      'Questo telefono ha usato tutta l’IA disponibile oggi per la demo. Si azzera a mezzanotte UTC.',
    'common.callable.demo.limit.global':
      'L’IA disponibile oggi per tutta la demo è esaurita. Si azzera a mezzanotte UTC.',
    'common.callable.demo.limit.total': 'L’IA disponibile per l’intera demo è esaurita.',
    'common.callable.demo.sampleBook':
      'Intanto il libro di esempio mostra suggerimenti di esempio già registrati.',
    'common.callable.demo.textTooLong.refine':
      'Questo testo è troppo lungo per l’IA della demo (al massimo {maxChars} caratteri): seleziona una parte più corta e rifinisci quella.',
    'common.callable.demo.textTooLong.outline':
      'La sinossi è troppo lunga per l’IA della demo (al massimo {maxChars} caratteri): accorciala e riprova.',
  },
};
