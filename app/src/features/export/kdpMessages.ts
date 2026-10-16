// Testi in italiano del controllo KDP. Il server manda un `code` stabile e un
// messaggio in inglese (API); l'app mostra la versione italiana del codice e
// ripiega sul messaggio del server per i codici che non conosce.

const KDP_MESSAGES_IT: Record<string, string> = {
  cover_missing: 'Manca la copertina: KDP la richiede per pubblicare un ebook.',
  cover_too_small: 'La copertina è troppo piccola per KDP (ideale 2560×1600 px).',
  cover_bad_ratio: 'Le proporzioni della copertina non sono quelle consigliate da KDP (1,6:1).',
  cover_bad_format: 'Formato della copertina non accettato: usa JPEG o TIFF.',
  cover_too_large: 'Il file della copertina supera i 50 MB.',
  title_missing: 'Il libro non ha un titolo.',
  title_too_long: 'Il titolo è troppo lungo per KDP.',
  author_missing: 'Manca il nome dell’autore.',
  description_missing: 'Manca la descrizione: KDP la chiede al momento della pubblicazione.',
  description_too_long: 'La descrizione è troppo lunga per KDP.',
  language_missing: 'Lingua non impostata: l’export usa l’italiano.',
  no_chapters: 'Il libro non ha capitoli: l’indice sarebbe vuoto.',
  chapter_title_missing: 'Un capitolo non ha titolo: la sua voce nell’indice sarebbe vuota.',
  chapter_title_duplicate: 'Due capitoli hanno lo stesso titolo.',
  chapter_empty: 'Un capitolo è vuoto.',
  too_short: 'Il libro è troppo corto per KDP.',
  short_book: 'Il libro è molto corto: KDP lo mostrerà come un testo breve.',
};

export function kdpMessageIt(issue: { code: string; message: string }): string {
  return KDP_MESSAGES_IT[issue.code] ?? issue.message;
}

/** Riepilogo in una riga del controllo KDP (vuoto quando non c'è niente da dire). */
export function preflightNote(file: {
  preflight?: {
    errors: { code: string; message: string }[];
    warnings: { code: string; message: string }[];
  };
}): string {
  const report = file.preflight;
  if (report === undefined) return '';
  const issues = [...report.errors, ...report.warnings];
  if (issues.length === 0) return ' Controllo KDP: tutto a posto.';
  const first = issues[0];
  const e = report.errors.length;
  const w = report.warnings.length;
  const counts = `${e} ${e === 1 ? 'errore' : 'errori'}, ${w} ${w === 1 ? 'avviso' : 'avvisi'}`;
  return ` Controllo KDP: ${counts}. ${first ? kdpMessageIt(first) : ''}`;
}
