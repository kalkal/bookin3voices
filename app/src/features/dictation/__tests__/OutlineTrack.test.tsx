// Component test of the Dictation track: panel only if the chapter has an
// outline, tickable beats persisted on `outline.beatsDone`, and open/close via
// the chevron remembered across mounts (injected storage).

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { OutlineTrack, outlineTrackCollapsedKey } from '../OutlineTrack';
import type { OutlineTrackRepository } from '../OutlineTrack';
import { contrast } from '../../../theme/testing/contrast';
import { candlelightPalette, paperPalette } from '../../../theme/tokens';
import { InMemoryChapterRepository } from '../../chapters';
import type { ChapterOutline, KeyValueStorage } from '../../chapters';
import { ThemeProvider } from '../../../theme';

const CHAPTER = { bookId: 'libro-test', chapterId: 'cap-test' };

const OUTLINE: ChapterOutline = {
  summary: 'Nora scopre che qualcosa non torna.',
  beats: ['Nora trova la porta della cucina aperta', 'Il primo segno che qualcosa non torna'],
  beatsDone: [],
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: KeyValueStorage = {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
  };
  return { storage, data };
}

const KEY = outlineTrackCollapsedKey(CHAPTER);

async function renderTrack(options?: {
  outline?: ChapterOutline | null;
  storage?: KeyValueStorage;
  chapterLabel?: string;
  chapter?: typeof CHAPTER;
  repository?: OutlineTrackRepository;
}) {
  const chapter = options?.chapter ?? CHAPTER;
  const seeded = new InMemoryChapterRepository();
  if (options?.outline !== undefined) {
    seeded.seed(chapter, '', { outline: options.outline });
  }
  const repository = options?.repository ?? seeded;
  const utils = await render(
    <ThemeProvider>
      <OutlineTrack
        chapter={chapter}
        repository={repository}
        chapterLabel={options?.chapterLabel ?? 'Capitolo VII'}
        storage={options?.storage ?? memoryStorage().storage}
      />
    </ThemeProvider>,
  );
  // let the read of the remembered open/closed state finish
  await act(async () => {});
  return { repository: seeded, ...utils };
}

describe('OutlineTrack — when it appears', () => {
  it('chapter without outline: the panel does not exist', async () => {
    const { queryByTestId } = await renderTrack({ outline: null });
    expect(queryByTestId('outline-track')).toBeNull();
  });

  it('nonexistent chapter (never saved): the panel does not exist', async () => {
    const { queryByTestId } = await renderTrack();
    expect(queryByTestId('outline-track')).toBeNull();
  });

  it('outline with empty beats: the panel does not exist', async () => {
    const { queryByTestId } = await renderTrack({
      outline: { summary: 'Vuota.', beats: [], beatsDone: [] },
    });
    expect(queryByTestId('outline-track')).toBeNull();
  });

  it('chapter with outline: mockup label and all beats to cover', async () => {
    const { getByTestId } = await renderTrack({ outline: OUTLINE });
    expect(getByTestId('outline-track')).toHaveTextContent(/Traccia · Capitolo VII/);
    expect(getByTestId('outline-beat-0')).toHaveTextContent(
      'Nora trova la porta della cucina aperta',
    );
    expect(getByTestId('outline-beat-1')).toHaveTextContent(
      'Il primo segno che qualcosa non torna',
    );
    expect(getByTestId('outline-beat-0')).not.toBeChecked();
    expect(getByTestId('outline-beat-1')).not.toBeChecked();
  });
});

describe('OutlineTrack — ticked beats (visual only, persisted on the chapter)', () => {
  it('tap on a beat: ticked and saved in outline.beatsDone; second tap: to do', async () => {
    const { repository, getByTestId } = await renderTrack({ outline: OUTLINE });

    await fireEvent.press(getByTestId('outline-beat-1'));
    expect(getByTestId('outline-beat-1')).toBeChecked();
    expect(getByTestId('outline-beat-0')).not.toBeChecked();
    await act(async () => {});
    expect((await repository.getChapter(CHAPTER))?.outline).toEqual({
      ...OUTLINE,
      beatsDone: [1],
    });

    await fireEvent.press(getByTestId('outline-beat-1'));
    expect(getByTestId('outline-beat-1')).not.toBeChecked();
    await act(async () => {});
    expect((await repository.getChapter(CHAPTER))?.outline).toEqual(OUTLINE);
  });

  it('beats already ticked on the chapter start ticked', async () => {
    const { getByTestId } = await renderTrack({ outline: { ...OUTLINE, beatsDone: [0] } });
    expect(getByTestId('outline-beat-0')).toBeChecked();
    expect(getByTestId('outline-beat-1')).not.toBeChecked();
  });
});

