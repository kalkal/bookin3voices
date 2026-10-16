// Test di componente della schermata Taccuino con il FakeDictationEngine e il
// repository in memoria: lista cronologica, filtro per tag, empty state, FAB e
// cattura vocale (comandi vocali → testo, "Salva idea" → createNote).

import { act, fireEvent, render } from '@testing-library/react-native';

import { FakeDictationEngine } from '../../dictation';
import { InMemoryNoteRepository } from '../InMemoryNoteRepository';
import { NotesScreen } from '../NotesScreen';
import { ThemeProvider } from '../../../theme';

const BOOK = 'libro-test';

/** Orologio monotono per un ordine deterministico dei seed. */
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
        bookTitle="Il custode del faro"
        noteRepository={repository}
        engine={engine}
        onBack={onBack}
      />
    </ThemeProvider>,
  );
  await act(async () => {});
  return { engine, repository, onBack, ...utils };
}

describe('NotesScreen — apertura e lista', () => {
  it('mostra eyebrow del libro, "Taccuino" e le note (più recenti in cima)', async () => {
    const { getByText, getAllByText } = await renderScreen({
      seed: (repo) => {
        repo.seed(BOOK, { text: 'La più vecchia', tag: 'trama' });
        repo.seed(BOOK, { text: 'La più recente', tag: 'dialogo' });
      },
    });
    // eyebrow = titolo del libro (maiuscolo solo via stile), poi "Taccuino"
    expect(getByText('Il custode del faro')).toBeTruthy();
    expect(getByText('Taccuino')).toBeTruthy();
    expect(getByText('La più recente')).toBeTruthy();
    expect(getByText('La più vecchia')).toBeTruthy();
    // il tag della nota compare come chip di categoria
    expect(getAllByText('Trama').length).toBeGreaterThan(0);
  });

  it('taccuino vuoto: empty state invita a dettare il primo spunto', async () => {
    const { getByText } = await renderScreen();
    expect(getByText('Il taccuino è vuoto')).toBeTruthy();
  });
});

