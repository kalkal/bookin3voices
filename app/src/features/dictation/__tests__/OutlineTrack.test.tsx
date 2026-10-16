// Test di componente della traccia in Dettatura: pannello solo se
// il capitolo ha un outline, beat spuntabili persistiti su `outline.beatsDone`,
// apri/chiudi col chevron ricordato tra i montaggi (storage iniettato).

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
  // lascia concludere la lettura dello stato apri/chiuso ricordato
  await act(async () => {});
  return { repository, ...utils };
}

describe('OutlineTrack — quando compare', () => {
  it('capitolo senza outline: il pannello non esiste', async () => {
    const { queryByTestId } = await renderTrack({ outline: null });
    expect(queryByTestId('outline-track')).toBeNull();
  });

  it('capitolo inesistente (mai salvato): il pannello non esiste', async () => {
    const { queryByTestId } = await renderTrack();
    expect(queryByTestId('outline-track')).toBeNull();
  });

  it('outline con beat vuoti: il pannello non esiste', async () => {
    const { queryByTestId } = await renderTrack({
      outline: { summary: 'Vuota.', beats: [], beatsDone: [] },
    });
    expect(queryByTestId('outline-track')).toBeNull();
  });

  it('capitolo con outline: etichetta del mockup e tutti i beat da coprire', async () => {
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

describe('OutlineTrack — beat spuntati (solo visuale, persistiti sul capitolo)', () => {
  it('tocco su un beat: spuntato e salvato in outline.beatsDone; secondo tocco: da fare', async () => {
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

  it('i beat già spuntati sul capitolo partono spuntati', async () => {
    const { getByTestId } = await renderTrack({ outline: { ...OUTLINE, beatsDone: [0] } });
    expect(getByTestId('outline-beat-0')).toBeChecked();
    expect(getByTestId('outline-beat-1')).not.toBeChecked();
  });
});

describe('OutlineTrack — apri/chiudi ricordato', () => {
  it('chiuso col chevron: restano etichetta e toggle, i beat spariscono, la scelta si salva', async () => {
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

  it('al montaggio successivo riparte com’era rimasto (chiuso)', async () => {
    const { storage } = memoryStorage({ [OUTLINE_TRACK_COLLAPSED_KEY]: '1' });
    const { getByTestId, queryByTestId } = await renderTrack({ outline: OUTLINE, storage });
    expect(getByTestId('outline-track')).toBeTruthy();
    expect(queryByTestId('outline-beat-0')).toBeNull();
  });

  it('storage illeggibile: si parte aperti senza errori', async () => {
    const storage: KeyValueStorage = {
      getItem: async () => {
        throw new Error('storage rotto');
      },
      setItem: async () => {
        throw new Error('storage rotto');
      },
    };
    const { getByTestId } = await renderTrack({ outline: OUTLINE, storage });
    expect(getByTestId('outline-beat-0')).toBeTruthy();
    // anche il salvataggio della scelta fallisce in silenzio
    await fireEvent.press(getByTestId('outline-track-toggle'));
    await act(async () => {});
    expect(getByTestId('outline-track')).toBeTruthy();
  });

  it('senza etichetta capitolo il pannello dice solo "Traccia"', async () => {
    const { getByTestId } = await renderTrack({ outline: OUTLINE, chapterLabel: '' });
    expect(getByTestId('outline-track')).toHaveTextContent(/Traccia/);
    expect(getByTestId('outline-track')).not.toHaveTextContent(/Traccia ·/);
  });
});
