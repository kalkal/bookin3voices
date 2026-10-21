// Plain-language messages for failed callables (refine, outline, export).
// Rule: failures are never silent and never technical. The raw server message
// (English, sometimes provider details like expired credentials) is never
// shown; the code picks a message that says what to do next.

import { t } from '../i18n';

export type CallableAction = 'refine' | 'outline' | 'export';

const UNREACHABLE_KEYS: Record<CallableAction, string> = {
  refine: 'common.callable.refine.unreachable',
  outline: 'common.callable.outline.unreachable',
  export: 'common.callable.export.unreachable',
};

/** Callable error code without the 'functions/' prefix, or undefined for a plain error. */
function firebaseCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string' || !code.startsWith('functions/')) return undefined;
  return code.slice('functions/'.length);
}

export function callableErrorMessage(action: CallableAction, error: unknown): string {
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

/** One structured line per failure: what, which request, which code. Never user text. */
export function logCallableFailure(
  action: CallableAction,
  requestId: string,
  error: unknown,
): void {
  const code = firebaseCode(error) ?? (error instanceof Error ? error.name : typeof error);
  console.warn('callable-failed', { action, requestId, code });
}