describe('OutlineTrack — remembered open/close, never lost', () => {
  it('closed via chevron: the header stays with the count and the next beat; the choice is saved', async () => {
    const { storage, data } = memoryStorage();
    const { getByTestId, queryByTestId } = await renderTrack({ outline: OUTLINE, storage });

    await fireEvent.press(getByTestId('outline-track-toggle'));
    expect(queryByTestId('outline-beat-0')).toBeNull();
    expect(getByTestId('outline-track')).toHaveTextContent(/Traccia · Capitolo VII/);
    // closed is never empty: how many key beats, and the next one to cover
    expect(getByTestId('outline-track')).toHaveTextContent(/0 su 2/);
    expect(getByTestId('outline-next-beat')).toHaveTextContent(
      /Nora trova la porta della cucina aperta/,
    );
    await act(async () => {});
    expect(data.get(KEY)).toBe('1');

    await fireEvent.press(getByTestId('outline-track-toggle'));
    expect(getByTestId('outline-beat-0')).toBeTruthy();
    await act(async () => {});
    expect(data.get(KEY)).toBe('0');
  });

  it('on the next mount the same chapter restarts as it was left (closed, header and next beat)', async () => {
    const { storage } = memoryStorage({ [KEY]: '1' });
    const { getByTestId, queryByTestId } = await renderTrack({ outline: OUTLINE, storage });
    expect(queryByTestId('outline-beat-0')).toBeNull();
    expect(getByTestId('outline-next-beat')).toBeTruthy();
  });

  it('the choice is per chapter: closing one chapter does not close another', async () => {
    const { storage } = memoryStorage({ [KEY]: '1' });
    const other = { bookId: 'libro-test', chapterId: 'cap-altro' };
    const { getByTestId } = await renderTrack({ outline: OUTLINE, storage, chapter: other });
    expect(getByTestId('outline-beat-0')).toBeTruthy();
  });

  it('the old app-wide "closed" preference no longer hides the beats', async () => {
    const { storage } = memoryStorage({ 'bookvoice/dettatura/traccia-chiusa': '1' });
    const { getByTestId } = await renderTrack({ outline: OUTLINE, storage });
    expect(getByTestId('outline-beat-1')).toBeTruthy();
  });

  it('every beat covered: the closed header says so instead of going blank', async () => {
    const { storage } = memoryStorage({ [KEY]: '1' });
    const { getByTestId, queryByTestId } = await renderTrack({
      outline: { ...OUTLINE, beatsDone: [0, 1] },
      storage,
    });
    expect(getByTestId('outline-track')).toHaveTextContent(/2 su 2/);
    expect(queryByTestId('outline-next-beat')).toBeNull();
  });

  it('a chapter snapshot that cannot be read does not wipe the beats already on screen', async () => {
    let emit: (
      chapter: Parameters<Parameters<OutlineTrackRepository['observeChapter']>[1]>[0],
    ) => void = () => {};
    const repository: OutlineTrackRepository = {
      observeChapter: (_ref, onChange) => {
        emit = onChange;
        return () => {};
      },
      updateChapter: async () => {},
    };
    const { getByTestId } = await renderTrack({ repository });
    await act(async () => {
      emit({
        ...CHAPTER,
        id: CHAPTER.chapterId,
        schemaVersion: 1,
        order: 0,
        title: 'Capitolo',
        status: 'draft',
        wordCount: 0,
        rawText: '',
        outline: OUTLINE,
        updatedAt: 1,
      });
    });
    expect(getByTestId('outline-beat-0')).toBeTruthy();
    // while dictating, a snapshot can come back unreadable (null) for a moment
    await act(async () => {
      emit(null);
    });
    expect(getByTestId('outline-beat-0')).toBeTruthy();
  });

  it('unreadable storage: starts open without errors', async () => {
    const storage: KeyValueStorage = {
      getItem: async () => {
        throw new Error('storage broken');
      },
      setItem: async () => {
        throw new Error('storage broken');
      },
    };
    const { getByTestId } = await renderTrack({ outline: OUTLINE, storage });
    expect(getByTestId('outline-beat-0')).toBeTruthy();
    // saving the choice also fails silently
    await fireEvent.press(getByTestId('outline-track-toggle'));
    await act(async () => {});
    expect(getByTestId('outline-track')).toBeTruthy();
  });

  it('without a chapter label the panel says just "Traccia"', async () => {
    const { getByTestId } = await renderTrack({ outline: OUTLINE, chapterLabel: '' });
    expect(getByTestId('outline-track')).toHaveTextContent(/Traccia/);
    expect(getByTestId('outline-track')).not.toHaveTextContent(/Traccia ·/);
  });
});

// The panel is a Card (surface). Worst case for the label and the beats: the surface itself.
describe('OutlineTrack — readable in both themes (AA, 4.5:1)', () => {
  it.each([
    ['black and gold', candlelightPalette],
    ['cream', paperPalette],
  ] as const)('%s: label, beats to cover and covered beats keep 4.5:1', (_name, palette) => {
    for (const token of ['primary', 'text', 'textMutedStrong'] as const) {
      expect(contrast(palette[token], palette.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ['candlelight', candlelightPalette],
    ['paper', paperPalette],
  ] as const)('%s: every text the panel draws is AA on its card', async (mode, palette) => {
    const repository = new InMemoryChapterRepository();
    repository.seed(CHAPTER, '', { outline: { ...OUTLINE, beatsDone: [0] } });
    const screen = await render(
      <ThemeProvider initialMode={mode}>
        <OutlineTrack
          chapter={CHAPTER}
          repository={repository}
          chapterLabel="Capitolo VII"
          storage={memoryStorage().storage}
        />
      </ThemeProvider>,
    );
    await act(async () => {});
    const texts = screen.getByTestId('outline-track').queryAll((node) => node.type === 'Text');
    expect(texts.length).toBeGreaterThan(0);
    for (const node of texts) {
      const color = StyleSheet.flatten(node.props.style)?.color as string;
      expect([color, contrast(color, palette.surface) >= 4.5]).toEqual([color, true]);
    }
    await screen.unmount();
  });
});
