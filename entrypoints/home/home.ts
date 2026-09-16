import {
  clearAllPageStates,
  clearPageState,
  exportData,
  importData,
  listenTimeByDay,
  loadAllPageStates,
  loadSettings,
  readingTimeByDay,
  savePageState,
  saveSettings,
  setPageStarred,
  summarizeReadingProgress,
} from '@/lib/storage';
import { DEFAULT_SETTINGS, type JriSettings, type PageState, type RuntimeMessage } from '@/lib/types';
import { CLEAR_READING_DATA_CONFIRMATION, withDisabled } from '@/lib/actions';
import { formatDuration, formatSeconds } from '@/lib/format';
import { rangesToReadIds } from '@/lib/progress_share';
import { createSvg } from '@/lib/web/svg';
import { getReadableVoices } from '@/lib/voices';

// DOM IDs
const pagesElement = document.getElementById('pages') as HTMLOListElement;
const jumpBackPagesElement = document.getElementById('jump-back-pages') as HTMLOListElement;
const emptyElement = document.getElementById('empty') as HTMLParagraphElement;
const searchEmptyElement = document.getElementById('search-empty') as HTMLParagraphElement;
const resetElement = document.getElementById('reset-all') as HTMLButtonElement;
const exportDataElement = document.getElementById('export-data') as HTMLButtonElement;
const importDataElement = document.getElementById('import-data') as HTMLInputElement;
const importStatusElement = document.getElementById('import-status') as HTMLParagraphElement;
const chartElement = document.getElementById('activity-chart') as HTMLDivElement;
const jumpBackSectionElement = document.getElementById('jump-back-section') as HTMLElement;
const starredSectionElement = document.getElementById('starred-section') as HTMLElement;
const starredPagesElement = document.getElementById('starred-pages') as HTMLOListElement;
const paginationElement = document.getElementById('history-pagination') as HTMLElement;
const previousPageElement = document.getElementById('history-previous') as HTMLButtonElement;
const nextPageElement = document.getElementById('history-next') as HTMLButtonElement;
const historyPageElement = document.getElementById('history-page') as HTMLElement;
const historySearchElement = document.getElementById('history-search') as HTMLInputElement;
const historyUnreadOnlyElement = document.getElementById('history-unread-only') as HTMLInputElement;
const overviewRangeElement = document.getElementById('overview-range') as HTMLSelectElement;
const activityDescriptionElement = document.getElementById('activity-description') as HTMLParagraphElement;
const overviewTrackingPromptElement = document.getElementById('overview-tracking-prompt') as HTMLElement;
const historyTrackingPromptElement = document.getElementById('history-tracking-prompt') as HTMLElement;
const overviewContentElements = Array.from(document.querySelectorAll<HTMLElement>('.summary, .chart-section'));
const historyContentElements = Array.from(
  document.querySelectorAll<HTMLElement>('.history-search, .history-filter, #empty, #search-empty, #pages, #history-pagination'),
);
const enableTrackingElements = Array.from(document.querySelectorAll<HTMLButtonElement>('.enable-tracking'));
const tabElements = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const panelElements = Array.from(document.querySelectorAll<HTMLElement>('[role="tabpanel"]'));
const preview = document.getElementById('article-preview') as HTMLElement;
const previewDimming = document.getElementById('preview-dimming') as HTMLInputElement;
const previewMode = document.getElementById('preview-mode') as HTMLSelectElement;
previewMode.value = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
const resetSettingsElement = document.getElementById('reset-settings') as HTMLButtonElement;
const saveSettingsElement = document.getElementById('save-settings') as HTMLButtonElement;
const dimOpacity = document.getElementById('dim-opacity') as HTMLInputElement;
const dimOpacityValue = document.getElementById('dim-opacity-value') as HTMLOutputElement;
const fontScale = document.getElementById('font-scale') as HTMLInputElement;
const fontScaleValue = document.getElementById('font-scale-value') as HTMLOutputElement;
const currentColor = document.getElementById('current-highlight-color') as HTMLInputElement;
const readColor = document.getElementById('read-highlight-color') as HTMLInputElement;
const currentWordColor = document.getElementById('current-word-background-color') as HTMLInputElement;
const currentColorLabel = document.getElementById('current-color-label') as HTMLElement;
const readColorLabel = document.getElementById('read-color-label') as HTMLElement;
const currentWordColorLabel = document.getElementById('current-word-color-label') as HTMLElement;
const guidedRate = document.getElementById('guided-rate') as HTMLInputElement;
const guidedRateValue = document.getElementById('guided-rate-value') as HTMLOutputElement;
const advanceDelay = document.getElementById('advance-delay') as HTMLInputElement;
const advanceDelayValue = document.getElementById('advance-delay-value') as HTMLOutputElement;
const completionCelebrationEnabled = document.getElementById('completion-celebration-enabled') as HTMLInputElement;
const voice = document.getElementById('voice') as HTMLSelectElement;
const rate = document.getElementById('rate') as HTMLInputElement;
const rateValue = document.getElementById('rate-value') as HTMLOutputElement;

