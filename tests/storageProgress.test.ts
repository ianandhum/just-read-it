import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportData,
  importData,
  listenTimeByDay,
  loadFontScale,
  loadPerSiteSettings,
  loadSettings,
  readingTimeByDay,
  savePerSiteSettings,
  saveSettings,
  saveContentCandidate,
  loadContentCandidate,
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
  it.each([
    { readRanges: [null] },
    { readRanges: [[0]] },
    { readRanges: [[-1, 1]] },
    { readRanges: [[0, 0]] },
    { readRanges: [[0, 1.5]] },
    {
      readRanges: [
        [0, 3],
        [2, 1],
      ],
    },
    { readRanges: [[3, 2]] },
    { total: 1_000_000_000 },
    { total: -1 },
    { currentId: 4 },
    { updatedAt: Infinity },
    { title: 42 },
    { timeSpentMs: -1 },
    { dailyTimeSpentMs: { '2026-09-01': 'invalid' } },
    { url: 'javascript:alert(1)' },
  ])('rejects malformed progress without changing existing history: %j', async (patch) => {
    await expect(importData({ version: 1, pageStates: [{ ...states[0], ...patch }], settings: DEFAULT_SETTINGS })).rejects.toThrow(
      'invalid reading progress',
    );
    expect(browser.storage.local.remove).not.toHaveBeenCalled();
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.sync.set).not.toHaveBeenCalled();
  });

  it('accepts valid existing backups', async () => {
    await expect(importData({ version: 1, pageStates: states, settings: DEFAULT_SETTINGS })).resolves.toBeUndefined();
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      'jri:https://example.com/complete': states[0],
      'jri:https://example.com/started': states[1],
    });
  });
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

describe('sync write fallback', () => {
  it('keeps failed sync writes authoritative and clears fallback after recovery', async () => {
    const local: Record<string, unknown> = {};
    const sync: Record<string, unknown> = {};
    const area = (data: Record<string, unknown>) => ({
      get: vi.fn(async () => ({ ...data })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(data, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
      }),
    });
    const localArea = area(local);
    const syncArea = area(sync);
    vi.stubGlobal('browser', { storage: { local: localArea, sync: syncArea } });
    await saveSettings({ rate: 1 });
    syncArea.set.mockRejectedValueOnce(new Error('write quota'));
    await saveSettings({ rate: 2 });
    expect((await loadSettings()).rate).toBe(2);
    expect(sync['jri:settings']).toMatchObject({ rate: 1 });
    expect(local['jri:pending-sync:jri:settings']).toBe(true);

    await saveSettings({ fontScale: 1.5 });
    expect(sync['jri:settings']).toMatchObject({ rate: 2, fontScale: 1.5 });
    expect(local).toEqual({});
    sync['jri:settings'] = { ...DEFAULT_SETTINGS, rate: 3 };
    expect((await loadSettings()).rate).toBe(3);

    await saveContentCandidate('https://example.com', 'tag:article');
    syncArea.set.mockRejectedValueOnce(new Error('write quota'));
    await saveContentCandidate('https://example.com', 'tag:main');
    expect(await loadContentCandidate('https://example.com')).toBe('tag:main');
  });
});

describe('per-domain font scale', () => {
  it('loads and saves a clamped font scale by hostname', async () => {
    const get = browser.storage.sync.get as unknown as { mockResolvedValueOnce(value: Record<string, unknown>): void };
    get.mockResolvedValueOnce({ 'jri:per-site-settings:example.com': { fontScale: 2.25 } });
    expect(await loadFontScale('https://example.com/article')).toBe(2.25);

    await savePerSiteSettings('https://example.com/other', { fontScale: 8 });
    expect(browser.storage.sync.set).toHaveBeenCalledWith({ 'jri:per-site-settings:example.com': { fontScale: 5 } });
  });

  it('returns null for an invalid saved scale', async () => {
    const get = browser.storage.sync.get as unknown as { mockResolvedValueOnce(value: Record<string, unknown>): void };
    get.mockResolvedValueOnce({ 'jri:per-site-settings:example.com': { fontScale: 'large' } });
    get.mockResolvedValueOnce({ 'jri:font-scale:example.com': 'large' });
    expect(await loadFontScale('https://example.com/article')).toBeNull();
  });

  it('uses the global font scale as the default for sites without an override', async () => {
    const get = browser.storage.sync.get as unknown as { mockResolvedValueOnce(value: Record<string, unknown>): void };
    get.mockResolvedValueOnce({ 'jri:settings': { ...DEFAULT_SETTINGS, fontScale: 1.8 } });
    expect((await loadSettings()).fontScale).toBe(1.8);
  });

  it('loads the per-site settings object and falls back when it is absent', async () => {
    const get = browser.storage.sync.get as unknown as { mockResolvedValueOnce(value: Record<string, unknown>): void };
    get.mockResolvedValueOnce({ 'jri:per-site-settings:example.com': { fontScale: 2.25 } });
    expect(await loadPerSiteSettings('https://example.com/article')).toEqual({ fontScale: 2.25 });

    get.mockResolvedValueOnce({});
    get.mockResolvedValueOnce({});
    get.mockResolvedValueOnce({ 'jri:settings': { ...DEFAULT_SETTINGS, fontScale: 1.8 } });
    const siteSettings = await loadPerSiteSettings('https://example.com/article');
    expect(siteSettings?.fontScale ?? (await loadSettings()).fontScale).toBe(1.8);
  });
});
