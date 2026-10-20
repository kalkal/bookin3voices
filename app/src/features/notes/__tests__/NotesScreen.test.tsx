// Component test of the Notebook screen with the FakeDictationEngine and the
// in-memory repository: chronological list, tag filter, empty state, FAB and
// voice capture (voice commands → text, "Salva idea" → createNote).

import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FakeDictationEngine } from '../../dictation';
import { InMemoryNoteRepository } from '../InMemoryNoteRepository';
import { NotesScreen } from '../NotesScreen';
import { comesAfter, layoutRoom } from '../../../testing/arches';
import { ThemeProvider } from '../../../theme';

const BOOK = 'libro-test';

/** Monotonic clock for a deterministic order of the seeds. */
function tickingClock(start = 1000): () => number {
  let t = start;
  return () => (t += 1);
}

async function renderScreen(options?: { seed?: (repo: InMemoryNoteRepository) => void }) {
  const engine = new FakeDictationEngine();
  const repository = new InMemoryNoteRepository(tickingClock());
  options?.seed?.(repository);
  const onBack = jest.fn();
  const utils = await render(
    <ThemeProvider>
      <NotesScreen
        bookId={BOOK}
        bookTitle="Le arnie del mulino"
        noteRepository={repository}
        engine={engine}
        onBack={onBack}
      />
    </ThemeProvider>,
  );
  await act(async () => {});
  return { engine, repository, onBack, ...utils };
}

describe('NotesScreen — bottom button', () => {
  it('"Detta un\'idea" stays above the Android navigation bar, with room to spare', async () => {
    const screen = await render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 360, height: 780 },
          insets: { top: 24, left: 0, right: 0, bottom: 48 },
        }}
      >
        <ThemeProvider>
          <NotesScreen
            bookId={BOOK}
            bookTitle="Le arnie del mulino"
            noteRepository={new InMemoryNoteRepository(tickingClock())}
            engine={new FakeDictationEngine()}
            onBack={jest.fn()}
          />
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    await act(async () => {});
    const fab = StyleSheet.flatten(screen.getByTestId('notes-fab').props.style);
    expect(fab.bottom).toBeGreaterThanOrEqual(48 + 16);
    await screen.unmount();
  });
});

