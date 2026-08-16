import { localDateKey } from '../../storage';

export interface TimeTrackingContext {
  hasSession(): boolean;
  isVisible(): boolean;
}

export interface TimeTracking {
  restore(timeMs: number, dailyMs: Record<string, number>, listenTimeMs: number, dailyListenMs: Record<string, number>): void;
  currentMs(): number;
  currentDailyMs(): Record<string, number>;
  currentListenMs(): number;
  currentDailyListenMs(): Record<string, number>;
  recordActivity(): void;
  startListening(): void;
  stopListening(): void;
  pause(): void;
  resume(): void;
}

export const READING_IDLE_MS = 60_000;

interface TimeAccumulator {
  totalMs: number;
  startedAt: number | null;
  dailyMs: Record<string, number>;
}

function commit(accumulator: TimeAccumulator, elapsedMs: number): void {
  if (elapsedMs > 0) {
    accumulator.totalMs += elapsedMs;
    const date = localDateKey();
    accumulator.dailyMs[date] = (accumulator.dailyMs[date] ?? 0) + elapsedMs;
  }
  accumulator.startedAt = null;
}

function currentDaily(accumulator: TimeAccumulator, elapsedMs: number): Record<string, number> {
  if (accumulator.startedAt === null) return accumulator.dailyMs;
  const date = localDateKey();
  return { ...accumulator.dailyMs, [date]: (accumulator.dailyMs[date] ?? 0) + elapsedMs };
}

export function createTimeTracking(context: TimeTrackingContext): TimeTracking {
  const reading: TimeAccumulator = { totalMs: 0, startedAt: null, dailyMs: {} };
  let lastActivityAt: number | null = null;
  const listening: TimeAccumulator = { totalMs: 0, startedAt: null, dailyMs: {} };

  function elapsed(now = Date.now()): number {
    if (reading.startedAt === null || lastActivityAt === null) return 0;
    return Math.max(0, Math.min(now, lastActivityAt + READING_IDLE_MS) - reading.startedAt);
  }

  function listeningElapsed(now = Date.now()): number {
    return listening.startedAt === null ? 0 : Math.max(0, now - listening.startedAt);
  }

  return {
    restore(timeMs, dailyMs, listenTimeMs, dailyListenMs) {
      reading.totalMs = timeMs;
      reading.dailyMs = { ...dailyMs };
      listening.totalMs = listenTimeMs;
      listening.dailyMs = { ...dailyListenMs };
    },
    currentMs() {
      return reading.totalMs + elapsed();
    },
    currentDailyMs() {
      return currentDaily(reading, elapsed());
    },
    currentListenMs() {
      return listening.totalMs + listeningElapsed();
    },
    currentDailyListenMs() {
      return currentDaily(listening, listeningElapsed());
    },
    recordActivity() {
      if (!context.hasSession() || !context.isVisible()) return;
      commit(reading, elapsed());
      reading.startedAt = Date.now();
      lastActivityAt = reading.startedAt;
    },
    startListening() {
      if (listening.startedAt !== null) return;
      listening.startedAt = Date.now();
    },
    stopListening() {
      commit(listening, listeningElapsed());
    },
    pause() {
      commit(reading, elapsed());
      lastActivityAt = null;
    },
    resume() {
      // Visibility alone is not reading activity. The next input starts timing.
    },
  };
}
