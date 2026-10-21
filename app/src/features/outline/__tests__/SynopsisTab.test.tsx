// Synopsis tab: synopsis with save, generation → editable/deletable
// corkboard preview → confirmation = additive merge.

import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

import { FirebaseError } from 'firebase/app';

import { captureTestLog } from '../../../testing/testLog';
import { ThemeProvider } from '../../../theme';
import { uninstallTestLog } from '../../testLog';
import { InMemoryBookRepository } from '../../books';
import { InMemoryChapterRepository } from '../../chapters';
import { InMemoryOutlineDraftRepository, LocalOutlineDraftRepository } from '../drafts';
import { InMemoryOutlineService } from '../inMemory';
import { isThinSynopsis, SynopsisTab } from '../SynopsisTab';
import type { OutlineCard } from '../types';

const CARDS: OutlineCard[] = [
  { title: 'La gola chiusa', summary: 'Riassunto uno.', beats: ['beat 1a', 'beat 1b'] },
  { title: 'Il patto', summary: 'Riassunto due.', beats: ['beat 2a'] },
];

function setup(options?: {
  cards?: OutlineCard[];
  seedChapters?: boolean;
  drafts?: InMemoryOutlineDraftRepository;
  synopsis?: string;
  styleProfileId?: string | null;
}) {
  const books = new InMemoryBookRepository();
  const book = books.seed({
    id: 'mulino',
    title: 'Il mulino di Rocca Bassa',
    synopsis: options?.synopsis ?? 'Le arnie di un mulino e un patto antico.',
    styleProfileId: options?.styleProfileId ?? null,
  });
  const chapters = new InMemoryChapterRepository();
  if (options?.seedChapters === true) {
    chapters.seed({ bookId: 'mulino', chapterId: 'scritto-1' }, 'Testo già dettato.', {
      title: 'Il ritorno',
      order: 0,
    });
    chapters.seed({ bookId: 'mulino', chapterId: 'vuoto-1' }, '', {
      title: 'Segnaposto',
      order: 1,
    });
  }
  const outlineService = new InMemoryOutlineService(options?.cards ?? CARDS);
  const drafts = options?.drafts ?? new InMemoryOutlineDraftRepository();
  const result = render(
    <ThemeProvider>
      <SynopsisTab
        book={book}
        bookRepository={books}
        chapterRepository={chapters}
        outlineService={outlineService}
        outlineDrafts={drafts}
      />
    </ThemeProvider>,
  );
  return { result, books, chapters, outlineService, drafts };
}

async function chaptersOf(repo: InMemoryChapterRepository) {
  return new Promise<Awaited<ReturnType<InMemoryChapterRepository['getChapter']>>[]>((resolve) => {
    repo.observeChapters('mulino', (summaries) => {
      void Promise.all(
        summaries.map((s) => repo.getChapter({ bookId: 'mulino', chapterId: s.id })),
      ).then(resolve);
    });
  });
}