describe('NotesScreen — opening and list', () => {
  it('shows the book eyebrow, "Taccuino" and the notes (most recent first)', async () => {
    const { getByText, getAllByText } = await renderScreen({
      seed: (repo) => {
        repo.seed(BOOK, { text: 'La più vecchia', tag: 'trama' });
        repo.seed(BOOK, { text: 'La più recente', tag: 'dialogo' });
      },
    });
    // eyebrow = book title (uppercase only via style), then "Taccuino"
    expect(getByText('Le arnie del mulino')).toBeTruthy();
    expect(getByText('Taccuino')).toBeTruthy();
    expect(getByText('La più recente')).toBeTruthy();
    expect(getByText('La più vecchia')).toBeTruthy();
    // the note's tag appears as a category chip
    expect(getAllByText('Trama').length).toBeGreaterThan(0);
  });

  it('empty notebook: the empty state invites dictating the first idea', async () => {
    const { getByText } = await renderScreen();
    expect(getByText('Il taccuino è vuoto')).toBeTruthy();
  });

  it('the arches stand under the notes wherever there is room, never behind a card', async () => {
    const vuoto = await renderScreen();
    await layoutRoom(vuoto.getByTestId('arches-room'), 412, 300);
    expect(
      vuoto.getByTestId('cathedral-arches', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(comesAfter(vuoto.getByTestId('notes-screen'), 'notes-empty', 'arches-room')).toBe(true);
    await vuoto.unmount();
    const pieno = await renderScreen({
      seed: (repo) => repo.seed(BOOK, { text: 'Una nota', tag: 'trama' }),
    });
    const note = pieno.getByText('Una nota');
    await layoutRoom(pieno.getByTestId('arches-room'), 412, 300);
    expect(
      pieno.getByTestId('cathedral-arches', { includeHiddenElements: true }),
    ).toBeOnTheScreen();
    expect(note).toBeOnTheScreen();
    expect(comesAfter(pieno.getByTestId('notes-screen'), 'notes-filter-all', 'arches-room')).toBe(
      true,
    );
  });
});

describe('NotesScreen — tag filter', () => {
  it('a chip filters the notes; "Tutte" brings them all back', async () => {
    const { getByTestId, getByText, queryByText } = await renderScreen({
      seed: (repo) => {
        repo.seed(BOOK, { text: 'Nota di trama', tag: 'trama' });
        repo.seed(BOOK, { text: 'Nota di dialogo', tag: 'dialogo' });
      },
    });

    await fireEvent.press(getByTestId('notes-filter-trama'));
    expect(getByText('Nota di trama')).toBeTruthy();
    expect(queryByText('Nota di dialogo')).toBeNull();

    await fireEvent.press(getByTestId('notes-filter-all'));
    expect(getByText('Nota di dialogo')).toBeTruthy();
  });

  it('filter with no results: dedicated empty state', async () => {
    const { getByTestId, getByText } = await renderScreen({
      seed: (repo) => repo.seed(BOOK, { text: 'Solo trama', tag: 'trama' }),
    });
    await fireEvent.press(getByTestId('notes-filter-atmosfera'));
    expect(getByText('Nessuna idea con questo tag')).toBeTruthy();
  });
});

describe('NotesScreen — voice capture', () => {
  it('the FAB opens capture; voice commands become text and "Salva idea" creates the note', async () => {
    const { engine, repository, getByTestId, getByText, queryByTestId } = await renderScreen();

    // the panel is closed until the FAB is tapped
    expect(queryByTestId('note-capture-modal')).toBeNull();
    await fireEvent.press(getByTestId('notes-fab'));
    expect(getByTestId('note-capture-modal')).toBeTruthy();

    // dictation: mic → start, a final result with the voice command "punto"
    await fireEvent.press(getByTestId('note-capture-mic'));
    expect(engine.startCalls).toEqual([{ lang: 'it-IT' }]);
    await act(async () => engine.emitPartial('e se il mulino'));
    expect(getByTestId('note-capture-partial')).toHaveTextContent('e se il mulino');
    await act(async () => engine.emitFinal('e se il mulino fosse la prigione punto'));
    expect(getByTestId('note-capture-text').props.value).toBe('E se il mulino fosse la prigione.');

    // optional tag + saving
    await fireEvent.press(getByTestId('note-capture-tag-trama'));
    await fireEvent.press(getByTestId('note-capture-save'));

    const saved = await repository.getNote({ bookId: BOOK, noteId: 'nota-1' });
    expect(saved).toMatchObject({ text: 'E se il mulino fosse la prigione.', tag: 'trama' });
    // saved: the panel closes and the note appears in the list
    expect(queryByTestId('note-capture-modal')).toBeNull();
    expect(getByText('E se il mulino fosse la prigione.')).toBeTruthy();
  });

  it('"Salva idea" is disabled until there is text', async () => {
    const { engine, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('notes-fab'));
    expect(getByTestId('note-capture-save')).toBeDisabled();
    await fireEvent.press(getByTestId('note-capture-mic'));
    await act(async () => engine.emitFinal('un pensiero'));
    expect(getByTestId('note-capture-save')).not.toBeDisabled();
  });

  it('hand-typed text: the note saves even without dictation', async () => {
    const { repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('notes-fab'));
    await fireEvent.changeText(getByTestId('note-capture-text'), '  Idea scritta a mano  ');
    await fireEvent.press(getByTestId('note-capture-save'));
    expect(await repository.getNote({ bookId: BOOK, noteId: 'nota-1' })).toMatchObject({
      text: 'Idea scritta a mano',
      tag: null,
    });
  });

  it('when the screen closes the engine is released', async () => {
    const { engine, unmount } = await renderScreen();
    await unmount();
    expect(engine.disposed).toBe(true);
  });

  it('closing the panel (save) stops the engine: no microphone left on in the background', async () => {
    const { engine, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('notes-fab'));
    // listening starts: the microphone is on
    await fireEvent.press(getByTestId('note-capture-mic'));
    expect(engine.startCalls).toHaveLength(1);
    const stopsPrima = engine.stopCalls;

    // saving: the panel closes (visible=false) without unmounting
    await fireEvent.changeText(getByTestId('note-capture-text'), 'un pensiero');
    await fireEvent.press(getByTestId('note-capture-save'));

    // the engine MUST have been stopped on close
    expect(engine.stopCalls).toBeGreaterThan(stopsPrima);
  });

  it('closing the panel (cancel) stops the engine', async () => {
    const { engine, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('notes-fab'));
    await fireEvent.press(getByTestId('note-capture-mic'));
    const stopsPrima = engine.stopCalls;
    await fireEvent.press(getByTestId('note-capture-cancel'));
    expect(engine.stopCalls).toBeGreaterThan(stopsPrima);
  });
});

describe('NotesScreen — listener error', () => {
  it('if observeNotes fails it shows a warning instead of a silent screen', async () => {
    const engine = new FakeDictationEngine();
    // repository whose subscription fails (listener in error)
    const failing = {
      observeNotes: (_bookId: string, _onChange: unknown, onError?: (e: Error) => void) => {
        onError?.(new Error('permessi'));
        return () => {};
      },
      getNote: jest.fn(),
      createNote: jest.fn(),
      updateNote: jest.fn(),
      deleteNote: jest.fn(),
    } as unknown as InMemoryNoteRepository;
    const utils = await render(
      <ThemeProvider>
        <NotesScreen
          bookId={BOOK}
          bookTitle="Le arnie del mulino"
          noteRepository={failing}
          engine={engine}
          onBack={jest.fn()}
        />
      </ThemeProvider>,
    );
    await act(async () => {});
    expect(utils.getByTestId('notes-error')).toBeTruthy();
  });
});

describe('NotesScreen — edit and delete', () => {
  it('deletes a note after confirmation (calls deleteNote)', async () => {
    const { repository, getByTestId, queryByText } = await renderScreen({
      seed: (repo) => repo.seed(BOOK, { text: 'Idea da buttare', tag: 'idea' }),
    });
    const deleteSpy = jest.spyOn(repository, 'deleteNote');
    const note = await repository.getNote({ bookId: BOOK, noteId: 'nota-1' });
    expect(note).not.toBeNull();

    // open the note's actions (long press, like chapter reordering)
    await fireEvent(getByTestId('note-nota-1'), 'longPress');
    await fireEvent.press(getByTestId('note-actions-delete'));
    // light confirmation
    await fireEvent.press(getByTestId('note-actions-delete-confirm'));

    expect(deleteSpy).toHaveBeenCalledWith({ bookId: BOOK, noteId: 'nota-1' });
    expect(queryByText('Idea da buttare')).toBeNull();
  });

  it('edits an existing note: pre-fills and calls updateNote with the right fields', async () => {
    const { repository, getByTestId } = await renderScreen({
      seed: (repo) => repo.seed(BOOK, { text: 'Bozza', tag: null }),
    });
    const updateSpy = jest.spyOn(repository, 'updateNote');

    await fireEvent(getByTestId('note-nota-1'), 'longPress');
    await fireEvent.press(getByTestId('note-actions-edit'));
    // the editor reuses the capture panel, pre-filled with the existing text
    expect(getByTestId('note-capture-text').props.value).toBe('Bozza');

    await fireEvent.changeText(getByTestId('note-capture-text'), 'Bozza rivista');
    await fireEvent.press(getByTestId('note-capture-tag-dubbio'));
    await fireEvent.press(getByTestId('note-capture-save'));

    expect(updateSpy).toHaveBeenCalledWith(
      { bookId: BOOK, noteId: 'nota-1' },
      { text: 'Bozza rivista', tag: 'dubbio' },
    );
  });
});
