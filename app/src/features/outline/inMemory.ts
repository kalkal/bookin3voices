// In-memory OutlineService for tests and E2E mode: answers from a
// script without network, recording the requests for assertions.

import type { GenerateOutlineRequest, OutlineCard, OutlineProposal, OutlineService } from './types';

const SCALETTA_DEFAULT: OutlineCard[] = [
  {
    title: 'La gola chiusa',
    summary: 'La protagonista scopre cosa vive nella gola sopra il mulino.',
    beats: ['La frana sul sentiero', 'Il favo nella cappella', 'Il ronzio sotto la ruota'],
  },
  {
    title: 'Il patto',
    summary: 'L’anziana del paese confessa il patto della valle.',
    beats: ['Il retro del bar', 'Il quaderno delle quote', 'La lite in piazza'],
  },
];

export class InMemoryOutlineService implements OutlineService {
  readonly requests: GenerateOutlineRequest[] = [];
  /** If set, the next generateOutline fails with this error. */
  nextError?: Error;
  private readonly chapters: OutlineCard[];

  constructor(chapters: OutlineCard[] = SCALETTA_DEFAULT) {
    this.chapters = chapters;
  }

  async generateOutline(request: GenerateOutlineRequest): Promise<OutlineProposal> {
    this.requests.push(request);
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }
    return {
      requestId: request.requestId,
      bookId: request.bookId,
      model: 'in-memory',
      promptVersion: 1,
      createdAt: Date.now(),
      chapters: this.chapters.map((card) => ({ ...card, beats: [...card.beats] })),
    };
  }
}
