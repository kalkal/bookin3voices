// Idempotency keys for callables: a new id for every user action, reused only
// by the SDK's internal network retries. Must stick to the characters that are
// safe for a Firestore id (see the inputSchemas on the functions side):
// [A-Za-z0-9_-], max 128.

export function makeRequestId(prefix: string): string {
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random()}${random()}`;
}
