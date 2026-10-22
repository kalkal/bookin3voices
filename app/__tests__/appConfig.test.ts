// app.config.ts: app.json is the source of truth; APP_VARIANT=judges only
// changes the Android package and the name (the demo installs next to the app).

import fs from 'node:fs';
import path from 'node:path';

import buildConfig, {
  JUDGES_ANDROID_PACKAGE,
  JUDGES_APP_NAME,
  appVariant,
  withVariant,
} from '../app.config';

const root = path.join(__dirname, '..');
const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

function resolve(variant: string | undefined) {
  const original = process.env.APP_VARIANT;
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  try {
    return buildConfig({
      config: appJson,
      projectRoot: root,
      staticConfigPath: null,
      packageJsonPath: null,
    });
  } finally {
    if (original === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = original;
  }
}

describe('app config by variant', () => {
  it('default: exactly app.json (package dev.kalkal.bookvoice)', () => {
    const config = resolve(undefined);
    expect(config).toEqual(appJson);
    expect(config.android?.package).toBe('dev.kalkal.bookvoice');
    expect(config.name).toBe('bookin3voice');
  });

  it('judges: demo package and name, everything else from app.json', () => {
    const config = resolve('judges');
    expect(config.android?.package).toBe(JUDGES_ANDROID_PACKAGE);
    expect(JUDGES_ANDROID_PACKAGE).toBe('dev.kalkal.bookvoice.demo');
    expect(config.name).toBe(JUDGES_APP_NAME);
    expect(JUDGES_APP_NAME).toBe('bookin3voice (demo)');
    expect(config.android?.permissions).toEqual(appJson.android.permissions);
    expect(config.plugins).toEqual(appJson.plugins);
    expect(config.slug).toBe(appJson.slug);
    expect(config.extra).toEqual(appJson.extra);
  });

  it('unknown variants fall back to the default app', () => {
    expect(appVariant('production')).toBe('default');
    expect(withVariant(appJson, appVariant('preview'))).toEqual(appJson);
  });
});

describe('eas.json judges profile', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8')).build;

  it('internal APK with the access gate and the judges variant, no test log', () => {
    const judges = eas.judges;
    const base = eas[judges.extends];
    expect(base).toMatchObject({ distribution: 'internal', android: { buildType: 'apk' } });
    expect(judges.env).toEqual({
      APP_VARIANT: 'judges',
      EXPO_PUBLIC_ACCESS_GATE: '1',
      EXPO_PUBLIC_SAMPLE_BOOK: '1',
    });
    expect(base.env).toBeUndefined();
  });

  it('no Firebase config committed in any profile', () => {
    expect(JSON.stringify(eas)).not.toMatch(/EXPO_PUBLIC_FIREBASE/);
  });

  it('preview keeps the test log', () => {
    expect(eas.preview.env).toEqual({ EXPO_PUBLIC_TEST_LOG: '1' });
  });
});
