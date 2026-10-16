// In-memory OutlineService for tests and E2E mode: answers from a
// script without network, recording the requests for assertions.

import type { GenerateOutlineRequest, OutlineCard, OutlineProposal, OutlineService } from './types';

const SCALETTA_DEFAULT: OutlineCard[] = [
  {
    title: 'La secca',
    summary: 'La protagonista scopre cosa vive nella secca davanti al faro.',
    beats: ['La bassa marea', 'Le ossa di una chiglia', 'Il canto sott’acqua'],
  },
  {
    title: 'Il patto',
    summary: 'Il barista del molo confessa il patto dei pescatori.',
    beats: ['La cantina del bar', 'Il quaderno delle quote', 'La lite sul molo'],
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
