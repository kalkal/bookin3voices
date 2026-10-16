import { TranscriptComposer } from '../voiceCommands';

describe('TranscriptComposer — comandi vocali (il motore non dà punteggiatura)', () => {
  it('mappa «punto» e mette la maiuscola alla frase successiva', () => {
    const c = new TranscriptComposer();
    c.append('oggi piove punto domani vedremo');
    expect(c.value).toBe('Oggi piove. Domani vedremo');
  });

  it('mappa «virgola» senza maiuscola dopo', () => {
    const c = new TranscriptComposer();
    c.append('pane virgola latte e uova');
    expect(c.value).toBe('Pane, latte e uova');
  });

  it('mappa «a capo» e «nuovo paragrafo»', () => {
    const c = new TranscriptComposer();
    c.append('primo rigo a capo secondo rigo nuovo paragrafo altro paragrafo');
    expect(c.value).toBe('Primo rigo\nSecondo rigo\n\nAltro paragrafo');
  });

  it('privilegia la frase più lunga: «punto e virgola» non è «punto» + parole', () => {
    const c = new TranscriptComposer();
    c.append('prima parte punto e virgola seconda parte');
    expect(c.value).toBe('Prima parte; seconda parte');
  });

  it('mappa punto interrogativo ed esclamativo come fine frase', () => {
    const c = new TranscriptComposer();
    c.append('davvero punto interrogativo incredibile punto esclamativo sì');
    expect(c.value).toBe('Davvero? Incredibile! Sì');
  });

  it('è case-insensitive sui comandi', () => {
    const c = new TranscriptComposer();
    c.append('ciao Punto Nuovo Paragrafo ecco');
    expect(c.value).toBe('Ciao.\n\nEcco');
  });

  it('scarta la punteggiatura senza una parola davanti', () => {
    const c = new TranscriptComposer();
    c.append('punto virgola ciao');
    expect(c.value).toBe('Ciao');
  });

  it('scarta «a capo» a inizio testo e collassa gli «a capo» ripetuti', () => {
    const c = new TranscriptComposer();
    c.append('a capo ciao a capo a capo a capo mondo');
    expect(c.value).toBe('Ciao\nMondo');
  });

  it('mantiene il contesto di frase tra finali successivi', () => {
    const c = new TranscriptComposer();
    c.append('prima frase punto');
    c.append('seconda frase');
    c.append('virgola che continua');
    expect(c.value).toBe('Prima frase. Seconda frase, che continua');
  });

  it('ignora input vuoti o di soli spazi', () => {
    const c = new TranscriptComposer();
    c.append('   ');
    c.append('');
    expect(c.value).toBe('');
  });

  it('riparte da capo con reset()', () => {
    const c = new TranscriptComposer();
    c.append('qualcosa');
    c.reset();
    expect(c.value).toBe('');
    c.append('nuovo testo');
    expect(c.value).toBe('Nuovo testo');
  });

  it('riparte da un testo esistente rispettandone il contesto di frase', () => {
    const inFrase = new TranscriptComposer('Testo già dettato');
    inFrase.append('che prosegue');
    expect(inFrase.value).toBe('Testo già dettato che prosegue');

    const dopoPunto = new TranscriptComposer('Frase chiusa.');
    dopoPunto.append('nuova frase');
    expect(dopoPunto.value).toBe('Frase chiusa. Nuova frase');
  });

  it('appendVerbatim non applica comandi né maiuscole', () => {
    const c = new TranscriptComposer();
    c.appendVerbatim('testo con punto dentro');
    c.appendVerbatim('secondo blocco');
    expect(c.value).toBe('testo con punto dentro secondo blocco');
  });
});
