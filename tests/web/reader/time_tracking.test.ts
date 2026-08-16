import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTimeTracking, READING_IDLE_MS } from '../../../lib/web/reader/time_tracking';

describe('time tracking', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00'));
  });

  it('counts activity only until the reader becomes idle', () => {
    const tracking = createTimeTracking({ hasSession: () => true, isVisible: () => true });

    tracking.recordActivity();
    vi.advanceTimersByTime(READING_IDLE_MS + 30_000);

    expect(tracking.currentMs()).toBe(READING_IDLE_MS);
  });

  it('starts a new active interval after later activity', () => {
    const tracking = createTimeTracking({ hasSession: () => true, isVisible: () => true });

    tracking.recordActivity();
    vi.advanceTimersByTime(READING_IDLE_MS + 30_000);
    tracking.recordActivity();
    vi.advanceTimersByTime(10_000);

    expect(tracking.currentMs()).toBe(READING_IDLE_MS + 10_000);
  });

  it('tracks listening independently without an idle timeout', () => {
    const tracking = createTimeTracking({ hasSession: () => true, isVisible: () => false });

    tracking.startListening();
    vi.advanceTimersByTime(READING_IDLE_MS + 30_000);
    tracking.stopListening();

    expect(tracking.currentMs()).toBe(0);
    expect(tracking.currentListenMs()).toBe(READING_IDLE_MS + 30_000);
    expect(tracking.currentDailyListenMs()).toEqual({ '2026-08-08': READING_IDLE_MS + 30_000 });
  });

  it('restores listening totals and daily activity', () => {
    const tracking = createTimeTracking({ hasSession: () => true, isVisible: () => true });

    tracking.restore(10_000, { '2026-08-07': 10_000 }, 20_000, { '2026-08-07': 20_000 });

    expect(tracking.currentMs()).toBe(10_000);
    expect(tracking.currentListenMs()).toBe(20_000);
    expect(tracking.currentDailyListenMs()).toEqual({ '2026-08-07': 20_000 });
  });
});
