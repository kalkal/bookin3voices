// Text → base64 for the file sink, without atob/btoa or Buffer.

import { base64ToUint8Array, utf8ToBase64 } from '../base64';

describe('utf8ToBase64', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['{"t":1}\n', 'eyJ0IjoxfQo='],
  ])('encodes %j', (text, expected) => {
    expect(utf8ToBase64(text)).toBe(expected);
  });

  it('round-trips accented text and emoji through the existing decoder', () => {
    const text = 'perché «così» — è già 📖';
    const bytes = base64ToUint8Array(utf8ToBase64(text));
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });
});