const HISTORY_PAGE_SIZE = 15;
let historyPage = 1;
let historySearch = '';
let historyUnreadOnly = false;
type OverviewRange = 'today' | 'week' | 'month' | 'three-months' | 'all';
let overviewRange: OverviewRange = 'week';
let activeActionsElement: HTMLElement | null = null;
let closeActiveActionsMenu: (() => void) | null = null;
let settings: JriSettings;
let pendingSettings: Partial<JriSettings> = {};
const settingsEditVersions = new Map<keyof JriSettings, number>();
let settingsEditVersion = 0;
let settingsWrite = Promise.resolve();
let settingsRefreshVersion = 0;

const TIME_SECONDS_DAY = 24 * 60 * 60 * 1000;

const JUMPBACK_MAX_DAYS = 10 * TIME_SECONDS_DAY;
const JUMPBACK_MIN_SENTENCES = 30;
const JUMPBACK_MIN_PROGRESS = 25;
const JUMPBACK_MAX_PAGES = 3;
const STARRED_MAX_PAGES = 3;

function setText(id: string, value: string): void {
  document.getElementById(id)!.textContent = value;
}

function setImportStatus(message: string, error = false): void {
  importStatusElement.textContent = message;
  importStatusElement.hidden = false;
  importStatusElement.dataset.error = String(error);
}

function isDarkMode(): boolean {
  return previewMode.value === 'dark';
}

function renderSettingsPreview(): void {
  const dark = isDarkMode();
  preview.style.setProperty('--preview-dim-opacity', String(settings.dimOpacity));
  preview.style.setProperty('--preview-current', dark ? settings.darkCurrentHighlightColor : settings.currentHighlightColor);
  preview.style.setProperty('--preview-read', dark ? settings.darkReadHighlightColor : settings.readHighlightColor);
  preview.style.setProperty('--preview-word', dark ? settings.darkCurrentWordBackgroundColor : settings.currentWordBackgroundColor);
  preview.classList.toggle('dark-preview', dark);
  preview.classList.toggle('dimming-disabled', !previewDimming.checked);
}

function queueSettingsSave(patch: Partial<JriSettings>): void {
  pendingSettings = { ...pendingSettings, ...patch };
  for (const key of Object.keys(patch) as (keyof JriSettings)[]) settingsEditVersions.set(key, ++settingsEditVersion);
  settings = { ...settings, ...patch };
  renderSettingsPreview();
  saveSettingsElement.hidden = Object.keys(pendingSettings).length === 0;
}

function flushSettingsSave(): Promise<void> {
  const patch = { ...pendingSettings };
  const versions = new Map(settingsEditVersions);
  const write = settingsWrite.then(async () => {
    for (const [key, version] of versions) {
      if (settingsEditVersions.get(key) === version) continue;
      delete patch[key];
      versions.delete(key);
    }
    if (versions.size === 0) return;
    await saveSettings(patch);
    // A completed write must not acknowledge input entered while it was in flight.
    for (const [key, version] of versions) {
      if (settingsEditVersions.get(key) !== version) continue;
      delete pendingSettings[key];
      settingsEditVersions.delete(key);
    }
    await refreshSettings();
    saveSettingsElement.hidden = Object.keys(pendingSettings).length === 0;
  });
  settingsWrite = write.catch(() => {});
  return write;
}

async function refreshSettings(): Promise<void> {
  const version = ++settingsRefreshVersion;
  const next = await loadSettings();
  if (version !== settingsRefreshVersion) return;
  settings = { ...next, ...pendingSettings };
  renderSettingsForm();
  renderTrackingUi();
  await render();
  saveSettingsElement.hidden = Object.keys(pendingSettings).length === 0;
}

async function saveChangesBeforeLeaving(): Promise<boolean> {
  if (Object.keys(pendingSettings).length === 0) return true;
  if (!window.confirm('Save preference changes before leaving?')) {
    pendingSettings = {};
    settingsEditVersions.clear();
    void refreshSettings();
    return true;
  }
  try {
    await flushSettingsSave();
  } catch (error) {
    console.error(error);
    return false;
  }
  return true;
}

function populateVoices(): void {
  const selected = settings.voiceURI ?? '';
  voice.replaceChildren(new Option('Default voice', ''));
  for (const item of getReadableVoices(selected || undefined)) voice.add(new Option(`${item.name} (${item.lang})`, item.voiceURI));
  voice.value = selected;
  if (voice.value !== selected) voice.value = '';
}

