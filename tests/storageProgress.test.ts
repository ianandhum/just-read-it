import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportData,
  importData,
  listenTimeByDay,
  loadFontScale,
  loadSettings,
  readingTimeByDay,
  saveFontScale,
  summarizeReadingProgress,
} from '../lib/storage';
import { DEFAULT_SETTINGS, type PageState } from '../lib/types';

const states: PageState[] = [
  { url: 'https://example.com/complete', total: 4, readRanges: [[0, 4]], currentId: null, updatedAt: 2, timeSpentMs: 60_000 },
  {
    url: 'https://example.com/started',
    total: 6,
    readRanges: [
      [0, 1],
      [2, 1],
    ],
    currentId: 3,
    updatedAt: 1,
    timeSpentMs: 30_000,
  },
];

beforeEach(() => {
  vi.stubGlobal('browser', {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() },
      sync: {
        get: vi.fn<(key?: string) => Promise<Record<string, unknown>>>(async () => ({})),
        set: vi.fn(),
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('summarizeReadingProgress', () => {
  it('derives aggregate progress from saved page state', () => {
    expect(summarizeReadingProgress(states)).toEqual({
      pagesTracked: 2,
      pagesCompleted: 1,
      pagesInProgress: 1,
      sentencesRead: 6,
      sentencesTotal: 10,
      timeSpentMs: 90_000,
      completionPercent: 60,
    });
  });

  it('returns zeroes when no reading progress is saved', () => {
    expect(summarizeReadingProgress([])).toEqual({
      pagesTracked: 0,
      pagesCompleted: 0,
      pagesInProgress: 0,
      sentencesRead: 0,
      sentencesTotal: 0,
      timeSpentMs: 0,
      completionPercent: 0,
    });
  });

  it('does not count duplicate or stale read IDs beyond the page total', () => {
    const state = states[0]!;
    expect(summarizeReadingProgress([{ ...state, readRanges: [[0, 5]] }]).sentencesRead).toBe(4);
  });

  it('aggregates saved daily reading time into a 30-day series', () => {
    const daily = readingTimeByDay([{ ...states[0]!, dailyTimeSpentMs: { '2026-08-05': 60_000 } }], 2, new Date('2026-08-05T12:00:00'));
    expect(daily).toEqual([
      { date: '2026-08-04', timeSpentMs: 0 },
      { date: '2026-08-05', timeSpentMs: 60_000 },
    ]);
  });

  it('aggregates listening time separately from reading time', () => {
    const daily = listenTimeByDay(
      [{ ...states[0]!, dailyListenTimeSpentMs: { '2026-08-05': 90_000 } }],
      2,
      new Date('2026-08-05T12:00:00'),
    );
    expect(daily).toEqual([
      { date: '2026-08-04', timeSpentMs: 0 },
      { date: '2026-08-05', timeSpentMs: 90_000 },
    ]);
  });
});

describe('backup validation', () => {
  it('defaults completion celebrations to enabled for existing settings', async () => {
    const get = browser.storage.sync.get as ReturnType<typeof vi.fn>;
    get.mockResolvedValueOnce({ 'jri:settings': { ...DEFAULT_SETTINGS, completionCelebrationEnabled: undefined } });

    expect((await loadSettings()).completionCelebrationEnabled).toBe(true);
  });

  it('rejects backups with invalid page state or settings', async () => {
    await expect(importData({ version: 1, pageStates: [{ url: 'https://example.com' }], settings: DEFAULT_SETTINGS })).rejects.toThrow(
      'invalid reading progress',
    );
    await expect(importData({ version: 1, pageStates: [], settings: {} })).rejects.toThrow('valid Just Read It backup');
  });

  it('exports a versioned backup', async () => {
    const backup = await exportData();
    expect(backup).toMatchObject({ version: 1, pageStates: [], settings: DEFAULT_SETTINGS });
    expect(backup.exportedAt).toEqual(expect.any(String));
  });
});

describe('per-domain font scale', () => {
  it('loads and saves a clamped font scale by hostname', async () => {
    const get = browser.storage.sync.get as unknown as { mockResolvedValueOnce(value: Record<string, unknown>): void };
    get.mockResolvedValueOnce({ 'jri:font-scale:example.com': 2.25 });
    expect(await loadFontScale('https://example.com/article')).toBe(2.25);

    await saveFontScale('https://example.com/other', 8);
    expect(browser.storage.sync.set).toHaveBeenCalledWith({ 'jri:font-scale:example.com': 5 });
  });

  it('returns null for an invalid saved scale', async () => {
    const get = browser.storage.sync.get as unknown as { mockResolvedValueOnce(value: Record<string, unknown>): void };
    get.mockResolvedValueOnce({ 'jri:font-scale:example.com': 'large' });
    expect(await loadFontScale('https://example.com/article')).toBeNull();
  });

  it('uses the global font scale as the default for sites without an override', async () => {
    const get = browser.storage.sync.get as unknown as { mockResolvedValueOnce(value: Record<string, unknown>): void };
    get.mockResolvedValueOnce({ 'jri:settings': { ...DEFAULT_SETTINGS, fontScale: 1.8 } });
    expect((await loadSettings()).fontScale).toBe(1.8);
  });
});
