import { readFileSync } from 'fs';
import { join } from 'path';

import { checkProposal } from '../proposalGuard';

describe('proposalGuard (app copy of the server rule)', () => {
  it('is the same code as functions/src/ai/proposalGuard.ts (imports aside)', () => {
    const body = (file: string) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('import '))
        .join('\n')
        .replace(/^\/\/.*\n/gm, '');
    expect(body(join(__dirname, '../proposalGuard.ts'))).toBe(
      body(join(__dirname, '../../../../../functions/src/ai/proposalGuard.ts')),
    );
  });

  it('refuses the phone cases and keeps a real fix', () => {
    expect(checkProposal('grammar', 'punto e virgola', ". L'uomo osservò.").ok).toBe(false);
    expect(checkProposal('grammar', 'un altra tazza', "un'altra tazza").ok).toBe(true);
  });
});
