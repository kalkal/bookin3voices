import { waitForPendingWrites, type Firestore } from 'firebase/firestore';

import { SYNC_WAIT_MS, waitForSyncedWrites } from '../syncBarrier';

jest.mock('firebase/firestore', () => ({ waitForPendingWrites: jest.fn() }));

const mockedWait = waitForPendingWrites as jest.MockedFunction<typeof waitForPendingWrites>;
const db = {} as Firestore;

describe('waitForSyncedWrites', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    mockedWait.mockReset();
  });

  it('resolves true as soon as the pending writes are acknowledged', async () => {
    mockedWait.mockResolvedValue(undefined);
    await expect(waitForSyncedWrites(db)).resolves.toBe(true);
    expect(mockedWait).toHaveBeenCalledWith(db);
  });

  it('resolves false after the timeout when the writes never settle (offline)', async () => {
    mockedWait.mockReturnValue(new Promise<void>(() => {}));
    const result = waitForSyncedWrites(db);
    await jest.advanceTimersByTimeAsync(SYNC_WAIT_MS - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
  });
});