describe('SynopsisTab', () => {
  it('does not show the development-key warning with the default provider', async () => {
    const { result } = setup();
    const screen = await result;
    await screen.findByTestId('synopsis-tab');
    expect(screen.queryByTestId('synopsis-freekey-warning')).toBeNull();
    await screen.unmount();
  });

  it('shows the book synopsis and saves it after editing', async () => {
    const { result, books } = setup();
    const screen = await result;

    expect(await screen.findByTestId('synopsis-input')).toHaveProp(
      'value',
      'Le arnie di un mulino e un patto antico.',
    );
    await fireEvent.changeText(screen.getByTestId('synopsis-input'), 'Trama di prova nuova.');
    await fireEvent.press(screen.getByTestId('synopsis-save'));

    await waitFor(async () => {
      const saved = await books.getBook('mulino');
      expect(saved?.synopsis).toBe('Trama di prova nuova.');
    });
    expect(await screen.findByTestId('synopsis-saved')).toBeOnTheScreen();
    await screen.unmount();
  });

  it('generates the outline and shows the card preview (title and beats)', async () => {
    const { result, outlineService } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));

    const card = await screen.findByTestId('outline-card-0');
    expect(card).toHaveTextContent(/La gola chiusa/);
    expect(card).toHaveTextContent(/beat 1a/);
    expect(screen.getByTestId('outline-card-1')).toHaveTextContent(/Il patto/);
    // the synopsis sent is the field's one, with an idempotency requestId
    expect(outlineService.requests[0]).toMatchObject({
      bookId: 'mulino',
      synopsis: 'Le arnie di un mulino e un patto antico.',
    });
    expect(outlineService.requests[0]?.requestId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    await screen.unmount();
  });

  it('cards can be deleted and edited before confirmation', async () => {
    const { result } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await screen.findByTestId('outline-card-0');

    // delete the second card
    await fireEvent.press(screen.getByTestId('outline-card-delete-1'));
    expect(screen.queryByTestId('outline-card-1')).toBeNull();

    // edit the first: title and beats (one per line, empty lines discarded)
    await fireEvent.press(screen.getByTestId('outline-card-edit-0'));
    await fireEvent.changeText(screen.getByTestId('outline-edit-title'), 'La gola chiusa, rivista');
    await fireEvent.changeText(
      screen.getByTestId('outline-edit-beats'),
      'beat nuovo 1\n\n  beat nuovo 2  ',
    );
    await fireEvent.press(screen.getByTestId('outline-edit-save'));

    const card = await screen.findByTestId('outline-card-0');
    expect(card).toHaveTextContent(/La gola chiusa, rivista/);
    expect(card).toHaveTextContent(/beat nuovo 1/);
    expect(card).toHaveTextContent(/beat nuovo 2/);
    await screen.unmount();
  });

  it('confirmation on a book without chapters: creates all draft chapters with outline', async () => {
    const { result, chapters } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await fireEvent.press(await screen.findByTestId('outline-confirm'));

    await waitFor(async () => {
      const all = await chaptersOf(chapters);
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({
        title: 'La gola chiusa',
        status: 'draft',
        rawText: '',
        outline: { summary: 'Riassunto uno.', beats: ['beat 1a', 'beat 1b'] },
      });
      expect(all[1]).toMatchObject({ title: 'Il patto', status: 'draft' });
    });
    // the preview closes and the outcome is visible
    expect(screen.queryByTestId('outline-card-0')).toBeNull();
    expect(await screen.findByTestId('synopsis-status')).toHaveTextContent(/2 capitoli nuovi/);
    await screen.unmount();
  });

  it('additive merge: the written chapter stays intact, the empty slot is filled, the rest goes at the end', async () => {
    const { result, chapters } = setup({ seedChapters: true });
    const screen = await result;

    expect(await screen.findByTestId('synopsis-merge-note')).toHaveTextContent(/intoccat/);

    await fireEvent.press(screen.getByTestId('synopsis-generate'));
    await fireEvent.press(await screen.findByTestId('outline-confirm'));

    await waitFor(async () => {
      const all = await chaptersOf(chapters);
      expect(all).toHaveLength(3);
      // the chapter with text was NOT touched
      expect(all[0]).toMatchObject({
        title: 'Il ritorno',
        rawText: 'Testo già dettato.',
        outline: null,
      });
      // the empty slot took the title and outline of the first card
      expect(all[1]).toMatchObject({
        title: 'La gola chiusa',
        rawText: '',
        outline: { summary: 'Riassunto uno.', beats: ['beat 1a', 'beat 1b'] },
      });
      // the second card is a new chapter at the end
      expect(all[2]).toMatchObject({ title: 'Il patto', status: 'draft' });
    });
    expect(await screen.findByTestId('synopsis-status')).toHaveTextContent(
      /1 capitolo vuoto riempito, 1 capitolo nuovo/,
    );
    await screen.unmount();
  });

  it('a callable error becomes a plain message with Retry, never the raw text', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, outlineService } = setup();
    outlineService.nextError = new FirebaseError(
      'functions/internal',
      'The model did not produce a valid outline: chapters.0.title. Try again.',
    );
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    const status = await screen.findByTestId('synopsis-status');
    expect(status).toHaveTextContent('La scaletta non è arrivata. Riprova tra poco.');
    expect(status).not.toHaveTextContent(/model/);
    // no preview on error
    expect(screen.queryByTestId('outline-card-0')).toBeNull();

    await fireEvent.press(screen.getByTestId('synopsis-retry'));
    expect(await screen.findByTestId('outline-card-0')).toBeOnTheScreen();
    expect(outlineService.requests).toHaveLength(2);
    jest.restoreAllMocks();
    await screen.unmount();
  });

  it('the preview survives leaving the tab: cards and edits come back, no new generation', async () => {
    const drafts = new InMemoryOutlineDraftRepository();
    const first = setup({ drafts });
    const screen = await first.result;
    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await screen.findByTestId('outline-card-0');
    await fireEvent.press(screen.getByTestId('outline-card-delete-1'));
    await fireEvent.press(screen.getByTestId('outline-card-edit-0'));
    await fireEvent.changeText(screen.getByTestId('outline-edit-title'), 'La gola, rivista');
    await fireEvent.press(screen.getByTestId('outline-edit-save'));
    await waitFor(async () =>
      expect((await drafts.load('mulino'))?.[0]?.title).toBe('La gola, rivista'),
    );
    await screen.unmount(); // leaving the Synopsis tab unmounts it

    const again = setup({ drafts });
    const back = await again.result;
    const card = await back.findByTestId('outline-card-0');
    expect(card).toHaveTextContent(/La gola, rivista/);
    expect(back.queryByTestId('outline-card-1')).toBeNull();
    expect(back.getByTestId('outline-confirm')).toHaveTextContent(/Crea 1 capitolo/);
    expect(again.outlineService.requests).toHaveLength(0);
    await back.unmount();
  });

  it('confirming or discarding the proposal clears the saved draft', async () => {
    const drafts = new InMemoryOutlineDraftRepository();
    const confirmed = await setup({ drafts }).result;
    await fireEvent.press(await confirmed.findByTestId('synopsis-generate'));
    await fireEvent.press(await confirmed.findByTestId('outline-confirm'));
    await waitFor(async () => expect(await drafts.load('mulino')).toBeNull());
    await confirmed.unmount();

    const discarded = await setup({ drafts }).result;
    await fireEvent.press(await discarded.findByTestId('synopsis-generate'));
    await discarded.findByTestId('outline-card-0');
    await waitFor(async () => expect(await drafts.load('mulino')).not.toBeNull());
    await fireEvent.press(discarded.getByTestId('outline-cancel'));
    await waitFor(async () => expect(await drafts.load('mulino')).toBeNull());
    await discarded.unmount();
  });

  it('"Crea N capitoli" is always reachable: a bar at the bottom, outside the scrolling cards', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      title: `Capitolo ${i + 1}`,
      summary: `Riassunto ${i + 1}.`,
      beats: ['un beat'],
    }));
    const screen = await setup({ cards: many }).result;
    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await screen.findByTestId('outline-card-11');
    const bar = screen.getByTestId('outline-confirm-bar');
    expect(within(bar).getByTestId('outline-confirm')).toHaveTextContent(/Crea 12 capitoli/);
    // the bar is not inside the scroll view: it never scrolls away
    expect(within(screen.getByTestId('synopsis-tab')).queryByTestId('outline-confirm')).toBeNull();
    await screen.unmount();
  });
});

