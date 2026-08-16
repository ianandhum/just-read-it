import type { ContentCandidateInfo, RuntimeMessage, TabState, ToggleResult } from '@/lib/types';
import { clearAllPageStates, loadSettings, saveSettings } from '@/lib/storage';
import { getReadableVoices } from '@/lib/voices';
import { withDisabled } from '@/lib/actions';
import { formatSeconds } from '@/lib/format';

const toggleElement = document.getElementById('toggle') as HTMLButtonElement | null;
const statusElement = document.getElementById('status');
const voiceElement = document.getElementById('voice') as HTMLSelectElement | null;
const rateElement = document.getElementById('rate') as HTMLInputElement | null;
const rateValueElement = document.getElementById('rate-value');
const guidedRateElement = document.getElementById('guided-rate') as HTMLInputElement | null;
const guidedRateValueElement = document.getElementById('guided-rate-value');
const advanceDelayElement = document.getElementById('advance-delay') as HTMLInputElement | null;
const advanceDelayValueElement = document.getElementById('advance-delay-value');
const dashboardElement = document.getElementById('open-dashboard') as HTMLButtonElement | null;
const resetAllElement = document.getElementById('reset-all') as HTMLButtonElement | null;
const resetConfirmationElement = document.getElementById('reset-confirmation');
const cancelResetElement = document.getElementById('cancel-reset') as HTMLButtonElement | null;
const confirmResetElement = document.getElementById('confirm-reset') as HTMLButtonElement | null;
const dashboardActionsElement = document.getElementById('dashboard-actions');
const enableDashboardElement = document.getElementById('enable-dashboard') as HTMLButtonElement | null;
const dashboardDescriptionElement = document.getElementById('dashboard-description');
const contentCandidatesCardElement = document.getElementById('content-candidates-card');
const contentCandidatesElement = document.getElementById('content-candidates') as HTMLSelectElement | null;

let currentEnabled = false;
let configuredVoiceURI: string | null = null;
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