function renderSettingsForm(): void {
  dimOpacity.value = String(Math.round(settings.dimOpacity * 100));
  dimOpacityValue.textContent = `${dimOpacity.value}%`;
  fontScale.value = String(settings.fontScale);
  fontScaleValue.textContent = `${settings.fontScale.toFixed(1)}x`;
  const dark = isDarkMode();
  currentColor.value = dark ? settings.darkCurrentHighlightColor : settings.currentHighlightColor;
  readColor.value = dark ? settings.darkReadHighlightColor : settings.readHighlightColor;
  currentWordColor.value = dark ? settings.darkCurrentWordBackgroundColor : settings.currentWordBackgroundColor;
  currentColorLabel.textContent = `Current sentence (${dark ? 'dark' : 'light'})`;
  readColorLabel.textContent = `Completed sentence (${dark ? 'dark' : 'light'})`;
  currentWordColorLabel.textContent = `Current word (${dark ? 'dark' : 'light'})`;
  guidedRate.value = String(settings.guidedRate);
  guidedRateValue.textContent = `${settings.guidedRate.toFixed(1)}x`;
  advanceDelay.value = String(settings.guidedAdvanceDelay);
  advanceDelayValue.textContent = formatSeconds(settings.guidedAdvanceDelay);
  completionCelebrationEnabled.checked = settings.completionCelebrationEnabled;
  rate.value = String(settings.rate);
  rateValue.textContent = `${settings.rate.toFixed(1)}x`;
  populateVoices();
  renderSettingsPreview();
}

function activeTabId(): string {
  const queryTab = new URLSearchParams(window.location.search).get('tab');
  if (queryTab) {
    const panelId = `${queryTab}-panel`;
    if (panelElements.some((panel) => panel.id === panelId)) return panelId;
  }
  const id = window.location.hash.slice(1);
  return panelElements.some((panel) => panel.id === id) ? id : 'jump-back-panel';
}

function selectTab(panelId: string): void {
  for (const tab of tabElements) tab.setAttribute('aria-selected', String(tab.getAttribute('aria-controls') === panelId));
  for (const panel of panelElements) panel.hidden = panel.id !== panelId;
}

