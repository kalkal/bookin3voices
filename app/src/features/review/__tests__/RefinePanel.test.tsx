// The kind toggles are icons only: the first time the panel opens, their names
// show under them for a few seconds (then never again); a long press shows a
// name any time. Each toggle keeps an accessible name and state.

import { act, fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { ThemeProvider } from '../../../theme';
import { KINDS_SEEN_KEY, KIND_NAMES_MS, RefinePanel } from '../RefinePanel';
import { SUGGESTION_KINDS } from '../types';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
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

async function renderPanel(storage: ReturnType<typeof memoryStorage>['storage']) {
  const screen = await render(
    <ThemeProvider>
      <RefinePanel
        scope="chapter"
        kindsOn={SUGGESTION_KINDS}
        onToggle={() => {}}
        onStart={() => {}}
        onCancel={() => {}}
        storage={storage}
      />
    </ThemeProvider>,
  );
  await act(async () => {});
  return screen;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('RefinePanel — icon toggles', () => {
  it('each toggle is an icon with an accessible name and state, no visible text once seen', async () => {
    const { storage } = memoryStorage({ [KINDS_SEEN_KEY]: '1' });
    const screen = await renderPanel(storage);
    for (const kind of SUGGESTION_KINDS) {
      const toggle = screen.getByTestId(`refine-kind-${kind}`);
      expect(toggle).toHaveProp('accessibilityRole', 'switch');
      expect(toggle).toHaveProp('accessibilityState', { checked: true });
      expect(toggle.props.accessibilityLabel).toBeTruthy();
      expect(screen.getByTestId(`refine-kind-icon-${kind}`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`refine-kind-name-${kind}`)).toBeNull();
    }
    await screen.unmount();
  });

  it('the first time, the four names show under the icons, then fade and are remembered', async () => {
    const { storage, data } = memoryStorage();
    const screen = await renderPanel(storage);
    expect(screen.getByTestId('refine-kind-name-style')).toHaveTextContent('Stile');
    expect(screen.getByTestId('refine-kind-name-grammar')).toHaveTextContent('Grammatica');
    expect(screen.getByTestId('refine-kind-name-history')).toBeOnTheScreen();
    expect(data.get(KINDS_SEEN_KEY)).toBe('1');
    await act(async () => jest.advanceTimersByTime(KIND_NAMES_MS + 1000));
    expect(screen.queryByTestId('refine-kind-name-style')).toBeNull();
    await screen.unmount();
  });

  it('a long press shows that name for a moment', async () => {
    const { storage } = memoryStorage({ [KINDS_SEEN_KEY]: '1' });
    const screen = await renderPanel(storage);
    await fireEvent(screen.getByTestId('refine-kind-pacing'), 'longPress');
    expect(screen.getByTestId('refine-kind-name-pacing')).toHaveTextContent('Ritmo');
    expect(screen.queryByTestId('refine-kind-name-style')).toBeNull();
    await act(async () => jest.advanceTimersByTime(KIND_NAMES_MS + 1000));
    expect(screen.queryByTestId('refine-kind-name-pacing')).toBeNull();
    await screen.unmount();
  });

  it('an «off» kind is told by its shape too, not by colour alone (dashed border)', async () => {
    const { storage } = memoryStorage({ [KINDS_SEEN_KEY]: '1' });
    const screen = await render(
      <ThemeProvider>
        <RefinePanel
          scope="chapter"
          kindsOn={['grammar']}
          onToggle={() => {}}
          onStart={() => {}}
          onCancel={() => {}}
          storage={storage}
        />
      </ThemeProvider>,
    );
    await act(async () => {});
    const flat = (id: string) => {
      const style = screen.getByTestId(id).props.style;
      return Object.assign({}, ...(Array.isArray(style) ? style.flat() : [style]));
    };
    expect(flat('refine-kind-style')).toMatchObject({ borderStyle: 'dashed' });
    expect(flat('refine-kind-grammar')).toMatchObject({ borderStyle: 'solid' });
    await screen.unmount();
  });

  it('the scope chips have a 44 px touch target, like the kind toggles', async () => {
    const { storage } = memoryStorage({ [KINDS_SEEN_KEY]: '1' });
    const screen = await render(
      <ThemeProvider>
        <RefinePanel
          scope="paragraph"
          scopes={['paragraph', 'chapter']}
          onScope={() => {}}
          kindsOn={SUGGESTION_KINDS}
          onToggle={() => {}}
          onStart={() => {}}
          onCancel={() => {}}
          storage={storage}
        />
      </ThemeProvider>,
    );
    await act(async () => {});
    for (const id of ['refine-scope-paragraph', 'refine-scope-chapter']) {
      expect(screen.getByTestId(id).props.hitSlop).toMatchObject({ top: 8, bottom: 8 });
    }
    await screen.unmount();
  });

  it('closing the panel while the names show leaves no timer behind', async () => {
    const { storage } = memoryStorage();
    const screen = await renderPanel(storage);
    expect(screen.getByTestId('refine-kind-name-style')).toBeOnTheScreen();
    const timing = jest.spyOn(Animated, 'timing');
    await screen.unmount();
    // the fade of an unmounted panel must never run (it crashed later tests)
    await act(async () => jest.advanceTimersByTime(KIND_NAMES_MS * 3));
    expect(timing).not.toHaveBeenCalled();
    timing.mockRestore();
  });
});