describe('NotesScreen — filtro per tag', () => {
  it('un chip filtra le note; "Tutte" le riporta tutte', async () => {
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

  it('filtro senza risultati: empty state dedicato', async () => {
    const { getByTestId, getByText } = await renderScreen({
      seed: (repo) => repo.seed(BOOK, { text: 'Solo trama', tag: 'trama' }),
    });
    await fireEvent.press(getByTestId('notes-filter-atmosfera'));
    expect(getByText('Nessuna idea con questo tag')).toBeTruthy();
  });
});

describe('NotesScreen — cattura vocale', () => {
  it('il FAB apre la cattura; i comandi vocali diventano testo e "Salva idea" crea la nota', async () => {
    const { engine, repository, getByTestId, getByText, queryByTestId } = await renderScreen();

    // il pannello è chiuso finché non si tocca il FAB
    expect(queryByTestId('note-capture-modal')).toBeNull();
    await fireEvent.press(getByTestId('notes-fab'));
    expect(getByTestId('note-capture-modal')).toBeTruthy();

    // dettatura: mic → start, un finale con comando vocale "punto"
    await fireEvent.press(getByTestId('note-capture-mic'));
    expect(engine.startCalls).toEqual([{ lang: 'it-IT' }]);
    await act(async () => engine.emitPartial('e se il faro'));
    expect(getByTestId('note-capture-partial')).toHaveTextContent('e se il faro');
    await act(async () => engine.emitFinal('e se il faro fosse la prigione punto'));
    expect(getByTestId('note-capture-text').props.value).toBe('E se il faro fosse la prigione.');

    // tag opzionale + salvataggio
    await fireEvent.press(getByTestId('note-capture-tag-trama'));
    await fireEvent.press(getByTestId('note-capture-save'));

    const saved = await repository.getNote({ bookId: BOOK, noteId: 'nota-1' });
    expect(saved).toMatchObject({ text: 'E se il faro fosse la prigione.', tag: 'trama' });
    // salvata: il pannello si chiude e la nota compare in lista
    expect(queryByTestId('note-capture-modal')).toBeNull();
    expect(getByText('E se il faro fosse la prigione.')).toBeTruthy();
  });

  it('"Salva idea" è disabilitato finché non c’è testo', async () => {
    const { engine, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('notes-fab'));
    expect(getByTestId('note-capture-save')).toBeDisabled();
    await fireEvent.press(getByTestId('note-capture-mic'));
    await act(async () => engine.emitFinal('un pensiero'));
    expect(getByTestId('note-capture-save')).not.toBeDisabled();
  });

  it('testo scritto a mano: la nota si salva anche senza dettatura', async () => {
    const { repository, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('notes-fab'));
    await fireEvent.changeText(getByTestId('note-capture-text'), '  Idea scritta a mano  ');
    await fireEvent.press(getByTestId('note-capture-save'));
    expect(await repository.getNote({ bookId: BOOK, noteId: 'nota-1' })).toMatchObject({
      text: 'Idea scritta a mano',
      tag: null,
    });
  });

  it('alla chiusura della schermata il motore viene rilasciato', async () => {
    const { engine, unmount } = await renderScreen();
    await unmount();
    expect(engine.disposed).toBe(true);
  });

  it('chiudendo il pannello (salva) il motore viene fermato: niente microfono acceso in background', async () => {
    const { engine, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('notes-fab'));
    // avvio dell'ascolto: il microfono è acceso
    await fireEvent.press(getByTestId('note-capture-mic'));
    expect(engine.startCalls).toHaveLength(1);
    const stopsPrima = engine.stopCalls;

    // salvataggio: il pannello si chiude (visible=false) senza smontare
    await fireEvent.changeText(getByTestId('note-capture-text'), 'un pensiero');
    await fireEvent.press(getByTestId('note-capture-save'));

    // il motore DEVE essere stato fermato alla chiusura
    expect(engine.stopCalls).toBeGreaterThan(stopsPrima);
  });

  it('chiudendo il pannello (annulla) il motore viene fermato', async () => {
    const { engine, getByTestId } = await renderScreen();
    await fireEvent.press(getByTestId('notes-fab'));
    await fireEvent.press(getByTestId('note-capture-mic'));
    const stopsPrima = engine.stopCalls;
    await fireEvent.press(getByTestId('note-capture-cancel'));
    expect(engine.stopCalls).toBeGreaterThan(stopsPrima);
  });
});

describe('NotesScreen — errore del listener', () => {
  it('se observeNotes fallisce mostra un avviso invece della schermata muta', async () => {
    const engine = new FakeDictationEngine();
    // repository che fallisce la sottoscrizione (listener in errore)
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
          bookTitle="Il custode del faro"
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

describe('NotesScreen — modifica ed elimina', () => {
  it('elimina una nota dopo la conferma (chiama deleteNote)', async () => {
    const { repository, getByTestId, queryByText } = await renderScreen({
      seed: (repo) => repo.seed(BOOK, { text: 'Idea da buttare', tag: 'idea' }),
    });
    const deleteSpy = jest.spyOn(repository, 'deleteNote');
    const note = await repository.getNote({ bookId: BOOK, noteId: 'nota-1' });
    expect(note).not.toBeNull();

    // apertura delle azioni sulla nota (press lungo, come il riordino capitoli)
    await fireEvent(getByTestId('note-nota-1'), 'longPress');
    await fireEvent.press(getByTestId('note-actions-delete'));
    // conferma leggera
    await fireEvent.press(getByTestId('note-actions-delete-confirm'));

    expect(deleteSpy).toHaveBeenCalledWith({ bookId: BOOK, noteId: 'nota-1' });
    expect(queryByText('Idea da buttare')).toBeNull();
  });

  it('modifica una nota esistente: precompila e chiama updateNote coi campi giusti', async () => {
    const { repository, getByTestId } = await renderScreen({
      seed: (repo) => repo.seed(BOOK, { text: 'Bozza', tag: null }),
    });
    const updateSpy = jest.spyOn(repository, 'updateNote');

    await fireEvent(getByTestId('note-nota-1'), 'longPress');
    await fireEvent.press(getByTestId('note-actions-edit'));
    // l'editor riusa il pannello di cattura, precompilato col testo esistente
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
