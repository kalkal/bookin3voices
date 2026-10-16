// Exporter EPUB 3 con epub-gen-memory, come validato con epubcheck 5.3.0: frontespizio fuori indice e prima
// della TOC, TOC generata dalla libreria con tocTitle 'Indice', capitoli in
// ordine. EPUB è il formato consigliato per l'ebook KDP.

import epubGenModule from 'epub-gen-memory';

import { composeChapters, escapeHtml, exportLanguage } from './compose';
import type { BookForExport, Exporter } from './types';

// Interop del default export (nota operativa): a seconda del
// contesto di modulo il default può arrivare annidato.
const epubGen: typeof epubGenModule =
  (epubGenModule as unknown as { default?: typeof epubGenModule }).default ?? epubGenModule;

function titlePageHtml(book: BookForExport): string {
  const genre = book.genre.trim();
  const author = book.author.trim();
  return [
    '<div style="text-align:center; margin-top:30%;">',
    `  <h1 style="font-size:2em;">${escapeHtml(book.title)}</h1>`,
    genre === '' ? '' : `  <p style="font-style:italic;">${escapeHtml(genre)}</p>`,
    author === '' ? '' : `  <p style="margin-top:3em;">${escapeHtml(author)}</p>`,
    '</div>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export class EpubExporter implements Exporter {
  readonly format = 'epub' as const;
  readonly mimeType = 'application/epub+zip';
  readonly extension = 'epub';

  async render(book: BookForExport, generatedAt: Date): Promise<Buffer> {
    const chapters = [
      {
        title: book.title,
        content: titlePageHtml(book),
        excludeFromToc: true,
        beforeToc: true,
      },
      ...composeChapters(book).map((chapter) => ({
        title: chapter.displayTitle,
        content: chapter.paragraphs
          .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
          .join('\n'),
      })),
    ];

    const author = book.author.trim();
    const result = await epubGen(
      {
        title: book.title,
        ...(author === '' ? {} : { author }),
        lang: exportLanguage(book.language),
        description: book.description,
        tocTitle: 'Indice',
        prependChapterTitles: true,
        date: generatedAt.toISOString(),
      },
      chapters,
    );

    // In Node epub-gen-memory restituisce un Buffer; la guardia copre la
    // variante Blob della build browser (stessa difesa).
    return Buffer.isBuffer(result)
      ? result
      : Buffer.from(await (result as unknown as Blob).arrayBuffer());
  }
}
