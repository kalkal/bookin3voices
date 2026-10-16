// Snapshot test del prompt outline (i prompt sono codice — un
// refactor non deve cambiarli silenziosamente). Una modifica VOLUTA al prompt
// aggiorna insieme OUTLINE_PROMPT_VERSION e questi snapshot.

import { buildOutlinePrompt, OUTLINE_PROMPT_VERSION } from '../outlinePrompt';

const SINOSSI_FITTIZIA = [
  'Nora Ferrandi, cartografa in fuga da un divorzio, eredita dallo zio un faro',
  'dismesso su un’isola del Levante e scopre nei registri del guardiano',
  'annotazioni cifrate su navi mai arrivate in porto.',
].join(' ');

describe('buildOutlinePrompt', () => {
  const base = {
    synopsis: SINOSSI_FITTIZIA,
    book: { title: 'Il faro di Levante', genre: 'romanzo', language: 'it' },
    writtenChapterTitles: [],
  };

  it('la versione del prompt è quella attesa (bump esplicito a ogni modifica)', () => {
    expect(OUTLINE_PROMPT_VERSION).toBe(1);
  });

  it('snapshot senza capitoli già scritti', () => {
    expect(buildOutlinePrompt(base)).toMatchSnapshot();
  });

  it('snapshot con capitoli già scritti (contesto)', () => {
    expect(
      buildOutlinePrompt({
        ...base,
        writtenChapterTitles: ['Il ritorno', 'Il registro'],
      }),
    ).toMatchSnapshot();
  });

  it('i capitoli già scritti entrano nel testo utente come elenco numerato', () => {
    const prompt = buildOutlinePrompt({
      ...base,
      writtenChapterTitles: ['Il ritorno', 'Il registro'],
    });
    expect(prompt.userText).toContain('1. Il ritorno');
    expect(prompt.userText).toContain('2. Il registro');
    expect(prompt.userText).toContain('non riproporli');
  });

  it('senza capitoli scritti il blocco non compare', () => {
    expect(buildOutlinePrompt(base).userText).not.toContain('GIÀ SCRITTI');
  });

  it('genere e lingua vuoti hanno un ripiego leggibile', () => {
    const prompt = buildOutlinePrompt({
      ...base,
      book: { title: 'Senza meta', genre: '', language: '' },
    });
    expect(prompt.userText).toContain('Genere: non indicato');
    expect(prompt.userText).toContain('Lingua del libro: it');
  });

  it('lo schema di risposta NON contiene minItems/maxItems (l’endpoint li rifiuta)', () => {
    const flat = JSON.stringify(buildOutlinePrompt(base).responseSchema);
    expect(flat).not.toContain('minItems');
    expect(flat).not.toContain('maxItems');
    expect(flat).toContain('"required":["title","summary","beats"]');
  });
});
