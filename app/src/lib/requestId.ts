// Chiavi di idempotenza per le callable: id nuovo a ogni azione
// dell'utente, riusato solo dai retry di rete interni all'SDK. Deve rispettare
// i caratteri sicuri per un id Firestore (vedi gli inputSchema lato functions):
// [A-Za-z0-9_-], max 128.

export function makeRequestId(prefix: string): string {
  const random = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random()}${random()}`;
}