describe('SynopsisTab and the book style', () => {
  it.each(['mystery', 'thriller'] as const)(
    'the outline is asked in the style of the book (%s)',
    async (style) => {
      const { result, outlineService } = setup({ styleProfileId: style });
      const screen = await result;
      await fireEvent.press(await screen.findByTestId('synopsis-generate'));
      await screen.findByTestId('outline-card-0');
      expect(outlineService.requests[0]).toMatchObject({ styleId: style });
      await screen.unmount();
    },
  );

  it('a book with no style chosen asks for the default one', async () => {
    const { result, outlineService } = setup();
    const screen = await result;
    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await screen.findByTestId('outline-card-0');
    expect(outlineService.requests[0]).toMatchObject({ styleId: 'suspense' });
    await screen.unmount();
  });

  it('a one-line synopsis gets a short hint: a few lines more give a better outline', async () => {
    const screen = await setup({ synopsis: 'Un mulino e un patto antico.' }).result;
    expect(await screen.findByTestId('synopsis-thin-hint')).toHaveTextContent(
      /Scrivi qualche riga in più/,
    );
    await screen.unmount();
  });

  it('no hint for a synopsis of a few lines, nor for an empty one', async () => {
    const full = await setup({
      synopsis:
        'Viola rileva le arnie di un mulino abbandonato.\nNei quaderni trova sciami mai tornati.\nLa valle nasconde un patto.',
    }).result;
    await full.findByTestId('synopsis-input');
    expect(full.queryByTestId('synopsis-thin-hint')).toBeNull();
    await full.unmount();
    const empty = await setup({ synopsis: '' }).result;
    await empty.findByTestId('synopsis-input');
    expect(empty.queryByTestId('synopsis-thin-hint')).toBeNull();
    await empty.unmount();
  });
});

