// Spoken punctuation commands (the Android cloud engine does not add
// punctuation). Design choice: the mapping is a dedicated, pure
// POST-PROCESSOR, applied by the higher layers to FINAL transcripts only,
// before accumulation; interim results stay raw (ephemeral).
//
// Known, accepted limitation (Dragon style): a command word spoken as a
// normal word («il punto di vista») is still converted; manual review is the
// remedy, as in reference dictation apps.

import type { CommandLanguage } from './dictationLanguage';

type PunctuationCommand = { kind: 'punctuation'; char: string; endsSentence: boolean };
type BreakCommand = { kind: 'break'; text: string };
export type VoiceCommand = PunctuationCommand | BreakCommand;

type CommandPhrase = { phrase: string; command: VoiceCommand };

/**
 * Phrase → command map per dictation language. Matching is case-insensitive
 * and prefers the longest phrase («punto e virgola» before «punto»).
 * Extensible: one line is enough. The first four entries of each language are
 * the hints the screen shows (voiceCommandHints).
 */
const COMMAND_PHRASES: Record<CommandLanguage, readonly CommandPhrase[]> = {
  it: [
    { phrase: 'punto', command: { kind: 'punctuation', char: '.', endsSentence: true } },
    { phrase: 'virgola', command: { kind: 'punctuation', char: ',', endsSentence: false } },
    { phrase: 'a capo', command: { kind: 'break', text: '\n' } },
    { phrase: 'nuovo paragrafo', command: { kind: 'break', text: '\n\n' } },
    {
      phrase: 'punto e virgola',
      command: { kind: 'punctuation', char: ';', endsSentence: false },
    },
    {
      phrase: 'punto interrogativo',
      command: { kind: 'punctuation', char: '?', endsSentence: true },
    },
    {
      phrase: 'punto esclamativo',
      command: { kind: 'punctuation', char: '!', endsSentence: true },
    },
    { phrase: 'due punti', command: { kind: 'punctuation', char: ':', endsSentence: false } },
  ],
  en: [
    { phrase: 'period', command: { kind: 'punctuation', char: '.', endsSentence: true } },
    { phrase: 'comma', command: { kind: 'punctuation', char: ',', endsSentence: false } },
    { phrase: 'new line', command: { kind: 'break', text: '\n' } },
    { phrase: 'new paragraph', command: { kind: 'break', text: '\n\n' } },
    { phrase: 'full stop', command: { kind: 'punctuation', char: '.', endsSentence: true } },
    { phrase: 'semicolon', command: { kind: 'punctuation', char: ';', endsSentence: false } },
    { phrase: 'colon', command: { kind: 'punctuation', char: ':', endsSentence: false } },
    {
      phrase: 'question mark',
      command: { kind: 'punctuation', char: '?', endsSentence: true },
    },
    {
      phrase: 'exclamation mark',
      command: { kind: 'punctuation', char: '!', endsSentence: true },
    },
    {
      phrase: 'exclamation point',
      command: { kind: 'punctuation', char: '!', endsSentence: true },
    },
  ],
};

const LOCALE: Record<CommandLanguage, string> = { it: 'it-IT', en: 'en-US' };

/** Longest phrase first, so «punto e virgola» wins over «punto». */
const byLongestPhrase = (phrases: readonly CommandPhrase[]) =>
  phrases
    .map((c) => ({ command: c.command, tokens: c.phrase.split(' ') }))
    .sort((a, b) => b.tokens.length - a.tokens.length);

const VOICE_COMMANDS: Record<CommandLanguage, ReturnType<typeof byLongestPhrase>> = {
  it: byLongestPhrase(COMMAND_PHRASES.it),
  en: byLongestPhrase(COMMAND_PHRASES.en),
};

/** The commands the screen shows to the author, in guillemets. */
export function voiceCommandHints(language: CommandLanguage): string[] {
  return COMMAND_PHRASES[language].slice(0, 4).map((c) => `«${c.phrase}»`);
}

const endsWithWordChar = (s: string) => /[^\s\n]$/.test(s);

// punctuation a recognizer may glue to a spoken command word («virgola.»)
const GLUED_PUNCTUATION = /^[.,;:!?…«»"']+|[.,;:!?…«»"']+$/g;

/** «Un» but not «UE» or «iPhone»: the capital a recognizer puts on every piece. */
const isTitleCase = (word: string) => /^\p{Lu}\p{Ll}*$/u.test(word.replace(GLUED_PUNCTUATION, ''));

/**
 * Accumulates final transcripts, applying voice commands, spacing
 * (no space before punctuation) and capitalization at sentence start.
 * Not thread-safe nor shared: one composer per dictation session.
 */
export class TranscriptComposer {
  private text: string;
  private capitalizeNext = true;
  private readonly language: CommandLanguage;

  constructor(initialText = '', language: CommandLanguage = 'it') {
    this.language = language;
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
    // a recognizer that formats its text starts every piece with a capital, even
    // after a comma: the capital belongs only after a full stop (or ? !)
    const first = tokens[0];
    if (first !== undefined && !this.capitalizeNext && isTitleCase(first)) {
      tokens[0] = first.charAt(0).toLocaleLowerCase(LOCALE[this.language]) + first.slice(1);
    }
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
    for (const { tokens: phraseTokens, command } of VOICE_COMMANDS[this.language]) {
      if (from + phraseTokens.length > tokens.length) continue;
      const matches = phraseTokens.every(
        (t, k) =>
          (tokens[from + k] as string)
            .replace(GLUED_PUNCTUATION, '')
            .toLocaleLowerCase(LOCALE[this.language]) === t,
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
      ? word.charAt(0).toLocaleUpperCase(LOCALE[this.language]) + word.slice(1)
      : word;
    this.text += separator + cased;
    // a full stop (or ? !) the recognizer wrote into the word ends the sentence too
    this.capitalizeNext = /[.!?]["»']?$/.test(word);
  }
}
