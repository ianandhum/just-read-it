import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReaderWakeLock } from '../../../lib/web/reader/wake_lock';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('reader wake lock', () => {
  let shouldHold = true;
  let requests: ReturnType<typeof deferred<WakeLockSentinel>>[];

  beforeEach(() => {
    requests = [];
    vi.stubGlobal('navigator', {
      wakeLock: {
        request: vi.fn(() => {
          const pending = deferred<WakeLockSentinel>();
          requests.push(pending);
          return pending.promise;
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries after a pending request becomes stale during a rapid off/on transition', async () => {
    const lock = createReaderWakeLock({ shouldHold: () => shouldHold, isTornDown: () => false });
    const staleRelease = vi.fn(async () => {});

    const initialUpdate = lock.update();
    shouldHold = false;
    await lock.update();
    shouldHold = true;
    await lock.update();

    requests[0]!.resolve({ release: staleRelease, addEventListener: vi.fn() } as unknown as WakeLockSentinel);
    await initialUpdate;
    await Promise.resolve();

    expect(staleRelease).toHaveBeenCalledOnce();
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('does not reacquire when it explicitly releases a sentinel', async () => {
    const lock = createReaderWakeLock({ shouldHold: () => shouldHold, isTornDown: () => false });
    let onRelease: (() => void) | undefined;
    const sentinel = {
      release: vi.fn(async () => {
        onRelease?.();
      }),
      addEventListener: vi.fn((_type: string, listener: () => void) => {
        onRelease = listener;
      }),
    } as unknown as WakeLockSentinel;

    const update = lock.update();
    requests[0]!.resolve(sentinel);
    await update;
    await lock.release();

    expect(sentinel.release).toHaveBeenCalledOnce();
    expect(navigator.wakeLock.request).toHaveBeenCalledOnce();
  });
});
