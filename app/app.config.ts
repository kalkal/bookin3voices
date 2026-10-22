// Dynamic app config: app.json stays the source of truth, this file only
// applies the build variant. APP_VARIANT=judges (eas.json profile `judges`)
// builds the contest demo next to the regular app: its own Android package and
// a name that says it is the demo. Without APP_VARIANT nothing changes.

import type { ConfigContext, ExpoConfig } from 'expo/config';

export type AppVariant = 'default' | 'judges';

export const JUDGES_ANDROID_PACKAGE = 'dev.kalkal.bookvoice.demo';
export const JUDGES_APP_NAME = 'bookin3voice (demo)';

export function appVariant(value: string | undefined): AppVariant {
  return value === 'judges' ? 'judges' : 'default';
}

export function withVariant(config: Partial<ExpoConfig>, variant: AppVariant): ExpoConfig {
  const base = config as ExpoConfig;
  if (variant === 'default') return base;
  return {
    ...base,
    name: JUDGES_APP_NAME,
    android: { ...base.android, package: JUDGES_ANDROID_PACKAGE },
  };
}

export default ({ config }: ConfigContext): ExpoConfig =>
  withVariant(config, appVariant(process.env.APP_VARIANT));
