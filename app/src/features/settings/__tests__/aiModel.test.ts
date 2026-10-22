import { readFileSync } from 'fs';
import { join } from 'path';

import { aiModelLabel, DEFAULT_AI_MODEL_ID } from '../aiModel';

describe('aiModel', () => {
  it('the app default is the model the functions use by default (no drift)', () => {
    const source = readFileSync(
      join(__dirname, '../../../../../functions/src/ai/provider/BedrockNovaProvider.ts'),
      'utf8',
    );
    const match = /DEFAULT_NOVA_MODEL_ID = '([^']+)'/.exec(source);
    expect(match?.[1]).toBe(DEFAULT_AI_MODEL_ID);
  });

  it.each([
    ['amazon.nova-pro-v1:0', 'Amazon Nova Pro'],
    ['us.amazon.nova-pro-v1:0', 'Amazon Nova Pro'],
    ['amazon.nova-lite-v1:0', 'Amazon Nova Lite'],
    ['amazon.nova-premier-v1:0', 'Amazon Nova Premier'],
    ['mistral.mistral-large-2407-v1:0', 'mistral.mistral-large-2407-v1:0'],
    ['something-else', 'something-else'],
  ])('%s is shown as %s', (model, label) => {
    expect(aiModelLabel(model)).toBe(label);
  });
});
