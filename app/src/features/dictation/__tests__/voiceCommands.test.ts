import { TranscriptComposer, voiceCommandHints } from '../voiceCommands';

describe('TranscriptComposer — voice commands (the engine gives no punctuation)', () => {
  it('maps «punto» and capitalizes the next sentence', () => {
    const c = new TranscriptComposer();
    c.append('oggi piove punto domani vedremo');
    expect(c.value).toBe('Oggi piove. Domani vedremo');
  });

  it('maps «virgola» without capitalizing afterwards', () => {
    const c = new TranscriptComposer();
    c.append('pane virgola latte e uova');
    expect(c.value).toBe('Pane, latte e uova');
  });

  it('maps «a capo» and «nuovo paragrafo»', () => {
    const c = new TranscriptComposer();
    c.append('primo rigo a capo secondo rigo nuovo paragrafo altro paragrafo');
    expect(c.value).toBe('Primo rigo\nSecondo rigo\n\nAltro paragrafo');
  });

  it('prefers the longest phrase: «punto e virgola» is not «punto» + words', () => {
    const c = new TranscriptComposer();
    c.append('prima parte punto e virgola seconda parte');
    expect(c.value).toBe('Prima parte; seconda parte');
  });

  it('maps question and exclamation marks as sentence ends', () => {
    const c = new TranscriptComposer();
    c.append('davvero punto interrogativo incredibile punto esclamativo sì');
    expect(c.value).toBe('Davvero? Incredibile! Sì');
  });

  it('is case-insensitive on commands', () => {
    const c = new TranscriptComposer();
    c.append('ciao Punto Nuovo Paragrafo ecco');
    expect(c.value).toBe('Ciao.\n\nEcco');
  });

  it('discards punctuation with no word before it', () => {
    const c = new TranscriptComposer();
    c.append('punto virgola ciao');
    expect(c.value).toBe('Ciao');
  });

  it('discards «a capo» at text start and collapses repeated «a capo»', () => {
    const c = new TranscriptComposer();
    c.append('a capo ciao a capo a capo a capo mondo');
    expect(c.value).toBe('Ciao\nMondo');
  });

  it('keeps sentence context across successive finals', () => {
    const c = new TranscriptComposer();
    c.append('prima frase punto');
    c.append('seconda frase');
    c.append('virgola che continua');
    expect(c.value).toBe('Prima frase. Seconda frase, che continua');
  });

  it('ignores empty or whitespace-only input', () => {
    const c = new TranscriptComposer();
    c.append('   ');
    c.append('');
    expect(c.value).toBe('');
  });

  it('starts over with reset()', () => {
    const c = new TranscriptComposer();
    c.append('qualcosa');
    c.reset();
    expect(c.value).toBe('');
    c.append('nuovo testo');
    expect(c.value).toBe('Nuovo testo');
  });

  it('starts from existing text, respecting its sentence context', () => {
    const inFrase = new TranscriptComposer('Testo già dettato');
    inFrase.append('che prosegue');
    expect(inFrase.value).toBe('Testo già dettato che prosegue');

    const dopoPunto = new TranscriptComposer('Frase chiusa.');
    dopoPunto.append('nuova frase');
    expect(dopoPunto.value).toBe('Frase chiusa. Nuova frase');
  });

  it('appendVerbatim applies neither commands nor capitalization', () => {
    const c = new TranscriptComposer();
    c.appendVerbatim('testo con punto dentro');
    c.appendVerbatim('secondo blocco');
    expect(c.value).toBe('testo con punto dentro secondo blocco');
  });
});

describe('TranscriptComposer — English voice commands', () => {
  const english = () => new TranscriptComposer('', 'en');

  it('maps «period» / «full stop» and capitalizes the next sentence', () => {
    const c = english();
    c.append('it was raining period tomorrow we will see full stop');
    expect(c.value).toBe('It was raining. Tomorrow we will see.');
  });

  it('maps «comma», «colon» and «semicolon»', () => {
    const c = english();
    c.append('bread comma milk colon eggs semicolon cheese');
    expect(c.value).toBe('Bread, milk: eggs; cheese');
  });

  it('maps «new line» and «new paragraph»', () => {
    const c = english();
    c.append('first line new line second line new paragraph another paragraph');
    expect(c.value).toBe('First line\nSecond line\n\nAnother paragraph');
  });

  it('maps «question mark» and «exclamation mark» as sentence ends', () => {
    const c = english();
    c.append('really question mark incredible exclamation mark yes');
    expect(c.value).toBe('Really? Incredible! Yes');
  });

  it('does not apply Italian commands to an English dictation', () => {
    const c = english();
    c.append('the punto virgola');
    expect(c.value).toBe('The punto virgola');
  });

  it('does not apply English commands to an Italian dictation (default)', () => {
    const c = new TranscriptComposer();
    c.append('the period comma');
    expect(c.value).toBe('The period comma');
  });
});

describe('voiceCommandHints — what the screen shows', () => {
  it('lists the main commands of the dictation language', () => {
    expect(voiceCommandHints('it')).toEqual([
      '«punto»',
      '«virgola»',
      '«a capo»',
      '«nuovo paragrafo»',
    ]);
    expect(voiceCommandHints('en')).toEqual([
      '«period»',
      '«comma»',
      '«new line»',
      '«new paragraph»',
    ]);
  });
});
