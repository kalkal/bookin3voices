// Chiave di idempotenza per exportBook: vedi lib/requestId.

import { makeRequestId as make } from '../../lib/requestId';

export function makeRequestId(): string {
  return make('exp');
}
