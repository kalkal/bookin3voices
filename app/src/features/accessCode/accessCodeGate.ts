// Access code for the judges build (contest demo). Without the code the server
// refuses every call (the app then runs in offline sample mode, see offlineSample.ts).
// The code is asked from the sample-mode banner, or lazily: a call refused with
// `access-code-required` opens the prompt, a code accepted by the server closes
// it and the same call is retried once. Nothing secret is kept on the phone:
// the server sets the `judge` claim on this anonymous user.

import { FirebaseError } from 'firebase/app';
import { httpsCallable, type Functions } from 'firebase/functions';

import { callableErrorCode, isAccessCodeRequired } from '../../lib/callableErrors';
import { t } from '../../i18n';
import type { BookExportService, ExportFile, ExportRequest } from '../export';
import type { GenerateOutlineRequest, OutlineProposal, OutlineService } from '../outline';
import type {
  RefineRequest,
  RefineResult,
  SuggestionsProvider,
  TitleRefineRequest,
  TitleRefineResult,
  TitleRefineService,
} from '../review';
import type { BackupFile, BackupRequest, BackupService } from '../settings';

/** On only in the judges build (eas.json profile `judges`), inlined at build time. */
export function isAccessGateEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ACCESS_GATE === '1';
}

/**
 * The error the server gives without the access code, made locally by the
 * offline sample mode: the gate opens the prompt on it, and its message is
 * already the plain one (some screens show an error's message as is).
 */
export function accessCodeRequiredError(): FirebaseError {
  return Object.assign(
    new FirebaseError('functions/permission-denied', t('common.callable.demo.accessCodeRequired')),
    { details: { reason: 'access-code-required' } },
  );
}

/** Why a code was not accepted, as shown in the prompt. */
export type RedeemFailure =
  'invalid-format' | 'wrong-code' | 'too-many-attempts' | 'demo-closed' | 'unreachable';

/** Longest code the prompt accepts (the text field stops there too). */
export const ACCESS_CODE_MAX_LENGTH = 32;

/** The only codes ever sent: letters, digits, spaces, hyphens, 8–32 characters (as the server). */
const ACCESS_CODE_PATTERN = /^[A-Za-z0-9 -]{8,32}$/;

/** True for a trimmed code the server could accept; anything else never leaves the phone. */
export function isWellFormedAccessCode(code: string): boolean {
  return ACCESS_CODE_PATTERN.test(code.trim());
}

export interface AccessCodeService {
  /** Resolves when the server accepted the code for this phone; rejects otherwise. */
  redeem(code: string): Promise<void>;
}

type CallRedeem = (data: { code: string }) => Promise<{ data: unknown }>;

/** AccessCodeService on the `redeemAccessCode` callable. */
export class CallableAccessCodeService implements AccessCodeService {
  private readonly call: CallRedeem;

  constructor(deps: { functions: Functions } | { call: CallRedeem }) {
    this.call =
      'call' in deps
        ? deps.call
        : httpsCallable<{ code: string }, unknown>(deps.functions, 'redeemAccessCode');
  }

  async redeem(code: string): Promise<void> {
    const result = await this.call({ code });
    const ok =
      typeof result.data === 'object' &&
      result.data !== null &&
      (result.data as { ok?: unknown }).ok === true;
    if (!ok) throw new Error('Unexpected redeemAccessCode response');
  }
}

const FAILURES: Record<string, RedeemFailure> = {
  'permission-denied': 'wrong-code',
  'resource-exhausted': 'too-many-attempts',
  'failed-precondition': 'demo-closed',
};

/** Prompt failure for a rejected redeem: by callable code; anything else is "not checked". */
export function redeemFailure(error: unknown): RedeemFailure {
  return FAILURES[callableErrorCode(error)] ?? 'unreachable';
}

export interface AccessCodePromptState {
  open: boolean;
  submitting: boolean;
  failure: RedeemFailure | null;
}

const CLOSED: AccessCodePromptState = { open: false, submitting: false, failure: null };

/**
 * State of the access code prompt plus the retry logic around the AI calls.
 * The screens never see it: the gated provider and outline service use it,
 * and AccessCodeModalHost renders its state.
 */
export class AccessCodeGate {
  private state: AccessCodePromptState = CLOSED;
  private readonly listeners = new Set<() => void>();
  private pending: { promise: Promise<boolean>; resolve: (redeemed: boolean) => void } | null =
    null;