function applyProgressDashboardUi(enabled: boolean): void {
  if (dashboardActionsElement) dashboardActionsElement.hidden = !enabled;
  if (enableDashboardElement) enableDashboardElement.hidden = enabled;
  if (dashboardDescriptionElement) {
    dashboardDescriptionElement.textContent = 'Resume articles and review your reading time and progress on this device.';
  }
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

function applyContentCandidates(candidates: ContentCandidateInfo[], enabled = currentEnabled): void {
  if (!contentCandidatesCardElement || !contentCandidatesElement) return;
  if (!enabled) {
    contentCandidatesCardElement.hidden = true;
    return;
  }
  contentCandidatesCardElement.hidden = candidates.length < 2;
  contentCandidatesElement.replaceChildren();
  for (const candidate of candidates) {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = `${candidate.label} (${candidate.confidence}% match)`;
    option.selected = candidate.selected;
    contentCandidatesElement.append(option);
  }
}

function applyVoices(): void {
  if (!voiceElement) return;
  const selected = voiceElement.value || configuredVoiceURI || '';
  voiceElement.replaceChildren(new Option('Default voice', ''));
  for (const item of getReadableVoices(selected || undefined)) voiceElement.add(new Option(`${item.name} (${item.lang})`, item.voiceURI));
  voiceElement.value = selected;
  if (voiceElement.value !== selected) voiceElement.value = '';
}

function loadVoicesWhenIdle(): void {
  window.setTimeout(applyVoices, 0);
}

async function init(): Promise<void> {
  let enabled = false;
  try {
    const res = (await browser.runtime.sendMessage({
      type: 'UI_GET_STATE',
    } satisfies RuntimeMessage)) as { tab: TabState } | undefined;
    enabled = res?.tab.enabled ?? false;
    applyContentCandidates(res?.tab.contentCandidates ?? [], enabled);
  } catch (err) {
    console.error('[Just Read It] GET_STATE failed', err);
  }
  applyUi(enabled);
  const settings = await loadSettings();
  applyProgressDashboardUi(settings.progressDashboardEnabled);
  if (rateElement) rateElement.value = String(settings.rate);
  if (rateValueElement) rateValueElement.textContent = `${settings.rate.toFixed(1)}x`;
  configuredVoiceURI = settings.voiceURI;
  if (guidedRateElement) guidedRateElement.value = String(settings.guidedRate);
  if (guidedRateValueElement) guidedRateValueElement.textContent = `${settings.guidedRate.toFixed(1)}x`;
  if (advanceDelayElement) advanceDelayElement.value = String(settings.guidedAdvanceDelay);
  if (advanceDelayValueElement) advanceDelayValueElement.textContent = formatSeconds(settings.guidedAdvanceDelay);
}

async function refreshState(): Promise<void> {
  const revision = stateRevision;
  try {
    const res = (await browser.runtime.sendMessage({ type: 'UI_GET_STATE' } satisfies RuntimeMessage)) as { tab: TabState } | undefined;
    if (toggleInFlight || revision !== stateRevision) return;
    applyUi(res?.tab.enabled ?? false);
    applyContentCandidates(res?.tab.contentCandidates ?? [], res?.tab.enabled ?? false);
  } catch (err) {
    console.log('[Just Read It] unable to send message:', err);
  }
}

speechSynthesis?.addEventListener('voiceschanged', loadVoicesWhenIdle);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshState();
});
window.addEventListener('focus', () => {
  void refreshState();
});
voiceElement?.addEventListener('change', () => {
  configuredVoiceURI = voiceElement.value || null;
  void saveSettings({ voiceURI: configuredVoiceURI });
});
voiceElement?.addEventListener('focus', loadVoicesWhenIdle, { once: true });
rateElement?.addEventListener('input', () => {
  const value = Number(rateElement.value);
  if (rateValueElement) rateValueElement.textContent = `${value.toFixed(1)}x`;
  void saveSettings({ rate: value });
});
guidedRateElement?.addEventListener('input', () => {
  const value = Number(guidedRateElement.value);
  if (guidedRateValueElement) guidedRateValueElement.textContent = `${value.toFixed(1)}x`;
  void saveSettings({ guidedRate: value });
});
advanceDelayElement?.addEventListener('input', () => {
  const value = Number(advanceDelayElement.value);
  if (advanceDelayValueElement) advanceDelayValueElement.textContent = formatSeconds(value);
  void saveSettings({ guidedAdvanceDelay: value });
});
contentCandidatesElement?.addEventListener('change', async () => {
  await browser.runtime.sendMessage({
    type: 'UI_SELECT_CANDIDATE',
    candidateId: contentCandidatesElement.value,
  } satisfies RuntimeMessage);
  window.close();
});
enableDashboardElement?.addEventListener('click', async () => {
  await withDisabled(enableDashboardElement, async () => {
    await saveSettings({ progressDashboardEnabled: true });
    applyProgressDashboardUi(true);
    closePopup();
  });
});
dashboardElement?.addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html'), active: true });
  window.close();
});
resetAllElement?.addEventListener('click', async () => {
  if (resetConfirmationElement) resetConfirmationElement.hidden = false;
  resetAllElement.hidden = true;
  confirmResetElement?.focus();
});
cancelResetElement?.addEventListener('click', () => {
  if (resetConfirmationElement) resetConfirmationElement.hidden = true;
  if (resetAllElement) {
    resetAllElement.hidden = false;
    resetAllElement.focus();
  }
});
confirmResetElement?.addEventListener('click', async () => {
  await withDisabled(confirmResetElement, async () => {
    await clearAllPageStates();
    if (resetConfirmationElement) resetConfirmationElement.hidden = true;
    if (resetAllElement) resetAllElement.hidden = false;
  });
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
          if (!res?.enabled) applyContentCandidates([], false);
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
