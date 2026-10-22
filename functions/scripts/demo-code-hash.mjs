// Prints the sha256 of a judges' access code, normalized as the server
// compares it, for the codeSha256 field of config/demo. The code is read from
// standard input (not the command line, so it stays out of the shell history)
// and never printed back. Usage, after a build: `npm run demo:hash`, then type
// the code and press Enter.

import { createInterface } from 'node:readline';

import { accessCodeSha256 } from '../lib/demo/demoGate.js';
import { ACCESS_CODE_PATTERN } from '../lib/demo/redeemAccessCode.js';

const rl = createInterface({ input: process.stdin, output: process.stderr });
rl.question('Access code: ', (answer) => {
  rl.close();
  const code = answer.trim();
  if (!ACCESS_CODE_PATTERN.test(code)) {
    console.error('A code has 8-32 letters, digits, spaces or hyphens.');
    process.exit(1);
  }
  console.log(`codeSha256: ${accessCodeSha256(code)}`);
});