  constructor(private readonly service: AccessCodeService) {}

  getState = (): AccessCodePromptState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Opens the prompt; true once a code is accepted, false if the user cancels. */
  requestCode(): Promise<boolean> {
    // two AI calls refused together share the same prompt
    if (this.pending !== null) return this.pending.promise;
    let resolve: (redeemed: boolean) => void = () => {};
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    this.pending = { promise, resolve };
    this.setState({ open: true, submitting: false, failure: null });
    return promise;
  }

  async submit(code: string): Promise<void> {
    const trimmed = code.trim();
    if (trimmed === '' || this.pending === null || this.state.submitting) return;
    // one id per attempt, to follow it in the logs (never the code itself)
    const attemptId = `code-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (!isWellFormedAccessCode(trimmed)) {
      // refused here, the server is never called; the log says why, never what was typed
      console.warn('access-code-rejected', {
        attemptId,
        code: 'local',
        failure: 'invalid-format',
      });
      this.setState({ open: true, submitting: false, failure: 'invalid-format' });
      return;
    }
    this.setState({ open: true, submitting: true, failure: null });
    try {
      await this.service.redeem(trimmed);
      // never the code itself in the logs
      console.info('access-code-redeemed', { attemptId });
      this.finish(true);
    } catch (error) {
      const failure = redeemFailure(error);
      console.warn('access-code-rejected', { attemptId, code: callableErrorCode(error), failure });
      this.setState({ open: true, submitting: false, failure });
    }
  }

  cancel(): void {
    if (this.state.submitting) return;
    this.finish(false);
  }

  /**
   * Runs an AI call; if the server asks for the access code, prompts for it and
   * retries the call once. A cancelled prompt rethrows the original error, so
   * the screen shows its usual message (with Retry).
   */
  async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!isAccessCodeRequired(error)) throw error;
      const redeemed = await this.requestCode();
      if (!redeemed) throw error;
      return action();
    }
  }

  private finish(redeemed: boolean): void {
    const pending = this.pending;
    this.pending = null;
    this.setState(CLOSED);
    pending?.resolve(redeemed);
  }

  private setState(next: AccessCodePromptState): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

/** SuggestionsProvider decorator: refine goes through the access code gate. */
export class GatedSuggestionsProvider implements SuggestionsProvider {
  constructor(
    private readonly inner: SuggestionsProvider,
    private readonly gate: AccessCodeGate,
  ) {}

  refine(request: RefineRequest): Promise<RefineResult> {
    return this.gate.run(() => this.inner.refine(request));
  }
}

/** OutlineService decorator: generateOutline goes through the access code gate. */
export class GatedOutlineService implements OutlineService {
  constructor(
    private readonly inner: OutlineService,
    private readonly gate: AccessCodeGate,
  ) {}

  generateOutline(request: GenerateOutlineRequest): Promise<OutlineProposal> {
    return this.gate.run(() => this.inner.generateOutline(request));
  }
}

/** BookExportService decorator: export goes through the access code gate. */
export class GatedBookExportService implements BookExportService {
  constructor(
    private readonly inner: BookExportService,
    private readonly gate: AccessCodeGate,
  ) {}

  exportBook(request: ExportRequest): Promise<ExportFile> {
    return this.gate.run(() => this.inner.exportBook(request));
  }
}

/** BackupService decorator: backup goes through the access code gate. */
export class GatedBackupService implements BackupService {
  constructor(
    private readonly inner: BackupService,
    private readonly gate: AccessCodeGate,
  ) {}

  exportBackup(request: BackupRequest): Promise<BackupFile> {
    return this.gate.run(() => this.inner.exportBackup(request));
  }
}

/**
 * TitleRefineService decorator: refineTitle goes through the access code gate.
 * The title service returns errors as values, so the gate reads the flag.
 */
export class GatedTitleRefineService implements TitleRefineService {
  constructor(
    private readonly inner: TitleRefineService,
    private readonly gate: AccessCodeGate,
  ) {}

  async suggestTitles(request: TitleRefineRequest): Promise<TitleRefineResult> {
    const first = await this.inner.suggestTitles(request);
    if (first.ok || first.accessCodeRequired !== true) return first;
    const redeemed = await this.gate.requestCode();
    return redeemed ? this.inner.suggestTitles(request) : first;
  }
}
