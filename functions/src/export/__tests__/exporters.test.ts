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
  title: 'Il faro di Levante',
  author: 'Jane Doe',
  description: 'Romanzo di prova.',
  language: 'it',
  genre: 'romanzo',
  chapters: [
    { title: 'Il ritorno', rawText: 'Nora scese sulla banchina.\nDiciassette anni dopo.' },
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
    expect(allContent).toContain('Nora scese sulla banchina.');
    // plain text, never HTML: metacharacters arrive escaped
    expect(allContent).toContain('Tom &amp; Jerry &lt;segreti&gt;');
    expect(allContent).not.toContain('<segreti>');
  });

  it('writes the KDP metadata into the OPF package', async () => {
    const buffer = await new EpubExporter().render(BOOK, GENERATED_AT);
    const zip = await JSZip.loadAsync(buffer);
    const opfFile = Object.keys(zip.files).find((name) => name.endsWith('.opf'));
    const opf = await zip.file(opfFile as string)?.async('string');
    expect(opf).toContain('Il faro di Levante');
    expect(opf).toContain('Jane Doe');
    expect(opf).toContain('Romanzo di prova.');
    expect(opf).toContain('<dc:language>it</dc:language>');
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
    expect(document).toContain('Nora scese sulla banchina.');
    expect(document).toContain('Indice');
    // the XML escapes the title's metacharacters on its own
    expect(document).toContain('Tom &amp; Jerry &lt;segreti&gt;');

    const core = (await zip.file('docProps/core.xml')?.async('string')) as string;
    expect(core).toContain('Il faro di Levante');
    expect(core).toContain('Jane Doe');
  });
});
