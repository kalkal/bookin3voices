// Helpers for the tests of the cathedral arches at the bottom of a screen. Test use only.

import { act, fireEvent, type RenderResult } from '@testing-library/react-native';

/** A rendered host element, as the queries return it. */
type HostElement = ReturnType<RenderResult['getByTestId']>;

/** Gives the empty room at the bottom of a screen a size, as onLayout does on a phone. */
export async function layoutRoom(room: HostElement, width: number, height: number) {
  await act(async () => {
    fireEvent(room, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });
  });
}

/** testIDs of the host tree in render order (top to bottom of the screen). */
export function testIdsInOrder(root: HostElement): string[] {
  const ids: string[] = [];
  const walk = (node: HostElement) => {
    if (typeof node.type === 'string' && typeof node.props.testID === 'string') {
      ids.push(node.props.testID);
    }
    node.children.forEach((child) => {
      if (typeof child !== 'string') walk(child);
    });
  };
  walk(root);
  return ids;
}

/** True when `after` comes later than `before` in the screen (never drawn under it). */
export function comesAfter(root: HostElement, before: string, after: string): boolean {
  const ids = testIdsInOrder(root);
  const a = ids.indexOf(before);
  const b = ids.indexOf(after);
  return a !== -1 && b !== -1 && b > a;
}
