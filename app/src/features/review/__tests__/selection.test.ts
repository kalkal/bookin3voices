import { readFileSync } from 'fs';
import { join } from 'path';

import { MIN_SELECTION_WORDS, selectionWords } from '../selection';

describe('selection', () => {
  it('the minimum is the server one (functions/src/ai/refineSelection.ts)', () => {
    const server = readFileSync(
      join(__dirname, '../../../../../functions/src/ai/refineSelection.ts'),
      'utf8',
    );
    expect(server).toContain(`export const MIN_SELECTION_WORDS = ${MIN_SELECTION_WORDS};`);
  });

  it('counts the words of the selected range', () => {
    expect(selectionWords('Elena posò lentamente la tazza.', { from: 6, to: 21 })).toBe(2);
  });
});
