import {
  DEFAULT_SETTINGS,
  type JriPerSiteSettings,
  type JriSettings,
  type PageState,
  type DailyReadingTime,
  type ReadingProgressSummary,
} from './types';
import { MAX_PROGRESS_SENTENCES, rangesToReadIds } from './progress_share';

const KEY_PREFIX = 'jri:';
const SETTINGS_KEY = 'jri:settings';
const CONTENT_CANDIDATE_PREFIX = 'jri:content-candidate:';
const PER_SITE_SETTINGS_PREFIX = 'jri:per-site-settings:';
const FONT_SCALE_PREFIX = 'jri:font-scale:';
const PENDING_SYNC_PREFIX = 'jri:pending-sync:';

export interface DataExport {
  version: 1;
  exportedAt: string;
  pageStates: PageState[];
  settings: JriSettings;
}

async function getSynced<T>(key: string): Promise<T | undefined> {
  const local = await browser.storage.local.get([key, `${PENDING_SYNC_PREFIX}${key}`]);
  // A failed sync write leaves the local copy authoritative until a later
  // successful write clears the marker, including across extension restarts.
  if (local[`${PENDING_SYNC_PREFIX}${key}`] === true) return local[key] as T | undefined;
  try {
    const result = await browser.storage.sync.get(key);
    if (result[key] !== undefined) return result[key] as T;
  } catch {
    // Some browser profiles can disable sync storage. Local storage remains the fallback.
  }
  return local[key] as T | undefined;
}

async function setSynced(key: string, value: unknown): Promise<void> {
  try {
    await browser.storage.sync.set({ [key]: value });
  } catch {
    await browser.storage.local.set({ [key]: value, [`${PENDING_SYNC_PREFIX}${key}`]: true });
    return;
  }
  await browser.storage.local.remove([key, `${PENDING_SYNC_PREFIX}${key}`]);
}

