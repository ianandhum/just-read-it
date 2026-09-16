import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../lib/types';
import { createReaderGuided, type ReaderGuidedContext } from '../../../lib/web/reader/guided';
import type { ReadingSession } from '../../../lib/reading/state';

function createSession(): ReadingSession {
  let currentId: number | null = null;
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
    setWordFocusAt: () => {},
    setProgress: () => {},
    nextUnreadAfter: (id) => (id === 0 ? 1 : null),
    getSnapshot: () => ({ total: 2, currentId, readIds: new Set<number>() }),
    getStats: () => ({ total: 2, readCount: 0, currentId, unreadMs: 0 }),
    getSpeechTiming: () => ({ durationMs: 0, positionMs: 0 }),
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

function setup(overrides: Partial<ReaderGuidedContext> = {}) {
  const session = createSession();
  const speech = { readingAloud: false };
  const settings = { ...DEFAULT_SETTINGS, guidedReading: true, guidedAdvanceDelay: 500 };
  const context: ReaderGuidedContext = {
    getSession: () => session,
    getSettings: () => settings,
    getInteraction: () => null,
    getSpeech: () => speech as never,
    isTornDown: () => false,
    getLightsOutEnabled: () => true,
    setLightsOutEnabled: () => {},
    getNormalLightsOutEnabled: () => false,
    setNormalLightsOutEnabled: () => {},
    setGuidedSetting: (enabled) => {
      settings.guidedReading = enabled;
    },
    setBodyModes: () => {},
    updateControls: () => {},
    updateProgress: vi.fn(),
    scheduleSave: vi.fn(),
    scrollCurrentIntoView: vi.fn(),
    updateWakeLock: async () => {},
    ...overrides,
  };
  return { session, speech, settings, context, guided: createReaderGuided(context) };
}

describe('createReaderGuided', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('continues to the next sentence after resuming during the sentence delay', () => {
    vi.useFakeTimers();
    const { session, guided } = setup();

    guided.scheduleGuidedAdvance(0);
    guided.pause();
    vi.advanceTimersByTime(1000);
    expect(session.getCurrentId()).toBeNull();
    guided.resume();
    vi.advanceTimersByTime(500);

    expect(session.getCurrentId()).toBe(1);
    guided.teardown();
  });

  it.each([false, true])('does not override manual navigation during a delay (paused: %s)', (pause) => {
    vi.useFakeTimers();
    const { session, guided, context } = setup();
    guided.scheduleGuidedAdvance(0);
    if (pause) guided.pause();
    session.setCurrent(5);
    if (pause) guided.resume();
    vi.advanceTimersByTime(500);

    expect(session.getCurrentId()).toBe(5);
    expect(session.setCurrent).toHaveBeenCalledTimes(1);
    expect(context.scheduleSave).not.toHaveBeenCalled();
    expect(context.scrollCurrentIntoView).not.toHaveBeenCalled();
    guided.teardown();
  });

  it.each([false, true])('discards a delay when the session is replaced (paused: %s)', (pause) => {
    vi.useFakeTimers();
    let session = createSession();
    const original = session;
    const { guided } = setup({ getSession: () => session });
    guided.scheduleGuidedAdvance(0);
    if (pause) guided.pause();
    session = createSession();
    if (pause) guided.resume();
    vi.advanceTimersByTime(500);

    expect(original.setCurrent).not.toHaveBeenCalled();
    expect(session.setCurrent).not.toHaveBeenCalled();
    guided.teardown();
  });

  it.each([false, true])('does not advance when speech starts during a delay (paused: %s)', (pause) => {
    vi.useFakeTimers();
    const { session, speech, guided } = setup();
    guided.scheduleGuidedAdvance(0);
    if (pause) guided.pause();
    speech.readingAloud = true;
    if (pause) guided.resume();
    vi.advanceTimersByTime(500);

    expect(session.setCurrent).not.toHaveBeenCalled();
    speech.readingAloud = false;
    guided.pause();
    guided.resume();
    vi.advanceTimersByTime(500);
    expect(session.setCurrent).not.toHaveBeenCalled();
    guided.teardown();
  });

  it('waits for resume when an advance is scheduled while paused', () => {
    vi.useFakeTimers();
    const { session, guided } = setup();
    guided.pause();
    guided.scheduleGuidedAdvance(0);
    vi.advanceTimersByTime(500);
    expect(session.setCurrent).not.toHaveBeenCalled();
    guided.resume();
    vi.advanceTimersByTime(500);
    expect(session.getCurrentId()).toBe(1);
    guided.teardown();
  });

  it('does not schedule a transition while speech is already active', () => {
    vi.useFakeTimers();
    const { session, speech, guided } = setup();
    speech.readingAloud = true;
    guided.scheduleGuidedAdvance(0);
    speech.readingAloud = false;
    vi.advanceTimersByTime(500);
    expect(session.setCurrent).not.toHaveBeenCalled();
    guided.teardown();
  });

  it('cancels pending transitions on teardown', () => {
    vi.useFakeTimers();
    const { session, guided } = setup();
    guided.scheduleGuidedAdvance(0);
    guided.teardown();
    vi.advanceTimersByTime(500);
    expect(session.setCurrent).not.toHaveBeenCalled();
  });

  it('preserves the pending transition while guided mode is disabled', () => {
    vi.useFakeTimers();
    const { session, settings, guided } = setup();
    guided.scheduleGuidedAdvance(0);
    settings.guidedReading = false;
    vi.advanceTimersByTime(500);
    expect(session.setCurrent).not.toHaveBeenCalled();
    guided.setGuided(true);
    vi.advanceTimersByTime(500);
    expect(session.getCurrentId()).toBe(1);
    guided.teardown();
  });

  it('refreshes completion without selecting a sentence at the end', () => {
    vi.useFakeTimers();
    const { session, guided, context } = setup();
    guided.scheduleGuidedAdvance(1);
    vi.advanceTimersByTime(500);
    expect(session.setCurrent).not.toHaveBeenCalled();
    expect(context.updateProgress).toHaveBeenCalledTimes(1);
    guided.teardown();
  });
});
