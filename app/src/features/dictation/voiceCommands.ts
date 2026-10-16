// Spoken punctuation commands (the Android cloud engine does not add
// punctuation). Design choice: the mapping is a dedicated, pure
// POST-PROCESSOR, applied by the higher layers to FINAL transcripts only,
// before accumulation; interim results stay raw (ephemeral).
//
// Known, accepted limitation (Dragon style): a command word spoken as a
// normal word («il punto di vista») is still converted; manual review is the
// remedy, as in reference dictation apps.

type PunctuationCommand = { kind: 'punctuation'; char: string; endsSentence: boolean };
type BreakCommand = { kind: 'break'; text: string };
export type VoiceCommand = PunctuationCommand | BreakCommand;

/**
 * Phrase → command map. Matching is case-insensitive and prefers the longest
 * phrase («punto e virgola» before «punto»). Extensible: one line is enough.
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
 * Accumulates final transcripts, applying voice commands, spacing
 * (no space before punctuation) and capitalization at sentence start.
 * Not thread-safe nor shared: one composer per dictation session.
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

  /** Appends a raw final transcript; returns the updated text. */
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

  /** Literal append (voice commands off): joins with a single space only. */
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
      // punctuation with no word before it (start of text/line): discard it
      if (!endsWithWordChar(this.text)) return;
      this.text = this.text.replace(/\s+$/, '') + command.char;
      if (command.endsSentence) this.capitalizeNext = true;
    } else {
      if (this.text === '') return;
      // repeated line breaks never accumulate more than one blank line
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
