/**
 * Faint gold line drawing of a piece of cathedral: the ONE place for the
 * cathedral drawings. The `rose` window hangs behind the Library; the pointed
 * arches (`ArchesDrawing`) are never behind content: ArchesFill in the screen
 * layout places them after it, where the screen leaves room. The editor, the
 * suggestions and the dictation never use them: writing stays calm.
 *
 * The drawings are transparent PNGs with full gold lines; the opacity is set
 * here, once, and pinned by a contrast test (text keeps 4.5:1 even under a
 * line). Settings can switch the drawing off (`ornaments` in the theme).
 * Purely decorative: no accessibility label, so screen readers skip it.
 */
import { Image, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';

/** Opacity of the drawing. Raising it needs the contrast test to still pass. */
export const CATHEDRAL_OPACITY = 0.15;

export type CathedralKind = 'rose';

/** Width / height of the arches drawing. */
export const ARCHES_ASPECT = 412 / 206;
const ARCHES_SOURCE = require('../../assets/ornaments/arches.png');

const DRAWINGS = {
  rose: {
    source: require('../../assets/ornaments/rose-window.png'),
    // a whole rose window, wider than the screen, hanging from the top: its lower
    // half shows around the header and the cards (which sit on top of it)
    aspectRatio: 1,
    edge: { top: -110 },
    frame: { width: '130%', left: '-15%' },
  },
} as const;

export function CathedralBackdrop({ kind }: { kind: CathedralKind }) {
  const { ornaments } = useTheme();
  if (!ornaments) return null;
  const drawing = DRAWINGS[kind];
  // the box carries the proportions (on the web an Image alone takes its natural
  // height); the picture fills it
  return (
    <View
      testID={`cathedral-${kind}`}
      style={[
        styles.box,
        drawing.frame,
        drawing.edge,
        { aspectRatio: drawing.aspectRatio, opacity: CATHEDRAL_OPACITY },
      ]}
    >
      <Image source={drawing.source} resizeMode="cover" style={styles.picture} />
    </View>
  );
}

/**
 * The arches at a given size, in the normal flow (the caller has measured the
 * room). Decorative: hidden from screen readers, never takes a touch.
 */
export function ArchesDrawing({ width, height }: { width: number; height: number }) {
  return (
    <View
      testID="cathedral-arches"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, opacity: CATHEDRAL_OPACITY, pointerEvents: 'none' }}
    >
      <Image source={ARCHES_SOURCE} resizeMode="contain" style={styles.picture} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', left: 0, right: 0, pointerEvents: 'none' },
  picture: { width: '100%', height: '100%' },
});
