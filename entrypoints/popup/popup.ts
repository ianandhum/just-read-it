import type { RuntimeMessage, TabState, ToggleResult } from '@/lib/types';
import { loadSettings, saveSettings } from '@/lib/storage';
import { listenTimeByDay, loadAllPageStates, readingTimeByDay } from '@/lib/storage';
import { withDisabled } from '@/lib/actions';
import { formatDuration } from '@/lib/format';

const toggleElement = document.getElementById('toggle') as HTMLButtonElement | null;
const statusElement = document.getElementById('status');
const openSettingsElement = document.getElementById('open-settings') as HTMLButtonElement | null;
const homeElement = document.getElementById('open-home') as HTMLButtonElement | null;
const historyActionsElement = document.getElementById('history-actions');
const enableHistoryElement = document.getElementById('enable-history') as HTMLButtonElement | null;
const historyDescriptionElement = document.getElementById('history-description');
const todayTotalElement = document.getElementById('today-total') as HTMLElement;
const todayReadingElement = document.getElementById('today-reading') as HTMLElement;
const todayListeningElement = document.getElementById('today-listening') as HTMLElement;
const todayChartElement = document.getElementById('today-chart') as HTMLElement;

let currentEnabled = false;
let stateRevision = 0;
let toggleInFlight = false;

function applyUi(enabled: boolean): void {
  currentEnabled = enabled;
  if (toggleElement) {
    if (enabled) {
      toggleElement.classList.add('active');
      toggleElement.textContent = 'Disable Reading Mode';
    } else {
      toggleElement.classList.remove('active');
      toggleElement.textContent = 'Enable Reading Mode';
    }
  }
  if (statusElement) statusElement.textContent = enabled ? 'On' : 'Off';
}

function applyReadingHistoryUi(enabled: boolean): void {
  if (historyActionsElement) historyActionsElement.hidden = !enabled;
  if (enableHistoryElement) enableHistoryElement.hidden = enabled;
  if (historyDescriptionElement) {
    historyDescriptionElement.textContent = 'Resume articles and review your reading time.';
  }
}

async function renderTodaySummary(): Promise<void> {
  const states = await loadAllPageStates();
  const reading = readingTimeByDay(states, 1)[0]?.timeSpentMs ?? 0;
  const listening = listenTimeByDay(states, 1)[0]?.timeSpentMs ?? 0;
  const total = reading + listening;
  todayTotalElement.textContent = formatDuration(total);
  todayReadingElement.textContent = formatDuration(reading);
  todayListeningElement.textContent = formatDuration(listening);
  todayChartElement.replaceChildren();
  if (total === 0) return;

  const readingBar = document.createElement('span');
  readingBar.className = 'jri-today-reading-bar';
  readingBar.style.width = `${(reading / total) * 100}%`;
  const listeningBar = document.createElement('span');
  listeningBar.className = 'jri-today-listening-bar';
  listeningBar.style.width = `${(listening / total) * 100}%`;
  todayChartElement.append(readingBar, listeningBar);
}

function showError(message: string): void {
  if (statusElement) statusElement.textContent = message;
}

function closePopup(): void {
  window.close();
}

function toggleErrorMessage(error: ToggleResult['error']): string {
  if (error === 'restricted') return 'Unavailable on this page';
  if (error === 'no-tab') return 'No active tab';
  if (error === 'no-content') return 'No readable content found on this page';
  if (error === 'unknown') return 'Unable to update this page. Try again.';
  return 'Action failed. Try again.';
}

async function init(): Promise<void> {
  let enabled = false;
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'UI_GET_STATE',
    } satisfies RuntimeMessage)) as { tab: TabState } | undefined;
    enabled = res?.tab.enabled ?? false;
  } catch (err) {
    console.error('[Just Read It] GET_STATE failed', err);
  }
  applyUi(enabled);
  const settings = await loadSettings();
  applyReadingHistoryUi(settings.readingHistoryEnabled);
  if (settings.readingHistoryEnabled) await renderTodaySummary();
}

async function refreshState(): Promise<void> {
  const revision = stateRevision;
  try {
    const res = (await browser.runtime.sendMessage({ type: 'UI_GET_STATE' } satisfies RuntimeMessage)) as { tab: TabState } | undefined;
    if (toggleInFlight || revision !== stateRevision) return;
    applyUi(res?.tab.enabled ?? false);
  } catch (err) {
    console.log('[Just Read It] unable to send message:', err);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshState();
});
window.addEventListener('focus', () => {
  void refreshState();
});
openSettingsElement?.addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('/home.html?tab=preferences'), active: true });
  closePopup();
});
enableHistoryElement?.addEventListener('click', async () => {
  await withDisabled(enableHistoryElement, async () => {
    await saveSettings({ readingHistoryEnabled: true });
    applyReadingHistoryUi(true);
    await renderTodaySummary();
    closePopup();
  });
});
homeElement?.addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('/home.html'), active: true });
  window.close();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some((key) => key.startsWith('jri:'))) void renderTodaySummary();
});

if (toggleElement) {
  toggleElement.addEventListener('click', async () => {
    await withDisabled(toggleElement, async () => {
      toggleInFlight = true;
      const revision = ++stateRevision;
      try {
        const nextEnabled = !currentEnabled;
        // Give the popup immediate feedback while the content script prepares the reader.
        applyUi(nextEnabled);
        const res = (await browser.runtime.sendMessage({
          type: 'UI_SET_READING_MODE',
          enabled: nextEnabled,
        } satisfies RuntimeMessage)) as ToggleResult | undefined;
        if (revision !== stateRevision) return;
        if (!res || res.ok) {
          applyUi(res?.enabled ?? nextEnabled);
          closePopup();
        } else {
          if (revision !== stateRevision) return;
          if (res) applyUi(res.enabled);
          showError(toggleErrorMessage(res?.error));
        }
      } catch (err) {
        console.error('[Just Read It] toggle failed', err);
        if (revision === stateRevision) showError(toggleErrorMessage(undefined));
      } finally {
        toggleInFlight = false;
      }
    });
  });
}

void init();
