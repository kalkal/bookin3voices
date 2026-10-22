// Security rules of the judges' demo project (firestore.demo.rules, generated
// from firestore.rules by scripts/build-demo-rules.mjs): the owner also needs
// the judge claim and an open demo. Same emulator as firestore.rules.test.ts.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, setLogLevel } from 'firebase/firestore';


setLogLevel('error');

const JUDGE = 'judge-uid';
const BOOK = (uid: string) => `users/${uid}/books/sample`;
const DAY = 86_400_000;

let testEnv: RulesTestEnvironment;

async function setDemo(data: Record<string, unknown> | null): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const ref = doc(ctx.firestore(), 'config/demo');
    if (data === null) {
      const { deleteDoc } = await import('firebase/firestore');
      await deleteDoc(ref);
    } else {
      await setDoc(ref, data);
    }
  });
}

const CODE_HASH = 'a'.repeat(64);
const open = () => ({ enabled: true, expiresAt: Date.now() + 30 * DAY, codeSha256: CODE_HASH });

/** The server marker redeemAccessCode writes for a phone that entered the code. */
async function markJudge(uid: string, codeSha256 = CODE_HASH): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `demoAccess/${uid}`), { codeSha256 });
  });
}
const judgeDb = (uid = JUDGE) => testEnv.authenticatedContext(uid, { judge: true }).firestore();
const book = { schemaVersion: 1, title: 'The Salt Road', status: 'draft' };

beforeAll(async () => {
  const fromEnv = process.env.FIRESTORE_EMULATOR_HOST;
  const [host, port] = fromEnv ? fromEnv.split(':') : ['127.0.0.1', '8080'];
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-judges-rules', // local label only
    firestore: {
      rules: readFileSync(resolve(__dirname, '..', 'firestore.demo.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await setDemo(open());
  await markJudge(JUDGE);
  await markJudge('other-judge');
});

describe('firestore.demo.rules', () => {
  it('is in step with firestore.rules (regenerate with scripts/build-demo-rules.mjs)', () => {
    const script = resolve(__dirname, '..', 'scripts', 'build-demo-rules.mjs');
    expect(() => execFileSync(process.execPath, [script, '--check'])).not.toThrow();
  });

  it('a judge reads and writes only their own space', async () => {
    await assertSucceeds(setDoc(doc(judgeDb(), BOOK(JUDGE)), book));
    await assertSucceeds(getDoc(doc(judgeDb(), BOOK(JUDGE))));
    await assertFails(getDoc(doc(judgeDb('other-judge'), BOOK(JUDGE))));
    await assertFails(setDoc(doc(judgeDb('other-judge'), BOOK(JUDGE)), book));
  });

  it('without the access code (no claim) nothing at all, not even their own space', async () => {
    const noCode = testEnv.authenticatedContext(JUDGE).firestore();
    await assertFails(setDoc(doc(noCode, BOOK(JUDGE)), book));
    await assertFails(getDoc(doc(noCode, BOOK(JUDGE))));
    const wrongType = testEnv.authenticatedContext(JUDGE, { judge: 'true' }).firestore();
    await assertFails(getDoc(doc(wrongType, BOOK(JUDGE))));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), BOOK(JUDGE))));
  });

  it('switched off, expired or missing config: closed for judges too', async () => {
    await setDemo({ ...open(), enabled: false });
    await assertFails(getDoc(doc(judgeDb(), BOOK(JUDGE))));
    await setDemo({ ...open(), expiresAt: Date.now() - DAY });
    await assertFails(getDoc(doc(judgeDb(), BOOK(JUDGE))));
    await setDemo(null);
    await assertFails(getDoc(doc(judgeDb(), BOOK(JUDGE))));
  });

  it('after a code change, phones that entered the old code are locked out at once', async () => {
    await assertSucceeds(setDoc(doc(judgeDb(), BOOK(JUDGE)), book));
    await setDemo({ ...open(), codeSha256: 'b'.repeat(64) });
    await assertFails(getDoc(doc(judgeDb(), BOOK(JUDGE))));
    await markJudge(JUDGE, 'b'.repeat(64)); // the judge enters the new code
    await assertSucceeds(getDoc(doc(judgeDb(), BOOK(JUDGE))));
  });

  it('a claim without the server marker (forged elsewhere) opens nothing', async () => {
    await assertFails(getDoc(doc(judgeDb('never-redeemed'), BOOK('never-redeemed'))));
  });

  it('the server-only documents stay closed to judges', async () => {
    for (const path of ['config/demo', `demoAccess/${JUDGE}`, 'usageTotal/refineChapter']) {
      await assertFails(getDoc(doc(judgeDb(), path)));
      await assertFails(setDoc(doc(judgeDb(), path), { enabled: true }));
    }
  });
});
