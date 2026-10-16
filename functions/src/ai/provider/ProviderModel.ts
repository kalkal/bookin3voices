// Adapter: exposes an AiProvider as the RefineModel / OutlineModel interfaces
// the callables already use. It is the only place where an AiResult error
// turns into an exception (AiProviderError), so the existing retry loops keep
// working unchanged.

import type { RefineModel } from '../refineTypes';
import type { OutlineModel } from '../types';
import { AiProviderError, DEFAULT_MAX_OUTPUT_TOKENS, type AiProvider } from './types';

interface Prompt {
  systemInstruction: string;
  userText: string;
  responseSchema: Record<string, unknown>;
}

export class ProviderModel implements RefineModel, OutlineModel {
  /**
   * @param provider resolved lazily (credentials and params exist only at runtime)
   */
  constructor(
    private readonly provider: () => AiProvider,
    private readonly temperature: number,
  ) {}

  get modelName(): string {
    return this.provider().modelName;
  }

  async generate(prompt: Prompt): Promise<unknown> {
    const result = await this.provider().generateJson({
      ...prompt,
      temperature: this.temperature,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    });
    if (!result.ok) throw new AiProviderError(result.error);
    return result.value;
  }
}