export function localDateKey(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function keyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${KEY_PREFIX}${u.href}`;
  } catch {
    return `${KEY_PREFIX}${url}`;
  }
}

function contentCandidateKey(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = 'unknown';
  }
  return `${CONTENT_CANDIDATE_PREFIX}${host}`;
}

function fontScaleKey(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = 'unknown';
  }
  return `${FONT_SCALE_PREFIX}${host}`;
}

function perSiteSettingsKey(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    host = 'unknown';
  }
  return `${PER_SITE_SETTINGS_PREFIX}${host}`;
}

export async function loadContentCandidate(url: string): Promise<string | null> {
  const key = contentCandidateKey(url);
  const value = await getSynced<string>(key);
  return typeof value === 'string' ? value : null;
}

export async function saveContentCandidate(url: string, candidateId: string): Promise<void> {
  await setSynced(contentCandidateKey(url), candidateId);
}

export async function loadPerSiteSettings(url: string): Promise<JriPerSiteSettings | null> {
  const value = await getSynced<unknown>(perSiteSettingsKey(url));
  if (value && typeof value === 'object') {
    const settings = value as JriPerSiteSettings;
    return typeof settings.fontScale === 'number' && Number.isFinite(settings.fontScale)
      ? { fontScale: Math.min(5, Math.max(0.5, settings.fontScale)) }
      : {};
  }

  // Read the original scalar format so existing site preferences survive the
  // move to a per-site settings object.
  const legacyFontScale = await getSynced<unknown>(fontScaleKey(url));
  return typeof legacyFontScale === 'number' && Number.isFinite(legacyFontScale)
    ? { fontScale: Math.min(5, Math.max(0.5, legacyFontScale)) }
    : null;
}

export async function savePerSiteSettings(url: string, patch: JriPerSiteSettings): Promise<void> {
  const current = (await loadPerSiteSettings(url)) ?? {};
  const next = { ...current, ...patch };
  if (next.fontScale !== undefined) next.fontScale = Math.min(5, Math.max(0.5, next.fontScale));
  await setSynced(perSiteSettingsKey(url), next);
}

export async function loadFontScale(url: string): Promise<number | null> {
  return (await loadPerSiteSettings(url))?.fontScale ?? null;
}

export async function saveFontScale(url: string, fontScale: number): Promise<void> {
  await savePerSiteSettings(url, { fontScale });
}

export async function loadPageState(url: string): Promise<PageState | null> {
  const key = keyFromUrl(url);
  const result = await browser.storage.local.get(key);
  return isPageState(result[key]) ? result[key] : null;
}

export async function savePageState(state: PageState): Promise<void> {
  const key = keyFromUrl(state.url);
  await browser.storage.local.set({ [key]: state });
}

export async function setPageStarred(url: string, starred: boolean): Promise<void> {
  const state = await loadPageState(url);
  if (state) await savePageState({ ...state, starred });
}

export async function clearPageState(url: string): Promise<void> {
  const key = keyFromUrl(url);
  await browser.storage.local.remove(key);
}

function isPageState(value: unknown): value is PageState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<PageState>;
  if (
    typeof state.url !== 'string' ||
    typeof state.total !== 'number' ||
    !Number.isSafeInteger(state.total) ||
    state.total < 0 ||
    state.total > MAX_PROGRESS_SENTENCES ||
    !Array.isArray(state.readRanges) ||
    !Number.isFinite(state.updatedAt) ||
    state.updatedAt! < 0 ||
    (state.currentId !== null && (!Number.isSafeInteger(state.currentId) || state.currentId! < 0 || state.currentId! >= state.total))
  )
    return false;
  try {
    if (!['http:', 'https:'].includes(new URL(state.url).protocol)) return false;
  } catch {
    return false;
  }
  let previousEnd = 0;
  for (const range of state.readRanges) {
    if (!Array.isArray(range) || range.length !== 2) return false;
    const [start, length] = range;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(length) ||
      start < previousEnd ||
      length < 1 ||
      start + length > state.total
    ) {
      return false;
    }
    previousEnd = start + length;
  }
  for (const key of ['title', 'faviconUrl', 'previewImageUrl'] as const) {
    if (state[key] !== undefined && typeof state[key] !== 'string') return false;
  }
  for (const key of ['timeSpentMs', 'listenTimeSpentMs', 'estimatedUnreadMs'] as const) {
    if (state[key] !== undefined && (!Number.isFinite(state[key]) || state[key]! < 0)) return false;
  }
  for (const key of ['dailyTimeSpentMs', 'dailyListenTimeSpentMs'] as const) {
    const daily = state[key];
    if (daily === undefined) continue;
    if (!daily || typeof daily !== 'object' || Array.isArray(daily)) return false;
    if (Object.entries(daily).some(([date, ms]) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(ms) || ms < 0)) return false;
  }
  return state.starred === undefined || typeof state.starred === 'boolean';
}

function isSettings(value: unknown): value is JriSettings {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<JriSettings> & { progressDashboardEnabled?: boolean };
  return (
    (typeof settings.readingHistoryEnabled === 'boolean' || typeof settings.progressDashboardEnabled === 'boolean') &&
    (settings.completionCelebrationEnabled === undefined || typeof settings.completionCelebrationEnabled === 'boolean') &&
    typeof settings.guidedReading === 'boolean' &&
    typeof settings.rsvpEnabled === 'boolean' &&
    typeof settings.ttsEnabled === 'boolean' &&
    (typeof settings.voiceURI === 'string' || settings.voiceURI === null) &&
    typeof settings.rate === 'number' &&
    typeof settings.guidedRate === 'number' &&
    typeof settings.guidedAdvanceDelay === 'number' &&
    typeof settings.guidedManualPause === 'number' &&
    typeof settings.mouseIdleDelay === 'number' &&
    (settings.dimOpacity === undefined || typeof settings.dimOpacity === 'number') &&
    (settings.fontScale === undefined || typeof settings.fontScale === 'number') &&
    (settings.currentHighlightColor === undefined || typeof settings.currentHighlightColor === 'string') &&
    (settings.readHighlightColor === undefined || typeof settings.readHighlightColor === 'string') &&
    (settings.darkCurrentHighlightColor === undefined || typeof settings.darkCurrentHighlightColor === 'string') &&
    (settings.darkReadHighlightColor === undefined || typeof settings.darkReadHighlightColor === 'string') &&
    (settings.currentWordBackgroundColor === undefined || typeof settings.currentWordBackgroundColor === 'string') &&
    (settings.darkCurrentWordBackgroundColor === undefined || typeof settings.darkCurrentWordBackgroundColor === 'string')
  );
}

export async function loadAllPageStates(): Promise<PageState[]> {
  const items = await browser.storage.local.get();
  const states: PageState[] = [];
  for (const [key, value] of Object.entries(items)) {
    if (!key.startsWith(KEY_PREFIX) || key === SETTINGS_KEY) continue;
    if (isPageState(value)) states.push(value);
  }
  return states.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function summarizeReadingProgress(states: PageState[]): ReadingProgressSummary {
  const sentencesRead = states.reduce(
    (total, state) => total + Math.min(rangesToReadIds(state.readRanges, state.total).length, state.total),
    0,
  );
  const sentencesTotal = states.reduce((total, state) => total + state.total, 0);
  const timeSpentMs = states.reduce((total, state) => total + (state.timeSpentMs ?? 0), 0);
  const pagesCompleted = states.filter(
    (state) => state.total > 0 && rangesToReadIds(state.readRanges, state.total).length >= state.total,
  ).length;
  return {
    pagesTracked: states.length,
    pagesCompleted,
    pagesInProgress: states.length - pagesCompleted,
    sentencesRead,
    sentencesTotal,
    timeSpentMs,
    completionPercent: sentencesTotal === 0 ? 0 : Math.floor((sentencesRead / sentencesTotal) * 100),
  };
}

function timeByDay(
  states: PageState[],
  dailyTime: (state: PageState) => Record<string, number> | undefined,
  days: number,
  now: Date,
): DailyReadingTime[] {
  const result: DailyReadingTime[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(cursor);
    day.setDate(day.getDate() - offset);
    const date = localDateKey(day);
    const timeSpentMs = states.reduce((total, state) => total + (dailyTime(state)?.[date] ?? 0), 0);
    result.push({ date, timeSpentMs });
  }
  return result;
}

export function readingTimeByDay(states: PageState[], days = 30, now = new Date()): DailyReadingTime[] {
  return timeByDay(states, (state) => state.dailyTimeSpentMs, days, now);
}

export function listenTimeByDay(states: PageState[], days = 30, now = new Date()): DailyReadingTime[] {
  return timeByDay(states, (state) => state.dailyListenTimeSpentMs, days, now);
}

export async function clearAllPageStates(): Promise<void> {
  const items = await browser.storage.local.get();
  const keys = Object.entries(items)
    .filter(([key, value]) => key.startsWith(KEY_PREFIX) && key !== SETTINGS_KEY && isPageState(value))
    .map(([key]) => key);
  if (keys.length > 0) await browser.storage.local.remove(keys);
}

export async function exportData(): Promise<DataExport> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    pageStates: await loadAllPageStates(),
    settings: await loadSettings(),
  };
}

export async function importData(value: unknown): Promise<void> {
  if (!value || typeof value !== 'object') throw new Error('The selected file is not a Just Read It backup.');
  const backup = value as Partial<DataExport>;
  if (backup.version !== 1 || !Array.isArray(backup.pageStates) || !isSettings(backup.settings)) {
    throw new Error('The selected file is not a valid Just Read It backup.');
  }
  if (!backup.pageStates.every(isPageState)) throw new Error('The backup contains invalid reading progress.');

  await clearAllPageStates();
  if (backup.pageStates.length > 0) {
    await browser.storage.local.set(Object.fromEntries(backup.pageStates.map((state) => [keyFromUrl(state.url), state])));
  }
  const legacySettings = backup.settings as JriSettings & { progressDashboardEnabled?: boolean };
  const settings = { ...legacySettings };
  delete settings.progressDashboardEnabled;
  await setSynced(SETTINGS_KEY, {
    ...settings,
    readingHistoryEnabled:
      legacySettings.readingHistoryEnabled ?? legacySettings.progressDashboardEnabled ?? DEFAULT_SETTINGS.readingHistoryEnabled,
  });
}

export async function loadSettings(): Promise<JriSettings> {
  const stored = await getSynced<Partial<JriSettings> & { progressDashboardEnabled?: boolean }>(SETTINGS_KEY);
  // Migrate the old persisted flag without losing existing reading-history choices.
  const readingHistoryEnabled = stored?.readingHistoryEnabled ?? stored?.progressDashboardEnabled ?? DEFAULT_SETTINGS.readingHistoryEnabled;
  if (stored?.progressDashboardEnabled !== undefined && stored.readingHistoryEnabled === undefined) {
    const migrated = { ...stored };
    delete migrated.progressDashboardEnabled;
    await setSynced(SETTINGS_KEY, { ...migrated, readingHistoryEnabled });
  }
  return {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
    readingHistoryEnabled,
    completionCelebrationEnabled: stored?.completionCelebrationEnabled ?? DEFAULT_SETTINGS.completionCelebrationEnabled,
    guidedRate: Math.min(3, Math.max(0.5, stored?.guidedRate ?? DEFAULT_SETTINGS.guidedRate)),
    dimOpacity: Math.min(0.9, Math.max(0, stored?.dimOpacity ?? DEFAULT_SETTINGS.dimOpacity)),
    fontScale: Math.min(5, Math.max(0.5, stored?.fontScale ?? DEFAULT_SETTINGS.fontScale)),
  };
}

export async function saveSettings(patch: Partial<JriSettings>): Promise<JriSettings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await setSynced(SETTINGS_KEY, next);
  return next;
}