describe('isThinSynopsis', () => {
  it('one short line is thin; several lines or a long paragraph are not', () => {
    expect(isThinSynopsis('Un mulino e un patto antico.')).toBe(true);
    expect(isThinSynopsis('Riga uno.\nRiga due.\nRiga tre.')).toBe(false);
    expect(isThinSynopsis(Array.from({ length: 40 }, () => 'parola').join(' '))).toBe(false);
    expect(isThinSynopsis('   ')).toBe(false);
  });
});

describe('LocalOutlineDraftRepository', () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      data,
      storage: {
        getItem: async (key: string) => data.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          data.set(key, value);
        },
      },
    };
  }

  it('keeps one draft per book, and clears it', async () => {
    const { storage } = memoryStorage();
    const repo = new LocalOutlineDraftRepository(storage);
    await repo.save('mulino', CARDS);
    await repo.save('roggia', [CARDS[1] as OutlineCard]);
    expect(await repo.load('mulino')).toEqual(CARDS);
    expect(await repo.load('roggia')).toEqual([CARDS[1]]);
    await repo.clear('mulino');
    expect(await repo.load('mulino')).toBeNull();
    expect(await repo.load('roggia')).toEqual([CARDS[1]]);
  });

  it('a corrupt or foreign draft reads as no draft, never a crash', async () => {
    const { storage, data } = memoryStorage();
    const repo = new LocalOutlineDraftRepository(storage);
    await repo.save('mulino', CARDS);
    for (const key of data.keys()) data.set(key, '{not json');
    expect(await repo.load('mulino')).toBeNull();
    for (const key of data.keys()) data.set(key, JSON.stringify({ schemaVersion: 1, cards: [{}] }));
    expect(await repo.load('mulino')).toBeNull();
  });
});

describe('SynopsisTab and the dev test log', () => {
  afterEach(() => uninstallTestLog());

  it('records the outline request, its result and «Crea N capitoli»', async () => {
    const log = captureTestLog();
    const { result } = setup();
    const screen = await result;

    await fireEvent.press(await screen.findByTestId('synopsis-generate'));
    await fireEvent.press(await screen.findByTestId('outline-confirm'));
    await waitFor(() => expect(log.events('outline.confirm')).toHaveLength(1));

    expect(log.events('outline.request')[0]).toMatchObject({
      bookId: 'mulino',
      synopsisChars: 'Le arnie di un mulino e un patto antico.'.length,
      styleId: 'suspense',
    });
    expect(log.events('outline.result')[0]).toMatchObject({
      bookId: 'mulino',
      chapters: 2,
      titles: ['La gola chiusa', 'Il patto'],
    });
    expect(log.events('outline.confirm')[0]).toMatchObject({
      bookId: 'mulino',
      cards: 2,
      created: 2,
      ok: true,
    });
    await screen.unmount();
  });
});
