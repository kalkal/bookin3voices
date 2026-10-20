// PNG readers for the tests (no image library: node's zlib only). Test use only.

import fs from 'node:fs';
import zlib from 'node:zlib';

/** Full RGBA decode (all five PNG filters, 8 bit, not interlaced) of an adaptive layer. */
export function decodeRgba(file: string) {
  const buf = fs.readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  expect(buf.readUInt8(25)).toBe(6);
  expect(buf.readUInt8(28)).toBe(0);
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at);
    if (buf.subarray(at + 4, at + 8).toString() === 'IDAT')
      idat.push(buf.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] as number;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x] as number;
      const a = x >= 4 ? (out[y * stride + x - 4] as number) : 0;
      const b = y > 0 ? (out[(y - 1) * stride + x] as number) : 0;
      const c = x >= 4 && y > 0 ? (out[(y - 1) * stride + x - 4] as number) : 0;
      let r = v;
      if (filter === 1) r = v + a;
      else if (filter === 2) r = v + b;
      else if (filter === 3) r = v + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = r & 255;
    }
  }
  return { width, height, data: out };
}

/** Distance from the centre of the farthest pixel that is not (nearly) transparent. */
export function farthestOpaque(file: string) {
  const { width, height, data } = decodeRgba(file);
  let far = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] as number) > 20) {
        far = Math.max(far, Math.hypot(x - width / 2, y - height / 2));
      }
    }
  }
  return far;
}
