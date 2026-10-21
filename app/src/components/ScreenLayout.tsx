/**
 * The shared frame of every screen, and its one rule for the cathedral arches.
 * `Screen` keeps the content away from the status bar and the notch; the
 * BOTTOM is left to `useBottomClearance`, the one helper that decides how far a
 * bottom button or bar stays from Android's navigation bar (or the iPhone home
 * indicator). Floating buttons are positioned
 * absolutely, and an absolute child ignores the parent's padding: so the inset
 * is never left to SafeAreaView padding, it is added once, here.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Platform,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { ARCHES_ASPECT, ArchesDrawing } from './CathedralBackdrop';

/** Room kept between a bottom button and the navigation bar, on top of the inset. */
export const BOTTOM_COMFORT = 16;

/** Distance from the bottom edge for a button or bar: system inset + `base` margin. */
export function useBottomClearance(base: number = BOTTOM_COMFORT): number {
  const { bottom } = useSafeAreaInsets();
  return Math.max(0, bottom) + base;
}

/**
 * Height the open keyboard covers at the bottom of the screen (0 when closed),
 * for a screen with text input to keep its content above it. The app is
 * edge-to-edge, so Android no longer shrinks the window for the keyboard; and
 * React Native reports the Android keyboard height WITHOUT the navigation bar
 * (IME inset minus system bars), while the content reaches under that bar:
 * there the bottom inset is added back. iOS reports it from the screen edge.
 */
export function useKeyboardRoom(): number {
  const { bottom } = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(0);

  useEffect(() => {
    // iOS announces the keyboard before it moves; Android only once it is up
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const shown = Keyboard.addListener(showEvent, (event: KeyboardEvent) =>
      setKeyboard(Math.max(0, event.endCoordinates.height)),
    );
    const hidden = Keyboard.addListener(hideEvent, () => setKeyboard(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  if (keyboard === 0) return 0;
  return Platform.OS === 'android' ? keyboard + Math.max(0, bottom) : keyboard;
}

export function Screen({
  testID,
  style,
  children,
}: {
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <SafeAreaView
      testID={testID}
      style={[{ flex: 1, backgroundColor: colors.background }, style]}
      edges={['top', 'left', 'right']}
    >
      {children}
    </SafeAreaView>
  );
}

/** Below this much empty height the arches are left out: a sliver would look like a smear. */
export const ARCHES_MIN_HEIGHT = 72;

/**
 * The cathedral arches wherever a screen leaves a bit of empty room at the
 * bottom (every screen but the Library, which has its rose window). Put it LAST
 * in a scroll content whose container has `flexGrow: 1`: it takes the room the
 * content leaves, measures it, and draws the arches there, after the content,
 * never behind it. So the arches can never lower the text contrast or cover a
 * tap target. No room, no arches; ornaments off in Settings, no arches.
 */
export function ArchesFill() {
  const { ornaments } = useTheme();
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setRoom((current) =>
      current !== null && current.width === width && current.height === height
        ? current
        : { width, height },
    );
  };

  // the drawing is never taller than the room, nor wider than the screen
  const height = room === null ? 0 : Math.min(room.height, room.width / ARCHES_ASPECT);
  const show = ornaments && room !== null && height >= ARCHES_MIN_HEIGHT;

  return (
    <View
      testID="arches-room"
      onLayout={onLayout}
      style={{ flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center' }}
    >
      {show && <ArchesDrawing width={height * ARCHES_ASPECT} height={height} />}
    </View>
  );
}
