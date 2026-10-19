import { act, render } from '@testing-library/react-native';

import { ThemeProvider } from '../../../theme';
import type { BookRepository } from '../../books';
import { InMemoryChapterRepository } from '../../chapters';
import { DictationRoute } from '../DictationRoute';
import { FakeDictationEngine } from '../engines/FakeDictationEngine';

const checks = {
  isRecognitionAvailable: () => true,
  getPermissions: async () => ({ granted: true, canAskAgain: true }),
  requestPermissions: async () => ({ granted: true, canAskAgain: true }),
  getSupportedLocales: async () => ({ locales: [], installedLocales: [] }),
  platform: 'ios' as const,
};

function route(getBook: BookRepository['getBook']) {
  return (
    <ThemeProvider>
      <DictationRoute
        bookRepository={{ getBook } as BookRepository}
        chapter={{ bookId: 'b', chapterId: 'c' }}
        repository={new InMemoryChapterRepository()}
        engine={new FakeDictationEngine()}
        preflightChecks={checks}
      />
    </ThemeProvider>
  );
}

describe('DictationRoute — language of the book before the screen', () => {
  afterEach(() => jest.useRealTimers());

  it('uses the language of the book', async () => {
    const screen = await render(route(async () => ({ language: 'en' }) as never));
    await act(async () => {});
    expect(screen.getByText('«period»')).toBeOnTheScreen();
  });

  it('a book that cannot be read falls back to the interface language', async () => {
    const screen = await render(
      route(async () => {
        throw new Error('offline');
      }),
    );
    await act(async () => {});
    expect(screen.getByText('«punto»')).toBeOnTheScreen();
  });

  it('never stays blocked if the book never answers (offline, no cache)', async () => {
    jest.useFakeTimers();
    const screen = await render(route(() => new Promise(() => {})));
    expect(screen.getByTestId('dictation-loading')).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(2500);
    });
    expect(screen.getByTestId('dictation-screen')).toBeOnTheScreen();
    expect(screen.getByText('«punto»')).toBeOnTheScreen();
  });
});
