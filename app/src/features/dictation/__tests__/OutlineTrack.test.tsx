// Component test of the Dictation track: panel only if the chapter has an
// outline, tickable beats persisted on `outline.beatsDone`, and open/close via
// the chevron remembered across mounts (injected storage).

import { act, fireEvent, render } from '@testing-library/react-native';

import { OutlineTrack, OUTLINE_TRACK_COLLAPSED_KEY } from '../OutlineTrack';
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

async function renderTrack(options?: {
  outline?: ChapterOutline | null;
  storage?: KeyValueStorage;
  chapterLabel?: string;
}) {
  const repository = new InMemoryChapterRepository();
  if (options?.outline !== undefined) {
    repository.seed(CHAPTER, '', { outline: options.outline });
  }
  const utils = await render(
    <ThemeProvider>
      <OutlineTrack
        chapter={CHAPTER}
        repository={repository}
        chapterLabel={options?.chapterLabel ?? 'Capitolo VII'}
        storage={options?.storage ?? memoryStorage().storage}
      />
    </ThemeProvider>,
  );
  // let the read of the remembered open/closed state finish
  await act(async () => {});
  return { repository, ...utils };
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

describe('OutlineTrack — remembered open/close', () => {
  it('closed via chevron: label and toggle remain, beats disappear, the choice is saved', async () => {
    const { storage, data } = memoryStorage();
    const { getByTestId, queryByTestId } = await renderTrack({ outline: OUTLINE, storage });

    await fireEvent.press(getByTestId('outline-track-toggle'));
    expect(queryByTestId('outline-beat-0')).toBeNull();
    expect(getByTestId('outline-track')).toHaveTextContent(/Traccia · Capitolo VII/);
    await act(async () => {});
    expect(data.get(OUTLINE_TRACK_COLLAPSED_KEY)).toBe('1');

    await fireEvent.press(getByTestId('outline-track-toggle'));
    expect(getByTestId('outline-beat-0')).toBeTruthy();
    await act(async () => {});
    expect(data.get(OUTLINE_TRACK_COLLAPSED_KEY)).toBe('0');
  });

  it('on the next mount it restarts as it was left (closed)', async () => {
    const { storage } = memoryStorage({ [OUTLINE_TRACK_COLLAPSED_KEY]: '1' });
    const { getByTestId, queryByTestId } = await renderTrack({ outline: OUTLINE, storage });
    expect(getByTestId('outline-track')).toBeTruthy();
    expect(queryByTestId('outline-beat-0')).toBeNull();
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
