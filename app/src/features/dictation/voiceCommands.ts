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
/** Pauses the microphone, like a tap on it; writes nothing. */
type StopCommand = { kind: 'stop' };
export type VoiceCommand = PunctuationCommand | BreakCommand | StopCommand;

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
    // two words nobody dictates by chance, unlike «pausa» (owner, 22 Oct)
    { phrase: 'ferma dettatura', command: { kind: 'stop' } },
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
    { phrase: 'stop dictation', command: { kind: 'stop' } },
  ],
};

/** The phrase that pauses the microphone, shown as the last command button. */
const STOP_PHRASE: Record<CommandLanguage, string> = {
  it: 'ferma dettatura',
  en: 'stop dictation',
};

export function stopCommandPhrase(language: CommandLanguage): string {
  return STOP_PHRASE[language];
}

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

/** The commands the screen shows to the author, as buttons: the first four, then the stop. */
export function voiceCommandPhrases(language: CommandLanguage): string[] {
  return [...COMMAND_PHRASES[language].slice(0, 4).map((c) => c.phrase), STOP_PHRASE[language]];
}

/** The same commands in guillemets, as the screen labels them. */
export function voiceCommandHints(language: CommandLanguage): string[] {
  return voiceCommandPhrases(language).map((phrase) => `«${phrase}»`);
}

const endsWithWordChar = (s: string) => /[^\s\n]$/.test(s);

/** A capital comes next unless the text ends mid-sentence (after a word or a comma). */
const sentenceStartsAfter = (text: string) =>
  !(endsWithWordChar(text) && !/[.!?]["»']?\s*$/.test(text));

// punctuation a recognizer may glue to a spoken command word («virgola.»)
const GLUED_PUNCTUATION = /^[.,;:!?…«»"']+|[.,;:!?…«»"']+$/g;

/**
 * Accumulates final transcripts, applying voice commands, spacing
 * (no space before punctuation) and capitalization at sentence start. A capital
 * is only ever ADDED (after . ? !), never removed: a name or «I» at the start of
 * a piece keeps it (the recognizer adds no formatting: addsPunctuation false).
 * Not thread-safe nor shared: one composer per dictation session.
 */
export class TranscriptComposer {
  private text: string;
  private capitalizeNext = true;
  private stopRequested = false;
  private readonly language: CommandLanguage;

  constructor(initialText = '', language: CommandLanguage = 'it') {
    this.language = language;
    this.text = initialText;
    this.capitalizeNext = sentenceStartsAfter(initialText);
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

  /** Empties the buffer; `context` is the text it continues (for the next capital). */
  reset(context = ''): void {
    this.text = '';
    this.capitalizeNext = sentenceStartsAfter(context);
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

  /** true once after a «ferma dettatura» was applied (the session then pauses). */
  takeStopRequest(): boolean {
    const requested = this.stopRequested;
    this.stopRequested = false;
    return requested;
  }

  private applyCommand(command: VoiceCommand): void {
    if (command.kind === 'stop') {
      this.stopRequested = true;
    } else if (command.kind === 'punctuation') {
      // punctuation with no word before it (start of text/line): discard it
      if (!endsWithWordChar(this.text)) return;
      this.text = this.text.replace(/\s+$/, '') + command.char;
      if (command.endsSentence) this.capitalizeNext = true;
    } else {
      if (this.text === '') return;
      // a line break ends the sentence: a full stop where none was dictated (a
      // comma or semicolon becomes one; : … ? ! and closing quotes stay)
      const closed = this.text
        .replace(/\s+$/, '')
        .replace(/[,;]$/, '.')
        .replace(/[\p{L}\p{N}]$/u, '$&.');
      // repeated line breaks never accumulate more than one blank line
      this.text = (closed + command.text).replace(/\n{3,}$/, '\n\n');
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
