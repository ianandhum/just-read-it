import { savePageState } from '../../storage';
import type { PageState } from '../../types';

export interface ReaderPersistenceContext {
  enabled(): boolean;
  isTornDown(): boolean;
  pageState(): PageState | null;
}

export interface ReaderPersistence {
  schedule(): void;
  flush(): void;
  queue(state: PageState): Promise<void>;
  wait(): Promise<void>;
  clearTimer(): void;
}

export function createReaderPersistence(context: ReaderPersistenceContext, debounceMs: number): ReaderPersistence {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain = Promise.resolve();

  const queue = (state: PageState): Promise<void> => {
    chain = chain
      .catch(() => {})
      .then(() => savePageState(state))
      .catch((err) => {
        console.error('[Just Read It] save failed', err);
      });
    return chain;
  };

  return {
    schedule() {
      if (!context.enabled()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        timer = null;
        if (context.isTornDown()) return;
        const state = context.pageState();
        if (state) await queue(state);
      }, debounceMs);
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!context.enabled()) return;
      const state = context.pageState();
      if (state) void queue(state);
    },
    queue,
    wait() {
      return chain;
    },
    clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
