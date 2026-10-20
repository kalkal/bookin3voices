// DOCX exporter using the `docx` library: title page, static index (the
// chapter titles) and one chapter per section, each on a new page. KDP accepts
// DOCX for ebooks; the format also serves human editors, so a clean document
// that Word opens without dialogs is preferred (no dynamic TOC field, which
// would ask "update fields?").

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from 'docx';

import { composeChapters, exportLabels, exportLanguage } from './compose';
import type { BookForExport, Exporter } from './types';

function titlePage(book: BookForExport): Paragraph[] {
  const page = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 4800, after: 240 },
      children: [new TextRun({ text: book.title, size: 64 })],
    }),
  ];
  const genre = book.genre.trim();
  if (genre !== '') {
    page.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: genre, italics: true })],
      }),
    );
  }
  const author = book.author.trim();
  if (author !== '') {
    page.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 720 },
        children: [new TextRun({ text: author, size: 32 })],
      }),
    );
  }
  return page;
}

export class DocxExporter implements Exporter {
  readonly format = 'docx' as const;
  readonly mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  readonly extension = 'docx';

  async render(book: BookForExport, generatedAt: Date): Promise<Buffer> {
    const chapters = composeChapters(book);

    const indexSection: ISectionOptions = {
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          text: exportLabels(book.language).contents,
        }),
        ...chapters.map((chapter) => new Paragraph({ text: chapter.displayTitle })),
      ],
    };

    const chapterSections: ISectionOptions[] = chapters.map((chapter) => ({
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, text: chapter.displayTitle }),
        ...chapter.paragraphs.map((paragraph) => new Paragraph({ text: paragraph })),
      ],
    }));

    const document = new Document({
      title: book.title,
      creator: book.author.trim(),
      // the library writes "Un-named" otherwise
      lastModifiedBy: book.author.trim(),
      description: book.description,
      // Default language of runs: helps spell checking in Word.
      styles: {
        default: {
          document: { run: { language: { value: exportLanguage(book.language) } } },
        },
      },
      sections: [{ children: titlePage(book) }, indexSection, ...chapterSections],
    });

    // `docx` writes the dates in the core properties itself: `generatedAt` is
    // not needed here (idempotency lives in the exports registry, not in the
    // file bytes).
    void generatedAt;

    return Packer.toBuffer(document);
  }
}
