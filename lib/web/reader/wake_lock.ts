export interface WakeLockContext {
  shouldHold(): boolean;
  isTornDown(): boolean;
}

export interface ReaderWakeLock {
  update(): Promise<void>;
  release(): Promise<void>;
}

export function createReaderWakeLock(context: WakeLockContext): ReaderWakeLock {
  let wakeLock: WakeLockSentinel | null = null;
  let request: Promise<void> | null = null;
  let generation = 0;
  let retryAfterRequest = false;

  async function update(): Promise<void> {
    if (!context.shouldHold()) {
      generation++;
      retryAfterRequest = false;
      if (wakeLock) {
        await wakeLock.release().catch(() => {});
        wakeLock = null;
      }
      return;
    }
    if (wakeLock || document.visibilityState !== 'visible') return;
    if (request) {
      // A request made for an earlier mode can resolve stale. Retry once it
      // settles so a rapid off/on transition still acquires a new lock.
      retryAfterRequest = true;
      return;
    }
    if (!('wakeLock' in navigator)) return;

    const currentGeneration = generation;
    const currentRequest = navigator.wakeLock
      .request('screen')
      .then(async (sentinel) => {
        if (currentGeneration !== generation || context.isTornDown()) {
          await sentinel.release().catch(() => {});
          return;
        }
        wakeLock = sentinel;
        sentinel.addEventListener('release', () => {
          if (wakeLock === sentinel) wakeLock = null;
          // An explicit release increments generation; do not reacquire from
          // its corresponding release event.
          if (currentGeneration !== generation) return;
          if (!context.isTornDown() && context.shouldHold()) void update();
        });
        if (currentGeneration !== generation || context.isTornDown() || !context.shouldHold()) {
          await sentinel.release().catch(() => {});
          wakeLock = null;
        }
      })
      .catch((err) => {
        // Wake locks are optional and can be denied by the browser or OS.
        console.log('[Just Read It] wakelock request denied:', err);
      })
      .finally(() => {
        if (request !== currentRequest) return;
        request = null;
        if (!retryAfterRequest) return;
        retryAfterRequest = false;
        void update();
      });
    request = currentRequest;
    await currentRequest;
  }

  return {
    update,
    async release() {
      generation++;
      retryAfterRequest = false;
      const current = wakeLock;
      wakeLock = null;
      await current?.release().catch(() => {});
    },
  };
}
