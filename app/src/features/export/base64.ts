// Base64 → bytes decoding without depending on atob (not guaranteed on Hermes)
// or on Buffer (it does not exist in React Native). Used to write to disk the
// file received from the exportBook callable.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = new Map<string, number>([...ALPHABET].map((char, index) => [char, index]));

export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/[\s=]+$/g, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean)) {
    throw new Error('invalid base64');
  }
  const byteLength = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const chunk = clean.slice(i, i + 4);
    let bits = 0;
    for (const char of chunk) {
      bits = (bits << 6) | (LOOKUP.get(char) as number);
    }
    bits <<= 6 * (4 - chunk.length);
    // a 24-bit group yields 1–3 bytes, depending on the tail
    const bytesInChunk = chunk.length - 1;
    for (let offset = 0; offset < bytesInChunk && byteIndex < byteLength; offset += 1) {
      bytes[byteIndex] = (bits >> (16 - 8 * offset)) & 0xff;
      byteIndex += 1;
    }
  }
  return bytes;
}

/** UTF-8 text → base64 (for the file sink), without btoa or Buffer. */
export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const bits = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(bits >> 18) & 63];
    out += ALPHABET[(bits >> 12) & 63];
    out += b === undefined ? '=' : ALPHABET[(bits >> 6) & 63];
    out += c === undefined ? '=' : ALPHABET[bits & 63];
  }
  return out;
}
