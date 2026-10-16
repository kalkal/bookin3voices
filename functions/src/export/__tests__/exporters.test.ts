// Unit test degli exporter (Strategy): struttura degli archivi generati,
// senza emulatore. La validazione EPUBCheck completa vive nei test
// d'integrazione (src/__integration__), che generano il file dalla callable.

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
  it('registra un exporter per formato con mime ed estensione coerenti', () => {
    expect(createExporter('epub')).toBeInstanceOf(EpubExporter);
    expect(createExporter('docx')).toBeInstanceOf(DocxExporter);
    expect(createExporter('epub').mimeType).toBe('application/epub+zip');
    expect(createExporter('docx').extension).toBe('docx');
  });
});

describe('EpubExporter', () => {
  it('genera un EPUB con mimetype, TOC "Indice" e testo con escape', async () => {
    const buffer = await new EpubExporter().render(BOOK, GENERATED_AT);
    const zip = await JSZip.loadAsync(buffer);

    expect(await zip.file('mimetype')?.async('string')).toBe('application/epub+zip');

    const files = Object.keys(zip.files);
    const tocFile = files.find((name) => name.endsWith('toc.xhtml'));
    expect(tocFile).toBeDefined();
    const toc = await zip.file(tocFile as string)?.async('string');
    expect(toc).toContain('Indice');
    expect(toc).toContain('Capitolo I — Il ritorno');
    // il frontespizio resta fuori dall'indice (excludeFromToc):
    // nessun link della nav punta al file del frontespizio (0_*.xhtml)
    expect(toc).not.toContain('href="0_');

    const chapterFiles = files.filter((name) => /\/\d+_.*\.xhtml$/.test(name));
    const contents = await Promise.all(
      chapterFiles.map((name) => zip.file(name)?.async('string') as Promise<string>),
    );
    const allContent = contents.join('\n');
    expect(allContent).toContain('Nora scese sulla banchina.');
    // testo puro, mai HTML: i metacaratteri arrivano con escape
    expect(allContent).toContain('Tom &amp; Jerry &lt;segreti&gt;');
    expect(allContent).not.toContain('<segreti>');
  });

  it('scrive i metadati KDP nel package OPF', async () => {
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
  it('genera un DOCX apribile: struttura OOXML, indice e capitoli', async () => {
    const buffer = await new DocxExporter().render(BOOK, GENERATED_AT);
    const zip = await JSZip.loadAsync(buffer);

    // struttura minima che Word richiede per aprire il file
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(zip.file('word/document.xml')).not.toBeNull();

    const document = (await zip.file('word/document.xml')?.async('string')) as string;
    expect(document).toContain('Capitolo I — Il ritorno');
    expect(document).toContain('Nora scese sulla banchina.');
    expect(document).toContain('Indice');
    // l'XML fa il proprio escape dei metacaratteri del titolo
    expect(document).toContain('Tom &amp; Jerry &lt;segreti&gt;');

    const core = (await zip.file('docProps/core.xml')?.async('string')) as string;
    expect(core).toContain('Il faro di Levante');
    expect(core).toContain('Jane Doe');
  });
});
