// Exporter DOCX con la libreria `docx`: frontespizio, indice
// statico (i titoli dei capitoli) e un capitolo per sezione, ognuno su pagina
// nuova. KDP accetta DOCX per l'ebook; il formato serve anche agli editor
// umani, quindi si privilegia un documento pulito che Word apre senza dialoghi
// (niente campo TOC dinamico, che chiederebbe "aggiornare i campi?").

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
} from 'docx';

import { composeChapters, exportLanguage } from './compose';
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
        new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Indice' }),
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
      creator: book.author,
      description: book.description,
      // Lingua di default dei run: aiuta il controllo ortografico in Word.
      styles: {
        default: {
          document: { run: { language: { value: exportLanguage(book.language) } } },
        },
      },
      sections: [{ children: titlePage(book) }, indexSection, ...chapterSections],
    });

    // `docx` scrive da sé le date nei core properties: `generatedAt` qui non
    // serve (l'idempotenza vive nel registro exports, non nei byte del file).
    void generatedAt;

    return Packer.toBuffer(document);
  }
}
