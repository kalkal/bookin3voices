/**
 * Generates the BookVoice icon and all derived assets.
 *
 * Concept ("elegant English library"): a bound page
 * where the lines of text, descending, turn into a sound wave —
 * dictation becoming writing.
 *
 * Single source: the shapes are defined here in a 1024x1024 space and from
 * them both the clean SVG (assets/icon-source.svg) and all the PNGs are
 * emitted. SVG->PNG rasterization is done in pure Node (zlib, no native
 * dependency: sharp/resvg not available offline on some machines), with
 * 4x4 supersampling for antialiasing.
 *
 * Usage: node scripts/generate-app-icon.mjs   (from app/)
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');

// --- Palette (design tokens) ---
const HEX = {
  paper: '#F0E8D3', // light paper
  green: '#2E5343', // library green (spine)
  filet: '#C9A961', // gold (rule)
  ink: '#2C241B', // ink (text lines)
  wave: '#A8853B', // antique gold (sound wave)
};
const RGB = Object.fromEntries(
  Object.entries(HEX).map(([k, v]) => [k, [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16))]),
);

// --- Shapes, 1024x1024 space (rectangles, optionally with a radius) ---
const N = 1024;
const marks = [];
// Bound spine on the left (~11.5% of the width) + thin gold rule beside it.
marks.push({ x0: 0, y0: 0, x1: 118, y1: 1024, r: 0, color: 'green' });
marks.push({ x0: 132, y0: 0, x1: 146, y1: 1024, r: 0, color: 'filet' });
// Top part: 3 "text" lines (horizontal capsules, different lengths).
const cap = (x0, x1, cy, h, color) => ({
  x0,
  x1,
  y0: cy - h / 2,
  y1: cy + h / 2,
  r: h / 2,
  color,
});
marks.push(cap(210, 858, 235, 46, 'ink'));
marks.push(cap(210, 742, 325, 46, 'ink'));
marks.push(cap(210, 806, 415, 46, 'ink'));
// Bottom part: the lines become a sound wave (vertical bars, equalizer),
// centered on the height of a line (cy=655).
const barCx = [233, 308, 383, 458, 533, 608, 683, 758, 833];
const barH = [110, 200, 300, 240, 340, 180, 270, 220, 140];
const waveCy = 655;
const barW = 46;
barCx.forEach((cx, i) => {
  const h = barH[i];
  marks.push({
    x0: cx - barW / 2,
    x1: cx + barW / 2,
    y0: waveCy - h / 2,
    y1: waveCy + h / 2,
    r: barW / 2,
    color: 'wave',
  });
});

// "page-card" variant for the centered assets (adaptive/monochrome/splash):
// spine and rule do NOT span the full height but enclose the text+wave block,
// so the emblem is compact and stays inside the safe zone even with a
// circular mask. The lines/wave are the same.
const SPINE_TOP = 190;
const SPINE_BOTTOM = 835;
const cardMarks = marks.map((sh) =>
  sh.color === 'green' || sh.color === 'filet' ? { ...sh, y0: SPINE_TOP, y1: SPINE_BOTTOM } : sh,
);

// Affine map: takes the source's (cx,cy) to the center (512,512) with factor s.
const affine = (shapes, s, cx, cy) =>
  shapes.map((sh) => ({
    x0: 512 + (sh.x0 - cx) * s,
    y0: 512 + (sh.y0 - cy) * s,
    x1: 512 + (sh.x1 - cx) * s,
    y1: 512 + (sh.y1 - cy) * s,
    r: sh.r * s,
    color: sh.color,
  }));

// Center of the emblem's bounding box and scale to fill the central 66% (626px)
// in width (dominant dimension).
const CARD_CX = (0 + 858) / 2;
const CARD_CY = (SPINE_TOP + SPINE_BOTTOM) / 2;
const emblem = (fillPx) => affine(cardMarks, fillPx / 858, CARD_CX, CARD_CY);

// Point-in-rounded-rectangle test (Minkowski sum of rect + disc).
const contains = (sh, ax, ay) => {
  const nx = Math.min(Math.max(ax, sh.x0 + sh.r), sh.x1 - sh.r);
  const ny = Math.min(Math.max(ay, sh.y0 + sh.r), sh.y1 - sh.r);
  const dx = ax - nx;
  const dy = ay - ny;
  return dx * dx + dy * dy <= sh.r * sh.r + 1e-6;
};

// --- Rasterizer (4x4 supersampling) ---
const SS = 4;
function rasterize(shapes, T, { includePaper, forceColor }) {
  const buf = Buffer.alloc(T * T * 4); // RGBA
  const scale = N / T; // design units per pixel
  const inv = 1 / (SS * SS);
  for (let py = 0; py < T; py++) {
    for (let px = 0; px < T; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ax = (px + (sx + 0.5) / SS) * scale;
          const ay = (py + (sy + 0.5) / SS) * scale;
          let col = null;
          if (includePaper) col = RGB.paper;
          for (let k = 0; k < shapes.length; k++) {
            if (contains(shapes[k], ax, ay)) {
              col = forceColor || RGB[shapes[k].color];
            }
          }
          if (col) {
            r += col[0];
            g += col[1];
            b += col[2];
            a += 255;
          }
        }
      }
      const o = (py * T + px) * 4;
      // premultiplied average -> straight color
      buf[o] = a ? Math.round(r / (a / 255)) : 0;
      buf[o + 1] = a ? Math.round(g / (a / 255)) : 0;
      buf[o + 2] = a ? Math.round(b / (a / 255)) : 0;
      buf[o + 3] = Math.round(a * inv);
    }
  }
  return buf;
}

// --- PNG encoder (RGBA, zlib) ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(rgba, W, H) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(H * (W * 4 + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Source SVG (full-bleed, with paper) ---
function toSVG() {
  const rect = (sh) => {
    const w = sh.x1 - sh.x0;
    const h = sh.y1 - sh.y0;
    const rx = sh.r ? ` rx="${sh.r}"` : '';
    return `  <rect x="${sh.x0}" y="${sh.y0}" width="${w}" height="${h}"${rx} fill="${HEX[sh.color]}"/>`;
  };
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    `  <rect width="1024" height="1024" fill="${HEX.paper}"/>`,
    ...marks.map(rect),
    '</svg>',
    '',
  ].join('\n');
}

// --- Output ---
const fg = emblem(626); // adaptive/monochrome: fills the central 66%
const splash = emblem(560); // splash: tighter emblem, with more air
const write = (name, T, shapes, opts) => {
  const png = encodePNG(rasterize(shapes, T, opts), T, T);
  fs.writeFileSync(path.join(ASSETS, name), png);
  console.log(`  ${name}  ${T}x${T}  ${png.length}B`);
};

fs.writeFileSync(path.join(ASSETS, 'icon-source.svg'), toSVG());
console.log('Generated assets:');
console.log('  icon-source.svg (source)');
// App icon (full-bleed, with paper)
write('icon.png', 1024, marks, { includePaper: true });
// Android adaptive icon: foreground (centered subject, no paper) + paper background
write('android-icon-foreground.png', 1024, fg, { includePaper: false });
write('android-icon-background.png', 1024, [], { includePaper: true });
write('android-icon-monochrome.png', 1024, fg, {
  includePaper: false,
  forceColor: [0, 0, 0],
});
// Splash: emblem centered on paper background
write('splash-icon.png', 1024, splash, { includePaper: true });
// Web favicon (full-bleed)
write('favicon.png', 48, marks, { includePaper: true });
