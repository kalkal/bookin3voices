// The native splash (the screen shown by the system before the app starts) is black with the mark,
// set through the expo-splash-screen plugin: the top-level "splash" key is not used by this SDK.

import fs from 'node:fs';
import path from 'node:path';

import { decodeRgba, farthestOpaque } from '../src/testing/png';

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function splashPlugin(): Record<string, unknown> | undefined {
  const entry = (config.plugins as unknown[]).find(
    (p) => Array.isArray(p) && p[0] === 'expo-splash-screen',
  ) as [string, Record<string, unknown>] | undefined;
  return entry?.[1];
}

describe('native splash screen', () => {
  it('is configured through the expo-splash-screen plugin: black with the mark', () => {
    const options = splashPlugin();
    expect(options).toBeDefined();
    expect(options).toMatchObject({ backgroundColor: '#121012', resizeMode: 'contain' });
    expect(typeof options?.imageWidth).toBe('number');
    expect(fs.existsSync(path.join(root, String(options?.image)))).toBe(true);
  });

  it('the package is a declared dependency', () => {
    expect(pkg.dependencies['expo-splash-screen']).toBeDefined();
  });

  it('the splash image is a transparent 1024 square, with the mark inside the Android 12 circle', () => {
    const options = splashPlugin();
    const file = path.join(root, String(options?.image));
    const { width, height, data } = decodeRgba(file);
    expect([width, height]).toEqual([1024, 1024]);
    // the four corners are fully transparent (the old splash image was an opaque cream square)
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ] as const) {
      expect(data[(y * width + x) * 4 + 3]).toBe(0);
    }
    // on Android 12 the system masks the image with a circle of 96 dp: in pixels of the 1024 image
    const circleRadius = (96 / Number(options?.imageWidth)) * 1024;
    expect(farthestOpaque(file)).toBeLessThanOrEqual(circleRadius);
  });

  it('there is no inert top-level splash key', () => {
    expect(config.splash).toBeUndefined();
  });
});
