// The app icon and its derived images: right size, right transparency, and the black-and-gold look.
// PNGs are read with node's zlib only (no image library): the size from the IHDR chunk and the very
// first pixel from the first filtered scanline (for pixel 0 every PNG filter gives back the raw bytes).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ASSETS = path.join(__dirname, '..', 'assets');

function readPng(file: string) {
  const buf = fs.readFileSync(file);
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);
  expect(bitDepth).toBe(8);
  expect([2, 6]).toContain(colorType); // RGB or RGBA
  const interlace = buf.readUInt8(28);
  const idat: Buffer[] = [];
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at);
    const type = buf.subarray(at + 4, at + 8).toString();
    if (type === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // colour type 6 = RGBA, 2 = RGB (8 bit): the first pixel follows the filter byte
  const channels = colorType === 6 ? 4 : 3;
  const first = Array.from(raw.subarray(1, 1 + channels));
  return { width, height, colorType, interlace, first };
}

const BLACK = [0x12, 0x10, 0x12];

/** Full RGBA decode (all five PNG filters, 8 bit, not interlaced) of an adaptive layer. */
function decodeRgba(file: string) {
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
function farthestOpaque(file: string) {
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

describe('brand assets (icon, Android adaptive layers, favicon)', () => {
  it('the app icon is a 1024 square on solid near-black, no transparency', () => {
    const icon = readPng(path.join(ASSETS, 'icon.png'));
    expect([icon.width, icon.height]).toEqual([1024, 1024]);
    expect(icon.first.slice(0, 3)).toEqual(BLACK);
    if (icon.colorType === 6) expect(icon.first[3]).toBe(255);
  });

  it('the adaptive icon: transparent foreground, near-black background, transparent monochrome', () => {
    const foreground = readPng(path.join(ASSETS, 'android-icon-foreground.png'));
    const background = readPng(path.join(ASSETS, 'android-icon-background.png'));
    const mono = readPng(path.join(ASSETS, 'android-icon-monochrome.png'));
    for (const layer of [foreground, background, mono]) {
      expect([layer.width, layer.height]).toEqual([1024, 1024]);
    }
    expect(foreground.colorType).toBe(6);
    expect(foreground.first[3]).toBe(0);
    expect(mono.colorType).toBe(6);
    expect(mono.first[3]).toBe(0);
    expect(background.first.slice(0, 3)).toEqual(BLACK);
  });

  it('the adaptive artwork stays inside the 66 dp safe circle (radius 313 px of 1024)', () => {
    // Android masks the layers (circle, squircle...): anything outside this circle can be cut
    for (const name of ['android-icon-foreground.png', 'android-icon-monochrome.png']) {
      expect(farthestOpaque(path.join(ASSETS, name))).toBeLessThanOrEqual(313);
    }
  });

  it('the web favicon is 48 px', () => {
    const favicon = readPng(path.join(ASSETS, 'favicon.png'));
    expect([favicon.width, favicon.height]).toEqual([48, 48]);
  });

  it('the icon sources are glyph outlines: no font or text in the SVG', () => {
    for (const name of ['icon-source.svg', 'icon-small-source.svg']) {
      const svg = fs.readFileSync(path.join(ASSETS, name), 'utf8');
      expect(svg).not.toMatch(/<text|font-family|@import/);
      expect(svg).toContain('#c9a24e');
    }
  });
});
