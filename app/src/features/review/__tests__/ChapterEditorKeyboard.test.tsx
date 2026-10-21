// Typing in the chapter editor with the keyboard open (Galaxy A53): the line
// with the caret must never end up under the keyboard. The field takes the
// room left above the keyboard and scrolls ITSELF (a native multiline input
// keeps its caret in view); it is never a growing box inside a ScrollView,
// which does not follow the caret.

import { act, fireEvent, render } from '@testing-library/react-native';
import { Keyboard, Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { KeyboardEvent } from 'react-native';

import { ThemeProvider } from '../../../theme';
import { InMemoryChapterRepository } from '../../chapters';
import { EDITOR_OUTLINE_MAX_WITH_KEYBOARD } from '../ChapterEditorScreen';
import { ChapterReviewFlow } from '../ChapterReviewFlow';
import { FakeSuggestionsProvider } from '../FakeSuggestionsProvider';
import { InMemoryRevisionRepository } from '../revisions';

const CHAPTER = { bookId: 'libro', chapterId: 'cap-1' };
const LONG_TEXT = Array.from({ length: 60 }, (_, i) => `Riga ${i + 1} del capitolo.`).join('\n');

type Listener = (event: KeyboardEvent) => void;

/** Captures the Keyboard listeners so the test can open and close the keyboard. */
function fakeKeyboard() {
  const listeners = new Map<string, Listener[]>();
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, listener: Listener) => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    return {
      remove: () =>
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((candidate) => candidate !== listener),
        ),
    };
  }) as unknown as typeof Keyboard.addListener);
  const emit = (name: string, height: number) =>
    (listeners.get(name) ?? []).forEach((listener) =>
      listener({
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { height, screenX: 0, screenY: 800 - height, width: 412 },
        startCoordinates: { height: 0, screenX: 0, screenY: 800, width: 412 },
        isEventFromThisApp: true,
      } as KeyboardEvent),
    );
  // iOS listens to the will* events, Android to the did* ones: send both
  return {
    show: (height: number) => {
      emit('keyboardWillShow', height);
      emit('keyboardDidShow', height);
    },
    hide: () => {
      emit('keyboardWillHide', 0);
      emit('keyboardDidHide', 0);
    },
  };
}

const MANY_BEATS = Array.from({ length: 8 }, (_, i) => `Passaggio chiave ${i + 1}`);

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

async function openEditing(navigationBar = 0) {
  const chapterRepository = new InMemoryChapterRepository();
  chapterRepository.seed(CHAPTER, LONG_TEXT, {
    outline: { summary: 'Il mulino.', beats: MANY_BEATS, beatsDone: [] },
  });
  const screen = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 412, height: 915 },
        insets: { top: 24, left: 0, right: 0, bottom: navigationBar },
      }}
    >
      <ThemeProvider>
        <ChapterReviewFlow
          chapter={CHAPTER}
          chapterTitle="I · Il mulino"
          chapterRepository={chapterRepository}
          revisionRepository={new InMemoryRevisionRepository()}
          provider={new FakeSuggestionsProvider()}
          outlineRepository={chapterRepository}
          outlineStateStorage={memoryStorage()}
        />
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await screen.findByTestId('editor-text-p0');
  await fireEvent.press(screen.getByTestId('editor-edit-toggle'));
  await screen.findByTestId('editor-input');
  return screen;
}

describe('chapter editor — the caret stays above the keyboard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('while editing, the field fills the room and scrolls itself (not inside a ScrollView)', async () => {
    const screen = await openEditing();
    const input = screen.getByTestId('editor-input');
    let ancestor = input.parent;
    while (ancestor !== null) {
      expect(ancestor.type).not.toBe('RCTScrollView');
      ancestor = ancestor.parent;
    }
    expect(StyleSheet.flatten(input.props.style)).toMatchObject({ flex: 1 });
    expect(input.props.scrollEnabled).not.toBe(false);
    await screen.unmount();
  });

  it('when the keyboard opens the editor makes room for it, and gives it back when it closes', async () => {
    const keyboard = fakeKeyboard();
    const screen = await openEditing();
    await act(async () => keyboard.show(310));
    expect(
      StyleSheet.flatten(screen.getByTestId('editor-keyboard-room').props.style),
    ).toMatchObject({ paddingBottom: 310 });
    await act(async () => keyboard.hide());
    expect(
      StyleSheet.flatten(screen.getByTestId('editor-keyboard-room').props.style),
    ).toMatchObject({ paddingBottom: 0 });
    await screen.unmount();
  });

  it('Android (edge-to-edge): the reported keyboard height leaves out the navigation bar, so it is added back', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const keyboard = fakeKeyboard();
    const screen = await openEditing(48);
    await act(async () => keyboard.show(310));
    expect(
      StyleSheet.flatten(screen.getByTestId('editor-keyboard-room').props.style),
    ).toMatchObject({ paddingBottom: 310 + 48 });
    await screen.unmount();
  });

  it('with the keyboard up, the open beats panel is capped and scrolls, so the text keeps its room', async () => {
    const keyboard = fakeKeyboard();
    const screen = await openEditing();
    expect(await screen.findByTestId('outline-beat-7')).toBeOnTheScreen();
    const panel = () => StyleSheet.flatten(screen.getByTestId('editor-outline-room').props.style);
    expect(panel().maxHeight).toBeUndefined();

    await act(async () => keyboard.show(310));
    expect(panel().maxHeight).toBe(EDITOR_OUTLINE_MAX_WITH_KEYBOARD);
    // every beat is still there, one scroll away
    expect(screen.getByTestId('outline-beat-7')).toBeOnTheScreen();

    await act(async () => keyboard.hide());
    expect(panel().maxHeight).toBeUndefined();
    await screen.unmount();
  });
});
