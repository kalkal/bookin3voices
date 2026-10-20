// Unit tests of the exporters (Strategy): structure of the generated
// archives, without the emulator. Full EPUBCheck validation lives in the
// integration tests (src/__integration__), which generate the file from the
// callable.

import JSZip from 'jszip';

import { DocxExporter } from '../DocxExporter';
import { EpubExporter } from '../EpubExporter';
import { createExporter } from '../exporterFactory';
import type { BookForExport } from '../types';

const BOOK: BookForExport = {
  title: 'Il mulino di Rocca Bassa',
  author: 'Jane Doe',
  description: 'Romanzo di prova.',
  language: 'it',
  genre: 'romanzo',
  chapters: [
    { title: 'Il ritorno', rawText: 'Viola scese davanti al mulino.\nDiciassette anni dopo.' },
    { title: 'Tom & Jerry <segreti>', rawText: 'Testo con «virgolette» & l’apostrofo.' },
    { title: 'Capitolo vuoto', rawText: '' },
  ],
};

const GENERATED_AT = new Date('2026-09-06T12:00:00Z');

describe('exporterFactory', () => {
  it('registers one exporter per format with consistent mime type and extension', () => {
    expect(createExporter('epub')).toBeInstanceOf(EpubExporter);
    expect(createExporter('docx')).toBeInstanceOf(DocxExporter);
    expect(createExporter('epub').mimeType).toBe('application/epub+zip');
    expect(createExporter('docx').extension).toBe('docx');
  });
});

describe('EpubExporter', () => {
  it('generates an EPUB with mimetype, "Indice" TOC and escaped text', async () => {
    const buffer = await new EpubExporter().render(BOOK, GENERATED_AT);
    const zip = await JSZip.loadAsync(buffer);

    expect(await zip.file('mimetype')?.async('string')).toBe('application/epub+zip');

    const files = Object.keys(zip.files);
    const tocFile = files.find((name) => name.endsWith('toc.xhtml'));
    expect(tocFile).toBeDefined();
    const toc = await zip.file(tocFile as string)?.async('string');
    expect(toc).toContain('Indice');
    expect(toc).toContain('Capitolo I — Il ritorno');
    // the title page stays out of the index (excludeFromToc):
    // no nav link points to the title page file (0_*.xhtml)
    expect(toc).not.toContain('href="0_');

    const chapterFiles = files.filter((name) => /\/\d+_.*\.xhtml$/.test(name));
    const contents = await Promise.all(
      chapterFiles.map((name) => zip.file(name)?.async('string') as Promise<string>),
    );
    const allContent = contents.join('\n');
    expect(allContent).toContain('Viola scese davanti al mulino.');
    // plain text, never HTML: metacharacters arrive escaped
    expect(allContent).toContain('Tom &amp; Jerry &lt;segreti&gt;');
    expect(allContent).not.toContain('<segreti>');
  });

  it('writes the KDP metadata into the OPF package', async () => {
    const buffer = await new EpubExporter().render(BOOK, GENERATED_AT);
    const zip = await JSZip.loadAsync(buffer);
    const opfFile = Object.keys(zip.files).find((name) => name.endsWith('.opf'));
    const opf = await zip.file(opfFile as string)?.async('string');
    expect(opf).toContain('Il mulino di Rocca Bassa');
    expect(opf).toContain('Jane Doe');
    expect(opf).toContain('Romanzo di prova.');
    expect(opf).toContain('<dc:language>it</dc:language>');
  });

  it.each(['', '   \n'])(
    'omits dc:description when the description is blank (%j): an empty element fails EPUBCheck',
    async (description) => {
      const buffer = await new EpubExporter().render({ ...BOOK, description }, GENERATED_AT);
      const zip = await JSZip.loadAsync(buffer);
      const opfFile = Object.keys(zip.files).find((name) => name.endsWith('.opf'));
      const opf = (await zip.file(opfFile as string)?.async('string')) as string;
      expect(opf).not.toContain('dc:description');
      expect(opf).toContain('<dc:language>it</dc:language>');
    },
  );
});