function renderTrackingUi(): void {
  const enabled = settings.readingHistoryEnabled;
  overviewTrackingPromptElement.hidden = enabled;
  historyTrackingPromptElement.hidden = enabled;
  for (const element of overviewContentElements) element.hidden = !enabled;
  for (const element of historyContentElements) element.hidden = !enabled;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function updatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

function iconSvg(paths: string, attributes: Record<string, string> = {}): SVGSVGElement {
  return createSvg(document, paths, { viewBox: '0 0 24 24', 'aria-hidden': 'true', ...attributes });
}

function buttonLabel(text: string): HTMLSpanElement {
  const label = document.createElement('span');
  label.textContent = text;
  return label;
}

const readingIcon =
  '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 0-1 5H20"/><path d="M8 11h8"/><path d="M8 7h6"/>';
const listeningIcon =
  '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 0-1 5H20"/><path d="M8 12v-2a4 4 0 0 1 8 0v2"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="12" r="1"/>';

function timeBreakdown(readingMs: number, listeningMs: number): DocumentFragment {
  const breakdown = document.createDocumentFragment();
  const reading = document.createElement('span');
  reading.className = 'time-breakdown-item';
  const readingLabel = document.createElement('span');
  readingLabel.textContent = ` ${formatDuration(readingMs)}`;
  reading.append(
    iconSvg(readingIcon, {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
    readingLabel,
  );
  const listening = document.createElement('span');
  listening.className = 'time-breakdown-item';
  const listeningLabel = document.createElement('span');
  listeningLabel.textContent = ` ${formatDuration(listeningMs)}`;
  listening.append(
    iconSvg(listeningIcon, {
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
    listeningLabel,
  );
  breakdown.append(reading, listening);
  return breakdown;
}

function readingDetails(state: PageState, sentencesRead: number): DocumentFragment {
  const details = document.createDocumentFragment();
  if (sentencesRead < state.total) details.append(`${formatDuration(state.estimatedUnreadMs ?? 0)} left · `);
  details.append(timeBreakdown(state.timeSpentMs ?? 0, state.listenTimeSpentMs ?? 0), ` · Updated ${updatedAt(state.updatedAt)}`);
  return details;
}

function isJumpBackPage(state: PageState, now = Date.now()): boolean {
  const sentencesRead = Math.min(rangesToReadIds(state.readRanges, state.total).length, state.total);
  const percent = state.total === 0 ? 0 : (sentencesRead / state.total) * 100;
  if (percent >= 100) {
    return false;
  }
  if (state.updatedAt < now - JUMPBACK_MAX_DAYS) {
    return false;
  }

  return sentencesRead > JUMPBACK_MIN_SENTENCES || percent >= JUMPBACK_MIN_PROGRESS;
}

function overviewStart(now = Date.now()): Date {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (overviewRange === 'all') return new Date(0);
  if (overviewRange === 'today') return today;
  if (overviewRange === 'week') {
    const day = today.getDay();
    today.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
    return today;
  }
  if (overviewRange === 'month') {
    today.setDate(1);
    return today;
  }
  today.setMonth(today.getMonth() - 3);
  return today;
}

function isInOverviewRange(state: PageState, now = Date.now()): boolean {
  return state.updatedAt >= overviewStart(now).getTime();
}

function rangeDays(now = new Date()): number {
  const start = overviewStart(now.getTime());
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end.getTime() - start.getTime()) / TIME_SECONDS_DAY) + 1;
}

function rangeDescription(): string {
  if (overviewRange === 'today') return 'Your reading and listening activity for today.';
  if (overviewRange === 'week') return 'Your reading and listening activity for this week.';
  if (overviewRange === 'month') return 'Your reading and listening activity for this month.';
  if (overviewRange === 'all') return 'Your reading and listening activity for all time.';
  return 'Your reading and listening activity over the last three months.';
}

function historyGroupLabel(timestamp: number, now = new Date()): string {
  const date = new Date(timestamp);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (date >= today) return 'Today';

  const weekStart = new Date(today);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1));
  if (date >= weekStart) return 'This Week';

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  if (date >= monthStart) return 'This Month';

  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  if (date >= threeMonthsAgo) return 'Last Three Months';
  return 'Earlier';
}

function historyItems(states: PageState[]): HTMLLIElement[] {
  const items: HTMLLIElement[] = [];
  let previousGroup = '';
  for (const state of states) {
    const group = historyGroupLabel(state.updatedAt);
    if (group !== previousGroup) {
      const heading = document.createElement('li');
      heading.className = 'history-group-heading';
      heading.textContent = group;
      heading.setAttribute('aria-hidden', 'true');
      items.push(heading);
      previousGroup = group;
    }
    items.push(pageItem(state));
  }
  return items;
}

function chartDays(states: PageState[]): number {
  if (overviewRange !== 'all') return rangeDays();
  const dates = states
    .flatMap((state) => [...Object.keys(state.dailyTimeSpentMs ?? {}), ...Object.keys(state.dailyListenTimeSpentMs ?? {})])
    .sort();
  if (dates.length === 0) return 30;
  const earliest = new Date(`${dates[0]}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.floor((today.getTime() - earliest.getTime()) / TIME_SECONDS_DAY) + 1);
}

function chartDateLabel(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  if (days === 1) return 'Today';
  return value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function chartTickInterval(days: number): number {
  if (days <= 7) return 1;
  if (days <= 14) return 2;
  if (days <= 31) return 7;
  return 14;
}

function starButton(state: PageState, label: string, menu = false): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `reading-page-star${state.starred ? ' reading-page-star-active' : ''}`;
  button.setAttribute('aria-label', `${state.starred ? 'Unstar' : 'Star'} ${label}`);
  button.setAttribute('aria-pressed', String(!!state.starred));
  if (!menu) button.title = state.starred ? 'Unstar article' : 'Star article';
  button.append(
    iconSvg(
      '<path d="M12 2.5l2.6 5.9 6.4.6-4.8 4.2 1.4 6.3L12 16.6l-5.6 2.9 1.4-6.3L3 9l6.4-.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    ),
  );
  if (menu) {
    const text = document.createElement('span');
    text.textContent = state.starred ? 'Unstar' : 'Star';
    button.append(text);
  }
  button.addEventListener('click', async () => {
    await withDisabled(button, async () => {
      await setPageStarred(state.url, !state.starred);
      await render();
    });
  });
  return button;
}

function pageItem(state: PageState, variantClass = ''): HTMLLIElement {
  const sentencesRead = Math.min(rangesToReadIds(state.readRanges, state.total).length, state.total);
  const percent = state.total === 0 ? 0 : Math.floor((sentencesRead / state.total) * 100);
  const item = document.createElement('li');
  item.className = `${sentencesRead >= state.total ? 'reading-page reading-page-is-complete' : 'reading-page'} ${variantClass}`.trim();
  const identity = document.createElement('div');
  identity.className = 'reading-page-identity';
  const favicon = document.createElement('img');
  favicon.className = 'reading-page-favicon';
  favicon.alt = '';
  favicon.src = state.faviconUrl ?? new URL('/favicon.ico', state.url).href;
  favicon.addEventListener('error', () => favicon.remove(), { once: true });
  const link = document.createElement('a');
  link.href = state.url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = state.title?.trim() || hostname(state.url);
  link.title = state.url;
  link.addEventListener('click', async (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    try {
      const page = new URL(state.url);
      const host = page.hostname;
      const continueInReader = window.confirm(
        `Allow Just Read It to access ${host} so it can reopen this article in Reading Mode? You can open it normally instead.`,
      );
      if (!continueInReader) {
        window.open(state.url, '_blank', 'noopener,noreferrer');
        return;
      }
      const granted = await browser.permissions.request({ origins: [`${page.origin}/*`] });
      if (granted) {
        await browser.runtime.sendMessage({ type: 'UI_OPEN_READING_PAGE', url: state.url } satisfies RuntimeMessage);
      } else {
        window.open(state.url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      window.open(state.url, '_blank', 'noopener,noreferrer');
    }
  });
  identity.append(favicon, link);
  if (state.starred && variantClass !== 'jump-back-card' && variantClass !== 'starred-card') {
    const starFlag = document.createElement('span');
    starFlag.className = 'reading-page-starred-flag';
    starFlag.setAttribute('aria-label', 'Starred');
    starFlag.append(
      iconSvg(
        '<path d="M12 2.5l2.6 5.9 6.4.6-4.8 4.2 1.4 6.3L12 16.6l-5.6 2.9 1.4-6.3L3 9l6.4-.6z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
      ),
    );
    identity.append(starFlag);
  }
  const url = document.createElement('div');
  url.className = 'reading-page-url';
  url.textContent = state.url;
  url.title = state.url;

  const details = document.createElement('div');
  details.className = 'reading-page-details';
  details.append(readingDetails(state, sentencesRead));

  const bar = document.createElement('div');
  bar.className = 'reading-progress-track';

  const progress = document.createElement('div');
  progress.className = 'reading-progress-value';
  progress.style.width = `${percent}%`;
  bar.append(progress);

  const percentElement = document.createElement('strong');
  percentElement.className = 'reading-page-progress';
  percentElement.textContent = `${percent}%`;

  const completeButton = document.createElement('button');
  completeButton.className = 'reading-page-complete';
  completeButton.type = 'button';
  completeButton.append(
    iconSvg('<path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    buttonLabel('Mark as Read'),
  );
  completeButton.setAttribute('aria-label', `Mark ${link.textContent} as read`);
  completeButton.addEventListener('click', async () => {
    await withDisabled(completeButton, async () => {
      await savePageState({
        ...state,
        readRanges: state.total > 0 ? [[0, state.total]] : [],
        currentId: null,
        updatedAt: Date.now(),
      });
      await render();
    });
  });

  const removeButton = document.createElement('button');
  removeButton.className = 'reading-page-remove';
  removeButton.type = 'button';
  removeButton.append(
    iconSvg(
      '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7l1-3h4l1 3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
    ),
    buttonLabel('Remove'),
  );
  removeButton.setAttribute('aria-label', `Remove ${link.textContent} from saved pages`);
  removeButton.addEventListener('click', async () => {
    if (!window.confirm(`Remove "${link.textContent}" and its saved reading progress?`)) return;
    await withDisabled(removeButton, async () => {
      await clearPageState(state.url);
      await render();
    });
  });

  if (variantClass === 'jump-back-card' || variantClass === 'starred-card') {
    // Cards keep their actions pinned at the bottom of the card.
    if (sentencesRead < state.total) item.append(completeButton);
    item.append(starButton(state, link.textContent ?? 'this article'), removeButton);
  } else {
    // History rows tuck the actions behind a 3-dots menu that opens a card popover.
    const actions = document.createElement('div');
    actions.className = 'reading-page-actions';
    const menuButton = document.createElement('button');
    menuButton.className = 'reading-page-menu-button';
    menuButton.type = 'button';
    menuButton.setAttribute('aria-label', `Actions for ${link.textContent}`);
    menuButton.setAttribute('aria-haspopup', 'true');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.append(
      iconSvg('<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>', {
        fill: 'currentColor',
      }),
    );
    const menu = document.createElement('div');
    menu.className = 'reading-page-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.append(starButton(state, link.textContent ?? 'this article', true), completeButton, removeButton);
    actions.append(menuButton, menu);
    item.append(actions);
    const setOpen = (open: boolean): void => {
      if (open && activeActionsElement && activeActionsElement !== actions) closeActiveActionsMenu?.();
      menu.hidden = !open;
      menuButton.setAttribute('aria-expanded', String(open));
      if (open) {
        activeActionsElement = actions;
        closeActiveActionsMenu = () => setOpen(false);
      } else if (activeActionsElement === actions) {
        activeActionsElement = null;
        closeActiveActionsMenu = null;
      }
    };
    menuButton.addEventListener('click', () => setOpen(!!menu.hidden));
  }

  if (variantClass === 'jump-back-card' || variantClass === 'starred-card') {
    const media = document.createElement('div');
    media.className = 'jump-back-preview';
    const showPlaceholder = (): void => {
      media.classList.add('jump-back-preview-placeholder');
      media.replaceChildren(
        iconSvg(
          '<path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12H16"/><path d="M9.5 16H14"/>',
          { fill: 'none', stroke: 'currentColor', 'stroke-width': '2' },
        ),
      );
    };
    if (state.previewImageUrl) {
      const preview = document.createElement('img');
      preview.src = state.previewImageUrl;
      preview.alt = '';
      preview.addEventListener(
        'error',
        () => {
          showPlaceholder();
        },
        { once: true },
      );
      media.append(preview);
    } else {
      showPlaceholder();
    }
    item.append(media);
  }
  item.append(identity, url, details, bar, percentElement);
  return item;
}

function chartMaximum(milliseconds: number): number {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const magnitude = 10 ** Math.floor(Math.log10(minutes));
  const fraction = minutes / magnitude;
  const rounded = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return rounded * magnitude * 60_000;
}

function chartLabel(milliseconds: number, useHours: boolean): string {
  const divisor = useHours ? 60 * 60_000 : 60_000;
  const suffix = divisor === 60_000 ? 'm' : 'h';
  const value = milliseconds / divisor;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;
}

function renderChart(states: PageState[]): void {
  const rangeDays = chartDays(states);
  const readingDays = readingTimeByDay(states, rangeDays);
  const listeningDays = listenTimeByDay(states, rangeDays);
  const days = readingDays.map((day, index) => ({
    ...day,
    timeSpentMs: day.timeSpentMs + (listeningDays[index]?.timeSpentMs ?? 0),
  }));
  const largestDailyTime = Math.max(...days.map((day) => day.timeSpentMs), 0);
  const maximum = chartMaximum(largestDailyTime);
  const useHours = largestDailyTime >= 60 * 60_000;
  const chart = document.createElement('div');
  chart.className = 'chart-plot';
  const axis = document.createElement('div');
  axis.className = 'chart-axis';
  for (const value of [maximum, maximum / 2, 0]) {
    const label = document.createElement('span');
    label.textContent = chartLabel(value, useHours);
    axis.append(label);
  }
  const bars = document.createElement('div');
  bars.className = 'chart-bars';
  bars.style.gridTemplateColumns = `repeat(${rangeDays}, minmax(0, 1fr))`;
  for (const day of days) {
    const column = document.createElement('div');
    column.className = 'chart-column';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${Math.max(2, (day.timeSpentMs / maximum) * 100)}%`;
    const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    bar.title = `${label}: ${formatDuration(day.timeSpentMs)}`;
    column.append(bar);
    bars.append(column);
  }
  const dates = document.createElement('div');
  dates.className = 'chart-dates';
  dates.style.gridTemplateColumns = `repeat(${rangeDays}, minmax(0, 1fr))`;
  const interval = chartTickInterval(rangeDays);
  const lastRegularTick = Math.floor((days.length - 1) / interval) * interval;
  for (let index = 0; index < days.length; index++) {
    const isRegularTick = index % interval === 0;
    const isCloseEndpoint = index === days.length - 1 && index - lastRegularTick < interval;
    if (!isRegularTick && index !== days.length - 1) continue;
    if (isCloseEndpoint && index !== 0) continue;
    const day = days[index]!;
    const label = document.createElement('span');
    label.style.left = `${((index + 0.5) / rangeDays) * 100}%`;
    label.textContent = chartDateLabel(day.date, rangeDays);
    dates.append(label);
  }
  const plot = document.createElement('div');
  plot.className = 'chart-content';
  plot.append(bars, dates);
  chart.append(axis, plot);
  chartElement.replaceChildren(chart);
}

async function render(): Promise<void> {
  const states = await loadAllPageStates();
  const overviewStates = states.filter((state) => isInOverviewRange(state));
  const summary = summarizeReadingProgress(overviewStates);
  const activityDays = readingTimeByDay(states, chartDays(states));
  const activityReadingTimeSpentMs = activityDays.reduce((total, day) => total + day.timeSpentMs, 0);
  const listenDays = listenTimeByDay(states, chartDays(states));
  const activityListenTimeSpentMs = listenDays.reduce((total, day) => total + day.timeSpentMs, 0);
  const activityTimeSpentMs = activityReadingTimeSpentMs + activityListenTimeSpentMs;

  const matchingStates = states.filter((state) => {
    const query = historySearch.toLocaleLowerCase();
    const sentencesRead = Math.min(rangesToReadIds(state.readRanges, state.total).length, state.total);
    const isUnread = sentencesRead < state.total;
    return (!query || `${state.title ?? ''} ${state.url}`.toLocaleLowerCase().includes(query)) && (!historyUnreadOnly || isUnread);
  });

  const totalHistoryPages = Math.max(1, Math.ceil(matchingStates.length / HISTORY_PAGE_SIZE));
  historyPage = Math.min(historyPage, totalHistoryPages);
  const historyStart = (historyPage - 1) * HISTORY_PAGE_SIZE;

  const jumpBackPages: PageState[] = [];
  for (const state of overviewStates) {
    if (!isJumpBackPage(state)) continue;
    jumpBackPages.push(state);
    if (jumpBackPages.length === JUMPBACK_MAX_PAGES) break;
  }

  const starredPages = states.filter((state) => state.starred).slice(0, STARRED_MAX_PAGES);

  setText('completion-percent', `${summary.completionPercent}%`);
  setText('time-spent', formatDuration(activityTimeSpentMs));
  setText('reading-time-breakdown', formatDuration(activityReadingTimeSpentMs));
  setText('listening-time-breakdown', formatDuration(activityListenTimeSpentMs));
  setText('pages-completed', String(summary.pagesCompleted));
  setText('pages-progress', String(summary.pagesInProgress));
  setText('page-count', `${summary.pagesTracked} saved`);
  setText('chart-total', formatDuration(activityTimeSpentMs));

  activityDescriptionElement.textContent = rangeDescription();
  emptyElement.hidden = states.length > 0;
  searchEmptyElement.hidden = states.length === 0 || matchingStates.length > 0;
  jumpBackSectionElement.hidden = jumpBackPages.length === 0;
  jumpBackPagesElement.replaceChildren(...jumpBackPages.map((state) => pageItem(state, 'jump-back-card')));
  starredSectionElement.hidden = starredPages.length === 0;
  starredPagesElement.replaceChildren(...starredPages.map((state) => pageItem(state, 'starred-card')));
  pagesElement.replaceChildren(...historyItems(matchingStates.slice(historyStart, historyStart + HISTORY_PAGE_SIZE)));
  paginationElement.hidden = matchingStates.length <= HISTORY_PAGE_SIZE;
  previousPageElement.disabled = historyPage === 1;
  nextPageElement.disabled = historyPage === totalHistoryPages;
  historyPageElement.textContent = `Page ${historyPage} of ${totalHistoryPages}`;
  renderChart(states);
}

document.addEventListener('click', (event) => {
  if (activeActionsElement?.contains(event.target as Node)) return;
  closeActiveActionsMenu?.();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeActiveActionsMenu?.();
});

previousPageElement.addEventListener('click', () => {
  historyPage--;
  void render();
});

nextPageElement.addEventListener('click', () => {
  historyPage++;
  void render();
});

historySearchElement.addEventListener('input', () => {
  historySearch = historySearchElement.value.trim();
  historyPage = 1;
  void render();
});

historyUnreadOnlyElement.addEventListener('change', () => {
  historyUnreadOnly = historyUnreadOnlyElement.checked;
  historyPage = 1;
  void render();
});

overviewRangeElement.addEventListener('change', () => {
  overviewRange = overviewRangeElement.value as OverviewRange;
  void render();
});

for (const tab of tabElements) {
  tab.addEventListener('click', async () => {
    const panelId = tab.getAttribute('aria-controls');
    if (!panelId) return;
    if (activeTabId() === 'preferences-panel' && panelId !== 'preferences-panel' && !(await saveChangesBeforeLeaving())) return;
    window.history.pushState(null, '', `#${panelId}`);
    selectTab(panelId);
  });
}

window.addEventListener('hashchange', () => {
  if (activeTabId() === 'preferences-panel') return;
  void saveChangesBeforeLeaving();
  selectTab(activeTabId());
});

for (const button of enableTrackingElements) {
  button.addEventListener('click', async () => {
    await withDisabled(button, async () => {
      queueSettingsSave({ readingHistoryEnabled: true });
      await flushSettingsSave();
    });
  });
}

dimOpacity.addEventListener('input', () => {
  dimOpacityValue.textContent = `${dimOpacity.value}%`;
  queueSettingsSave({ dimOpacity: Number(dimOpacity.value) / 100 });
});
fontScale.addEventListener('input', () => {
  const value = Number(fontScale.value);
  fontScaleValue.textContent = `${value.toFixed(1)}x`;
  queueSettingsSave({ fontScale: value });
});
currentColor.addEventListener('input', () =>
  queueSettingsSave(isDarkMode() ? { darkCurrentHighlightColor: currentColor.value } : { currentHighlightColor: currentColor.value }),
);
readColor.addEventListener('input', () =>
  queueSettingsSave(isDarkMode() ? { darkReadHighlightColor: readColor.value } : { readHighlightColor: readColor.value }),
);
currentWordColor.addEventListener('input', () =>
  queueSettingsSave(
    isDarkMode() ? { darkCurrentWordBackgroundColor: currentWordColor.value } : { currentWordBackgroundColor: currentWordColor.value },
  ),
);
guidedRate.addEventListener('input', () => {
  const value = Number(guidedRate.value);
  guidedRateValue.textContent = `${value.toFixed(1)}x`;
  queueSettingsSave({ guidedRate: value });
});
advanceDelay.addEventListener('input', () => {
  const value = Number(advanceDelay.value);
  advanceDelayValue.textContent = formatSeconds(value);
  queueSettingsSave({ guidedAdvanceDelay: value });
});
completionCelebrationEnabled.addEventListener('change', () =>
  queueSettingsSave({ completionCelebrationEnabled: completionCelebrationEnabled.checked }),
);
rate.addEventListener('input', () => {
  const value = Number(rate.value);
  rateValue.textContent = `${value.toFixed(1)}x`;
  queueSettingsSave({ rate: value });
});
voice.addEventListener('change', () => queueSettingsSave({ voiceURI: voice.value || null }));
previewDimming.addEventListener('change', renderSettingsPreview);
previewMode.addEventListener('change', renderSettingsPreview);
speechSynthesis?.addEventListener('voiceschanged', populateVoices);
resetSettingsElement.addEventListener('click', async () => {
  if (!window.confirm('Reset the settings shown on this page?')) return;
  queueSettingsSave({
    dimOpacity: DEFAULT_SETTINGS.dimOpacity,
    fontScale: DEFAULT_SETTINGS.fontScale,
    currentHighlightColor: DEFAULT_SETTINGS.currentHighlightColor,
    readHighlightColor: DEFAULT_SETTINGS.readHighlightColor,
    darkCurrentHighlightColor: DEFAULT_SETTINGS.darkCurrentHighlightColor,
    darkReadHighlightColor: DEFAULT_SETTINGS.darkReadHighlightColor,
    currentWordBackgroundColor: DEFAULT_SETTINGS.currentWordBackgroundColor,
    darkCurrentWordBackgroundColor: DEFAULT_SETTINGS.darkCurrentWordBackgroundColor,
    guidedRate: DEFAULT_SETTINGS.guidedRate,
    guidedAdvanceDelay: DEFAULT_SETTINGS.guidedAdvanceDelay,
    completionCelebrationEnabled: DEFAULT_SETTINGS.completionCelebrationEnabled,
    rate: DEFAULT_SETTINGS.rate,
    voiceURI: DEFAULT_SETTINGS.voiceURI,
  });
  renderSettingsForm();
});

saveSettingsElement.addEventListener('click', async () => {
  await withDisabled(saveSettingsElement, async () => {
    await flushSettingsSave();
  });
});

resetElement.addEventListener('click', async () => {
  if (!window.confirm(CLEAR_READING_DATA_CONFIRMATION)) return;
  await withDisabled(resetElement, async () => {
    await clearAllPageStates();
    await render();
  });
});

exportDataElement.addEventListener('click', async () => {
  await withDisabled(exportDataElement, async () => {
    const backup = await exportData();
    const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `just-read-it-backup-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setImportStatus('Your reading progress and settings have been exported.');
  });
});

importDataElement.addEventListener('change', async () => {
  const file = importDataElement.files?.[0];
  importDataElement.value = '';
  if (!file) return;
  if (!window.confirm('Importing will replace all saved reading progress and settings. Continue?')) return;

  pendingSettings = {};
  settingsEditVersions.clear();
  // Finish earlier writes before replacing settings; later input stays pending.
  const write = settingsWrite.then(async () => {
    const data: unknown = JSON.parse(await file.text());
    await importData(data);
    await refreshSettings();
  });
  settingsWrite = write.catch(() => {});
  try {
    await write;
    setImportStatus('Your reading progress and settings have been imported.');
  } catch (error) {
    setImportStatus(error instanceof Error ? error.message : 'The backup could not be imported.', true);
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if ((area === 'sync' && 'jri:settings' in changes) || (area === 'local' && Object.keys(changes).some((key) => key.startsWith('jri:')))) {
    void refreshSettings();
  }
});

const initialTabId = activeTabId();
if (new URLSearchParams(window.location.search).has('tab')) window.history.replaceState(null, '', window.location.pathname);
selectTab(initialTabId);
void refreshSettings();

window.addEventListener('beforeunload', (event) => {
  if (Object.keys(pendingSettings).length === 0) return;
  event.preventDefault();
  event.returnValue = '';
});
