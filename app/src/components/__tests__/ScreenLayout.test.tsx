// The shared screen layout: ONE helper decides how far the bottom buttons stay
// from Android's navigation bar (and the iPhone home indicator).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { layoutRoom } from '../../testing/arches';
import { ThemeProvider } from '../../theme';
import { CATHEDRAL_OPACITY } from '../CathedralBackdrop';
import { ARCHES_MIN_HEIGHT, ArchesFill, BOTTOM_COMFORT, useBottomClearance } from '../ScreenLayout';

const NAV_BAR = 48;

function withInsets(children: React.ReactNode, bottom = NAV_BAR) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 780 },
        insets: { top: 24, left: 0, right: 0, bottom },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

function Probe({ base }: { base?: number }) {
  return <Text testID="probe">{String(useBottomClearance(base))}</Text>;
}

describe('useBottomClearance', () => {
  it('keeps a comfortable margin above the navigation bar', async () => {
    const screen = await render(withInsets(<Probe />));
    expect(screen.getByTestId('probe')).toHaveTextContent(String(NAV_BAR + BOTTOM_COMFORT));
  });

  it('a screen can ask for a larger margin, always on top of the inset', async () => {
    const screen = await render(withInsets(<Probe base={32} />));
    expect(screen.getByTestId('probe')).toHaveTextContent(String(NAV_BAR + 32));
  });

  it('without a navigation bar the margin alone remains', async () => {
    const screen = await render(withInsets(<Probe />, 0));
    expect(screen.getByTestId('probe')).toHaveTextContent(String(BOTTOM_COMFORT));
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}

describe('one place for the safe area', () => {
  it('no screen wraps itself in SafeAreaView: they all use Screen from components', () => {
    const features = path.resolve(__dirname, '..', '..', 'features');
    const offenders = sourceFiles(features).filter((file) =>
      /SafeAreaView/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders.map((file) => path.relative(features, file))).toEqual([]);
  });
});

// the arches are hidden from screen readers: the queries look past that
const HIDDEN = { includeHiddenElements: true };

describe('ArchesFill: the arches where a screen leaves empty room at the bottom', () => {
  async function renderFill(ornaments = true) {
    return render(
      <ThemeProvider initialOrnaments={ornaments}>
        <ArchesFill />
      </ThemeProvider>,
    );
  }

  it('with room, the arches stand in the empty space, full width, faint', async () => {
    const screen = await renderFill();
    await layoutRoom(screen.getByTestId('arches-room'), 360, 400);
    const arches = StyleSheet.flatten(screen.getByTestId('cathedral-arches', HIDDEN).props.style);
    // in the flow AFTER the content, never an overlay behind it
    expect(arches.position).not.toBe('absolute');
    expect(arches).toMatchObject({ width: 360, height: 180, opacity: CATHEDRAL_OPACITY });
    expect(arches.pointerEvents).toBe('none');
  });

  it('with a little room, the arches shrink to fit it', async () => {
    const screen = await renderFill();
    await layoutRoom(screen.getByTestId('arches-room'), 360, ARCHES_MIN_HEIGHT + 10);
    const arches = StyleSheet.flatten(screen.getByTestId('cathedral-arches', HIDDEN).props.style);
    expect(arches).toMatchObject({
      height: ARCHES_MIN_HEIGHT + 10,
      width: (ARCHES_MIN_HEIGHT + 10) * 2,
    });
  });

  it('with no real room (or before the first layout), no arches', async () => {
    const screen = await renderFill();
    expect(screen.queryByTestId('cathedral-arches', HIDDEN)).toBeNull();
    await layoutRoom(screen.getByTestId('arches-room'), 360, ARCHES_MIN_HEIGHT - 1);
    expect(screen.queryByTestId('cathedral-arches', HIDDEN)).toBeNull();
  });

  it('switched off in Settings, never drawn', async () => {
    const screen = await renderFill(false);
    await layoutRoom(screen.getByTestId('arches-room'), 360, 400);
    expect(screen.queryByTestId('cathedral-arches', HIDDEN)).toBeNull();
  });

  it('decorative: screen readers skip it', async () => {
    const screen = await renderFill();
    await layoutRoom(screen.getByTestId('arches-room'), 360, 400);
    expect(screen.queryByTestId('cathedral-arches')).toBeNull();
    expect(screen.getByTestId('cathedral-arches', HIDDEN)).toBeOnTheScreen();
  });
});
