// Plain-language messages for failed callables (refine, outline, export).
// Rule: failures are never silent and never technical. The raw server message
// (English, sometimes provider details like expired credentials) is never
// shown; the code picks a message that says what to do next.
//
// The judges build (contest demo) adds reasons in the error `details`: the AI
// calls need an access code, have daily and total caps and a closing date.
// Without those details (every other build) the messages are the usual ones.

import { z } from 'zod';

import { logTestEvent } from '../features/testLog';
import { t, uiLocale } from '../i18n';

export type CallableAction = 'refine' | 'outline' | 'export' | 'title';

const UNREACHABLE_KEYS: Record<CallableAction, string> = {
  refine: 'common.callable.refine.unreachable',
  outline: 'common.callable.outline.unreachable',
  export: 'common.callable.export.unreachable',
  title: 'common.callable.title.unreachable',
};

/** Callable error code without the 'functions/' prefix, or undefined for a plain error. */
function firebaseCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !code.startsWith('functions/')) return undefined;
  return code.slice('functions/'.length);
}

/** Short code for logs: the callable code, else the error's name. */
export function callableErrorCode(error: unknown): string {
  return firebaseCode(error) ?? (error instanceof Error ? error.name : typeof error);
}

const detailsSchema = z.object({
  reason: z.string(),
  scope: z.enum(['user', 'global', 'total']).optional(),
  maxChars: z.number().int().positive().optional(),
});

/** The server's `details` (reason and its parameters), when they are well formed. */
function callableDetails(error: unknown): z.infer<typeof detailsSchema> | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const parsed = detailsSchema.safeParse((error as { details?: unknown }).details);
  return parsed.success ? parsed.data : undefined;
}

/** Callable code and `details.reason` together, e.g. 'permission-denied/access-code-required'. */
function codeAndReason(error: unknown): string | undefined {
  const code = firebaseCode(error);
  const reason = callableDetails(error)?.reason;
  return code === undefined || reason === undefined ? undefined : `${code}/${reason}`;
}

/** The AI call was refused because this phone has not entered a valid access code yet. */
export function isAccessCodeRequired(error: unknown): boolean {
  return codeAndReason(error) === 'permission-denied/access-code-required';
}

/**
 * The live AI is off for now (demo closed, or a daily/total cap reached): the
 * sample book can switch to its pre-recorded example suggestions.
 */
export function isAiUnavailable(error: unknown): boolean {
  const key = codeAndReason(error);
  return key === 'failed-precondition/demo-closed' || key === 'resource-exhausted/limit-reached';
}

/** Message for the judges-build reasons; undefined when the error carries none of them. */
function demoMessageFor(action: CallableAction, error: unknown): string | undefined {
  const key = codeAndReason(error);
  // without the code the server refuses every call, export included
  if (key === 'permission-denied/access-code-required') {
    return t('common.callable.demo.accessCodeRequired');
  }
  if (action === 'export') return undefined;
  const details = callableDetails(error);
  switch (key) {
    case 'failed-precondition/demo-closed':
      return `${t('common.callable.demo.closed')} ${t('common.callable.demo.sampleBook')}`;
    case 'resource-exhausted/limit-reached':
      return `${t(`common.callable.demo.limit.${details?.scope ?? 'user'}`)} ${t(
        'common.callable.demo.sampleBook',
      )}`;
    case 'invalid-argument/text-too-long':
      if (details?.maxChars === undefined) return undefined;
      return t(`common.callable.demo.textTooLong.${action}`, {
        maxChars: details.maxChars.toLocaleString(uiLocale()),
      });
  }
  return undefined;
}

function messageFor(action: CallableAction, error: unknown): string {
  const demo = demoMessageFor(action, error);
  if (demo !== undefined) return demo;
  switch (firebaseCode(error)) {
    case 'unauthenticated':
      return t('common.callable.sessionExpired');
    case 'resource-exhausted':
      return t('common.callable.dailyLimit');
    case 'failed-precondition':
      if (action === 'export') return t('common.callable.export.notReady');
      break;
  }
  return t(UNREACHABLE_KEYS[action]);
}

export function callableErrorMessage(action: CallableAction, error: unknown): string {
  const message = messageFor(action, error);
  // the dev test log records every message the user is shown
  logTestEvent('ui.error', { action, code: callableErrorCode(error), message });
  return message;
}

/** One structured line per failure: what, which request, which code. Never user text. */
export function logCallableFailure(
  action: CallableAction,
  requestId: string,
  error: unknown,
): void {
  const reason = callableDetails(error)?.reason;
  console.warn('callable-failed', {
    action,
    requestId,
    code: callableErrorCode(error),
    ...(reason === undefined ? {} : { reason }),
  });
}
