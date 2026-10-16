import { base64ToUint8Array } from '../base64';

function toBase64(bytes: number[]): string {
  // independent reference: Buffer exists in tests (Node environment)
  return Buffer.from(bytes).toString('base64');
}

describe('base64ToUint8Array', () => {
  it('decodes strings with and without padding', () => {
    expect([...base64ToUint8Array('ZmludG8=')]).toEqual([...'finto'].map((c) => c.charCodeAt(0)));
    expect([...base64ToUint8Array('YQ==')]).toEqual([97]);
    expect([...base64ToUint8Array('YWI=')]).toEqual([97, 98]);
    expect([...base64ToUint8Array('YWJj')]).toEqual([97, 98, 99]);
    expect([...base64ToUint8Array('')]).toEqual([]);
  });

  it('round-trips arbitrary binary bytes', () => {
    const bytes = Array.from({ length: 300 }, (_, i) => (i * 7 + 13) % 256);
    expect([...base64ToUint8Array(toBase64(bytes))]).toEqual(bytes);
  });

  it('rejects non-base64 input', () => {
    expect(() => base64ToUint8Array('non base64!!!')).toThrow('invalid base64');
  });
});
