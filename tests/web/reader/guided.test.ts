import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../lib/types';
import { createReaderGuided } from '../../../lib/web/reader/guided';
import type { ReadingSession } from '../../../lib/reading/state';

function createSession(): ReadingSession {
  let currentId: number | null = 0;
  return {
    setCurrent: vi.fn((id) => {
      currentId = id;
    }),
    getCurrentId: () => currentId,
    getSpans: () => [],
    isRead: () => false,
    markRead: () => {},
    unmarkRead: () => {},
    moveNext: () => null,
    prev: () => null,
    nextWord: () => false,
    prevWord: () => false,
    setWordFocus: () => {},
    setProgress: () => {},
    nextUnreadAfter: (id) => (id === 0 ? 1 : null),
    getSnapshot: () => ({ total: 2, currentId, readIds: new Set<number>() }),
    getStats: () => ({ total: 2, readCount: 0, currentId, unreadMs: 0 }),
    getSpeechTiming: () => ({ durationMs: 0, positionMs: 0 }),
    getMaxProgress: () => 0,
    toPageState: () => ({ url: '', total: 2, readRanges: [], currentId, updatedAt: 0 }),
    dispose: () => {},
    destroy: () => {},
    setLightsOut: () => {},
    setLightsOutAsync: async () => {},
    setGuidedMode: () => {},
    isAnimating: () => false,
    markAllReadAsync: async () => {},
    markPreviousRead: () => {},
    advance: () => null,
    tick: () => ({ completed: false }),
  } satisfies ReadingSession;
}

describe('createReaderGuided', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('continues to the next sentence after resuming during the sentence delay', () => {
    vi.useFakeTimers();
    const session = createSession();
    const guided = createReaderGuided({
      getSession: () => session,
      getSettings: () => ({ ...DEFAULT_SETTINGS, guidedReading: true, guidedAdvanceDelay: 500 }),
      getInteraction: () => null,
      getSpeech: () => ({ readingAloud: false }) as never,
      isTornDown: () => false,
      getLightsOutEnabled: () => true,
      setLightsOutEnabled: () => {},
      getNormalLightsOutEnabled: () => false,
      setNormalLightsOutEnabled: () => {},
      setGuidedSetting: () => {},
      setBodyModes: () => {},
      updateControls: () => {},
      updateProgress: () => {},
      scheduleSave: () => {},
      scrollCurrentIntoView: () => {},
      updateWakeLock: async () => {},
    });

    guided.scheduleGuidedAdvance(0);
    guided.pause();
    guided.resume();
    vi.advanceTimersByTime(500);

    expect(session.getCurrentId()).toBe(1);
  });
});
