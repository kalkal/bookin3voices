/**
 * Faint gold line drawing of a piece of cathedral, behind a screen: the ONE
 * place for the cathedral backgrounds (`rose` window for the Library; pointed `arches` for Progress and the empty states of a book
 * and of the notebook). The editor, the suggestions and the
 * dictation never use it: writing stays calm.
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

export type CathedralKind = 'rose' | 'arches';

const DRAWINGS = {
  rose: {
    source: require('../../assets/ornaments/rose-window.png'),
    // a whole rose window, wider than the screen, hanging from the top: its lower
    // half shows around the header and the cards (which sit on top of it)
    aspectRatio: 1,
    edge: { top: -110 },
    frame: { width: '130%', left: '-15%' },
  },
  arches: {
    source: require('../../assets/ornaments/arches.png'),
    aspectRatio: 412 / 206,
    edge: { bottom: 0 },
    frame: {},
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

const styles = StyleSheet.create({
  box: { position: 'absolute', left: 0, right: 0, pointerEvents: 'none' },
  picture: { width: '100%', height: '100%' },
});