describe('EpubExporter: the author name everywhere, never "anonymous"', () => {
  async function opfOf(book: BookForExport): Promise<string> {
    const zip = await JSZip.loadAsync(await new EpubExporter().render(book, GENERATED_AT));
    const opfFile = Object.keys(zip.files).find((name) => name.endsWith('.opf'));
    return (await zip.file(opfFile as string)?.async('string')) as string;
  }

  it('creator, publisher and rights carry the author name, with the year of the export', async () => {
    const opf = await opfOf(BOOK);
    expect(opf).toContain('<dc:creator id="creator">Jane Doe</dc:creator>');
    expect(opf).toContain('<dc:publisher>Jane Doe</dc:publisher>');
    expect(opf).toContain('<dc:rights>Copyright &#x00A9; 2026 by Jane Doe</dc:rights>');
    expect(opf).not.toContain('anonymous');
  });

  it('the name is escaped in the package (a name with & or < stays valid XML)', async () => {
    const opf = await opfOf({ ...BOOK, author: 'Tom & <Jerry>' });
    expect(opf).toContain('<dc:publisher>Tom &amp; &lt;Jerry&gt;</dc:publisher>');
    expect(opf).not.toContain('<Jerry>');
  });

  it('with no author name at all: no invented "anonymous", and no empty elements', async () => {
    const opf = await opfOf({ ...BOOK, author: '  ' });
    expect(opf).not.toContain('anonymous');
    expect(opf).not.toContain('<dc:creator');
    expect(opf).not.toContain('<dc:publisher');
    expect(opf).not.toContain('<dc:rights');
  });
});

describe('DocxExporter: the author name', () => {
  it('title page, creator and last modified by: the author, never "Un-named"', async () => {
    const zip = await JSZip.loadAsync(await new DocxExporter().render(BOOK, GENERATED_AT));
    const document = (await zip.file('word/document.xml')?.async('string')) as string;
    expect(document).toContain('Jane Doe');
    const core = (await zip.file('docProps/core.xml')?.async('string')) as string;
    expect(core).toContain('<dc:creator>Jane Doe</dc:creator>');
    expect(core).toContain('<cp:lastModifiedBy>Jane Doe</cp:lastModifiedBy>');
    expect(core).not.toContain('Un-named');
  });
});

describe('DocxExporter', () => {
  it('generates an openable DOCX: OOXML structure, index and chapters', async () => {
    const buffer = await new DocxExporter().render(BOOK, GENERATED_AT);
    const zip = await JSZip.loadAsync(buffer);

    // minimal structure Word requires to open the file
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('word/document.xml')).not.toBeNull();

    const document = (await zip.file('word/document.xml')?.async('string')) as string;
    expect(document).toContain('Capitolo I — Il ritorno');
    expect(document).toContain('Viola scese davanti al mulino.');
    expect(document).toContain('Indice');
    // the XML escapes the title's metacharacters on its own
    expect(document).toContain('Tom &amp; Jerry &lt;segreti&gt;');

    const core = (await zip.file('docProps/core.xml')?.async('string')) as string;
    expect(core).toContain('Il mulino di Rocca Bassa');
    expect(core).toContain('Jane Doe');
  });
});

describe('exports of an English book carry no Italian fixed texts', () => {
  const ENGLISH_BOOK: BookForExport = {
    ...BOOK,
    title: 'The Dark Light',
    language: 'en',
    chapters: [{ title: 'The stairs', rawText: 'He climbed.' }],
  };

  it('EPUB: "Contents" index and "Chapter I" titles', async () => {
    const zip = await JSZip.loadAsync(await new EpubExporter().render(ENGLISH_BOOK, GENERATED_AT));
    const files = Object.keys(zip.files);
    const toc = (await zip
      .file(files.find((n) => n.endsWith('toc.xhtml')) as string)
      ?.async('string')) as string;
    expect(toc).toContain('Contents');
    expect(toc).toContain('Chapter I — The stairs');
    expect(toc).not.toMatch(/Indice|Capitolo/);
  });

  it('DOCX: "Contents" index and "Chapter I" titles', async () => {
    const zip = await JSZip.loadAsync(await new DocxExporter().render(ENGLISH_BOOK, GENERATED_AT));
    const document = (await zip.file('word/document.xml')?.async('string')) as string;
    expect(document).toContain('Contents');
    expect(document).toContain('Chapter I — The stairs');
    expect(document).not.toMatch(/Indice|Capitolo/);
  });
});
