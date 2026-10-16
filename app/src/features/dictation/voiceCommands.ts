// Comandi vocali di punteggiatura (il motore cloud Android
// non aggiunge punteggiatura). Scelta dichiarata: la mappatura
// è un POST-PROCESSORE dedicato e puro, applicato dai livelli superiori ai soli
// trascritti FINALI prima dell'accumulo; i parziali restano grezzi (effimeri).
//
// Limite noto e accettato (stile Dragon): una parola-comando pronunciata come
// parola normale («il punto di vista») viene comunque convertita — la revisione
// manuale resta il rimedio, come nelle app di dettatura di riferimento.

type PunctuationCommand = { kind: 'punctuation'; char: string; endsSentence: boolean };
type BreakCommand = { kind: 'break'; text: string };
export type VoiceCommand = PunctuationCommand | BreakCommand;

/**
 * Mappa frase → comando. Il matching è case-insensitive e privilegia la frase
 * più lunga («punto e virgola» prima di «punto»). Estensibile: basta una riga.
 */
const COMMAND_PHRASES: readonly { phrase: string; command: VoiceCommand }[] = [
  { phrase: 'punto e virgola', command: { kind: 'punctuation', char: ';', endsSentence: false } },
  {
    phrase: 'punto interrogativo',
    command: { kind: 'punctuation', char: '?', endsSentence: true },
  },
  { phrase: 'punto esclamativo', command: { kind: 'punctuation', char: '!', endsSentence: true } },
  { phrase: 'nuovo paragrafo', command: { kind: 'break', text: '\n\n' } },
  { phrase: 'due punti', command: { kind: 'punctuation', char: ':', endsSentence: false } },
  { phrase: 'a capo', command: { kind: 'break', text: '\n' } },
  { phrase: 'punto', command: { kind: 'punctuation', char: '.', endsSentence: true } },
  { phrase: 'virgola', command: { kind: 'punctuation', char: ',', endsSentence: false } },
];

const VOICE_COMMANDS: readonly { tokens: string[]; command: VoiceCommand }[] = COMMAND_PHRASES.map(
  (c) => ({ command: c.command, tokens: c.phrase.split(' ') }),
).sort((a, b) => b.tokens.length - a.tokens.length);

const endsWithWordChar = (s: string) => /[^\s\n]$/.test(s);

/**
 * Accumula i trascritti finali applicando i comandi vocali, la spaziatura
 * (niente spazio prima della punteggiatura) e la maiuscola a inizio frase.
 * Non è thread-safe né condiviso: un composer per sessione di dettatura.
 */
export class TranscriptComposer {
  private text: string;
  private capitalizeNext = true;

  constructor(initialText = '') {
    this.text = initialText;
    if (endsWithWordChar(initialText) && !/[.!?]\s*$/.test(initialText)) {
      this.capitalizeNext = false;
    }
  }

  get value(): string {
    return this.text;
  }

  /** Aggiunge un trascritto finale grezzo; ritorna il testo aggiornato. */
  append(finalTranscript: string): string {
    const tokens = finalTranscript.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
      const match = this.matchCommand(tokens, i);
      if (match) {
        this.applyCommand(match.command);
        i += match.length;
      } else {
        this.appendWord(tokens[i]);
        i += 1;
      }
    }
    return this.text;
  }

  /** Aggiunta letterale (comandi vocali disattivati): sola giunzione con spazio. */
  appendVerbatim(finalTranscript: string): string {
    const clean = finalTranscript.trim();
    if (clean) this.text += (this.text === '' ? '' : ' ') + clean;
    return this.text;
  }

  reset(): void {
    this.text = '';
    this.capitalizeNext = true;
  }

  private matchCommand(
    tokens: string[],
    from: number,
  ): { command: VoiceCommand; length: number } | undefined {
    for (const { tokens: phraseTokens, command } of VOICE_COMMANDS) {
      if (from + phraseTokens.length > tokens.length) continue;
      const matches = phraseTokens.every(
        (t, k) => tokens[from + k].toLocaleLowerCase('it-IT') === t,
      );
      if (matches) return { command, length: phraseTokens.length };
    }
    return undefined;
  }

  private applyCommand(command: VoiceCommand): void {
    if (command.kind === 'punctuation') {
      // punteggiatura senza una parola davanti (inizio testo/riga): la si scarta
      if (!endsWithWordChar(this.text)) return;
      this.text = this.text.replace(/\s+$/, '') + command.char;
      if (command.endsSentence) this.capitalizeNext = true;
    } else {
      if (this.text === '') return;
      // gli "a capo" ripetuti non accumulano più di una riga vuota
      this.text = (this.text.replace(/\s+$/, '') + command.text).replace(/\n{3,}$/, '\n\n');
      this.capitalizeNext = true;
    }
  }

  private appendWord(word: string): void {
    const separator = this.text === '' || this.text.endsWith('\n') ? '' : ' ';
    const cased = this.capitalizeNext
      ? word.charAt(0).toLocaleUpperCase('it-IT') + word.slice(1)
      : word;
    this.text += separator + cased;
    this.capitalizeNext = false;
  }
}
