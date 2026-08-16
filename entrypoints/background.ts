import type { ContentCandidateInfo, RuntimeMessage, TabState, ToggleResult } from '@/lib/types';
import { DEFAULT_SETTINGS } from '@/lib/types';
import { loadSettings } from '@/lib/storage';

export default defineBackground(() => {
  console.log('[Just Read It] background script init');

  const activeTabs = new Set<number>();
  const hoveredSentenceTabs = new Set<number>();
  const pending = new Set<number>();
  const activationPending = new Set<number>();
  const pendingEnable = new Map<number, Promise<ToggleResult>>();
  const tabLocks = new Map<number, Promise<void>>();
  const sessionTokens = new Map<number, string>();
  const readinessWaiters = new Map<number, { token: string; resolve: (ready: boolean) => void }>();
  const tabStateEpoch = new Map<number, number>();
  const pendingAutoEnable = new Set<number>();
  const contentCandidatesByTab = new Map<number, ContentCandidateInfo[]>();
  const readerStyles = new Set<number>();
  const MENU_ROOT = 'jri-root';
  const MENU_ENABLE_ROOT = 'jri-enable-root';
  const MENU_TOGGLE = 'jri-toggle';
  const MENU_MARK_PREVIOUS = 'jri-mark-previous';

  let activeTabId: number | null = null;
  let speechTabId: number | null = null;
  let speechGeneration = 0;
  let contextMenuReady = false;

  const extensionTtsAvailable = !navigator.userAgent.toLowerCase().includes('firefox') && typeof browser.tts !== 'undefined';

  void initializeContextMenu();

  browser.runtime.onMessage.addListener((message, sender) => {
    const msg = message as RuntimeMessage;
    switch (msg.type) {
      // Extension pages (contentScript, popup, home) -> background.
      case 'UI_GET_STATE':
        return handleGetState();
      case 'UI_SET_READING_MODE':
        return msg.enabled ? handleReadingModeState(true) : disableReadingModeForActiveTab();
      case 'UI_SELECT_CANDIDATE':
        return forwardToActiveTab({ type: 'BG_SELECT_CANDIDATE', candidateId: msg.candidateId });
      case 'UI_OPEN_READING_PAGE':
        return openReadingPage(msg.url);
      // Content script -> background. The originating tab is always known.
      case 'CS_READING_MODE_STATE':
        if (sender.tab?.id != null && sessionTokens.get(sender.tab.id) === msg.token) {
          const tabId = sender.tab.id;
          if (msg.enabled) {
            activeTabs.add(tabId);
          } else {
            activeTabs.delete(tabId);
            hoveredSentenceTabs.delete(tabId);
          }
          const waiter = readinessWaiters.get(tabId);
          if (waiter?.token === msg.token) {
            readinessWaiters.delete(tabId);
            waiter.resolve(msg.enabled);
          }
          void refreshContextMenuForActiveTab(tabId);
        }
        return undefined;
      case 'CS_SENTENCE_HOVER':
        if (sender.tab?.id != null && activeTabs.has(sender.tab.id)) {
          if (msg.hovered) hoveredSentenceTabs.add(sender.tab.id);
          else hoveredSentenceTabs.delete(sender.tab.id);
          void refreshContextMenuForActiveTab(sender.tab.id);
        }
        return undefined;
      case 'CS_CONTENT_CANDIDATES':
        if (sender.tab?.id != null) {
          contentCandidatesByTab.set(sender.tab.id, msg.candidates);
          void browser.storage.session.set({ [contentCandidatesKey(sender.tab.id)]: msg.candidates });
        }
        return undefined;
      case 'CS_SET_READING_MODE': {
        const tabId = sender.tab?.id;
        if (tabId == null) return undefined;
        return msg.enabled ? withTabLock(tabId, () => updateReadingModeState(tabId, true)) : disableReadingMode(tabId);
      }
      case 'CS_OPEN_HOME':
        return openHomePage();
      case 'CS_TTS_STATUS':
        return getTtsStatus();
      case 'CS_TTS_SPEAK':
        return speak(msg.text, msg.rate, msg.voiceURI, msg.requestId, sender.tab?.id ?? null);
      case 'CS_TTS_STOP':
        stopSpeech(sender.tab?.id ?? null);
        return undefined;
      default:
        return undefined;
    }
  });

  browser.commands?.onCommand.addListener(async (command) => {
    if (command !== 'activate-reading') return;
    const tabId = await getActiveTabId();
    if (tabId == null) return;
    await withTabLock(tabId, () => updateReadingModeState(tabId, !activeTabs.has(tabId)));
  });

  browser.contextMenus?.onClicked.addListener(async (info, tab) => {
    const tabId = tab?.id;
    switch (info.menuItemId) {
      case MENU_ENABLE_ROOT:
      case MENU_TOGGLE: {
        if (tabId == null) return;
        await withTabLock(tabId, () => updateReadingModeState(tabId, !activeTabs.has(tabId)));
        break;
      }
      case MENU_MARK_PREVIOUS: {
        if (tabId == null) return;
        await forwardToTab(tabId, { type: 'BG_MARK_PREVIOUS_READ' });
        break;
      }
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    tabStateEpoch.set(tabId, (tabStateEpoch.get(tabId) ?? 0) + 1);
    activeTabs.delete(tabId);
    hoveredSentenceTabs.delete(tabId);
    sessionTokens.delete(tabId);
    readinessWaiters.delete(tabId);
    clearContentCandidates(tabId);
    readerStyles.delete(tabId);
    pending.delete(tabId);
    pendingEnable.delete(tabId);
    pendingAutoEnable.delete(tabId);
    tabLocks.delete(tabId);
    stopSpeech(tabId);
  });

  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') {
      tabStateEpoch.set(tabId, (tabStateEpoch.get(tabId) ?? 0) + 1);
      const wasActive = activeTabs.has(tabId);
      activeTabs.delete(tabId);
      hoveredSentenceTabs.delete(tabId);
      sessionTokens.delete(tabId);
      readinessWaiters.delete(tabId);
      clearContentCandidates(tabId);
      readerStyles.delete(tabId);
      pending.delete(tabId);
      pendingEnable.delete(tabId);
      stopSpeech(tabId);
      if (wasActive) {
        void updateContextMenuState(tabId);
      }
    }
    if (change.status === 'complete' && pendingAutoEnable.delete(tabId)) {
      void withTabLock(tabId, () => updateReadingModeState(tabId, true));
    }
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    activeTabId = tabId;
    // Reset the global menu immediately. isTabActive performs an asynchronous
    // content-script check, whose result may arrive after another tab is active.
    void updateContextMenuState(tabId);
    void isTabActive(tabId);
  });

  async function getActiveTabId(): Promise<number | null> {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  }

  async function initializeContextMenu(): Promise<void> {
    if (!browser.contextMenus) return;
    contextMenuReady = false;
    try {
      // cleanup before init
      await browser.contextMenus.remove(MENU_ROOT).catch(() => undefined);
      await browser.contextMenus.remove(MENU_ENABLE_ROOT).catch(() => undefined);
      await browser.contextMenus.remove(MENU_TOGGLE).catch(() => undefined);
      await browser.contextMenus.remove(MENU_MARK_PREVIOUS).catch(() => undefined);
      await browser.contextMenus.create({
        id: MENU_ROOT,
        title: 'Reading Mode',
        contexts: ['page'],
        visible: false,
      });
      await browser.contextMenus.create({
        id: MENU_ENABLE_ROOT,
        title: 'Enable Reading Mode',
        contexts: ['page'],
      });
      await browser.contextMenus.create({
        id: MENU_TOGGLE,
        parentId: MENU_ROOT,
        title: 'Disable on this Page',
        contexts: ['page'],
      });
      await browser.contextMenus.create({
        id: MENU_MARK_PREVIOUS,
        parentId: MENU_ROOT,
        title: 'Read from Here',
        contexts: ['page'],
      });
      contextMenuReady = true;
      activeTabId = await getActiveTabId();
      await updateContextMenuState(activeTabId);
    } catch (err) {
      console.warn('[Just Read It] unable to initialize context menu:', err);
    }
  }

  async function updateContextMenuState(tabId: number | null): Promise<void> {
    // Browser context menus are shared between tabs. activeTab matters
    if (!contextMenuReady || tabId !== activeTabId) return;
    const on = tabId != null && activeTabs.has(tabId);
    try {
      await Promise.all([
        browser.contextMenus?.update(MENU_ROOT, { visible: on }),
        browser.contextMenus?.update(MENU_ENABLE_ROOT, { visible: !on }),
        browser.contextMenus?.update(MENU_MARK_PREVIOUS, { visible: on && tabId != null && hoveredSentenceTabs.has(tabId) }),
      ]);
    } catch (err) {
      console.warn('[Just Read It] unable to update contextMenu state:', err);
    }
  }

  async function refreshContextMenuForActiveTab(tabId: number): Promise<void> {
    try {
      const current = await getActiveTabId();
      if (current === tabId) activeTabId = tabId;
      await updateContextMenuState(current);
    } catch {
      // Its okay if this fails, best effort.
    }
  }

  async function handleGetState(): Promise<{ tab: TabState }> {
    const tabId = await getActiveTabId();
    const contentCandidates = tabId == null ? [] : await loadContentCandidates(tabId);
    const enabled = tabId != null && (activeTabs.has(tabId) || pending.has(tabId) || (await isTabActive(tabId)));
    let settings = DEFAULT_SETTINGS;
    try {
      settings = await loadSettings();
    } catch (err) {
      console.error('[Just Read It] load settings failed', err);
    }
    return { tab: { enabled, state: null, settings, contentCandidates } };
  }

  function contentCandidatesKey(tabId: number): string {
    return `jri:content-candidates:${tabId}`;
  }

  async function loadContentCandidates(tabId: number): Promise<ContentCandidateInfo[]> {
    const cached = contentCandidatesByTab.get(tabId);
    if (cached) return cached;
    const key = contentCandidatesKey(tabId);
    const stored = await browser.storage.session.get(key);
    const candidates = stored[key] as ContentCandidateInfo[] | undefined;
    if (candidates) contentCandidatesByTab.set(tabId, candidates);
    return candidates ?? [];
  }

  function clearContentCandidates(tabId: number): void {
    contentCandidatesByTab.delete(tabId);
    void browser.storage.session.remove(contentCandidatesKey(tabId));
  }

  async function forwardToActiveTab(message: RuntimeMessage): Promise<unknown> {
    const tabId = await getActiveTabId();
    if (tabId == null) return { candidates: [] };
    try {
      return await forwardToTab(tabId, message);
    } catch {
      return { candidates: [] };
    }
  }

  async function forwardToTab(tabId: number, message: RuntimeMessage): Promise<unknown> {
    try {
      return await browser.tabs.sendMessage(tabId, message);
    } catch {
      return undefined;
    }
  }

  async function isTabActive(tabId: number): Promise<boolean> {
    // While an activation is in flight, the in-memory state is the freshest
    // known answer; a probe would race the pending transition.
    if (pending.has(tabId) || activationPending.has(tabId)) return activeTabs.has(tabId);
    const stateEpoch = tabStateEpoch.get(tabId) ?? 0;
    const isCurrentEpoch = (): boolean => (tabStateEpoch.get(tabId) ?? 0) === stateEpoch;
    try {
      const response = (await browser.tabs.sendMessage(tabId, {
        type: 'BG_PING_STATE',
      } satisfies RuntimeMessage)) as { active?: boolean; candidates?: ContentCandidateInfo[] } | undefined;
      // The response describes the tab at send time. Drop it if the tab's
      // state epoch moved on (navigation, removal, disable) while in flight.
      if (!isCurrentEpoch()) return activeTabs.has(tabId);
      const active = response?.active === true;
      if (response?.candidates) {
        contentCandidatesByTab.set(tabId, response.candidates);
        void browser.storage.session.set({ [contentCandidatesKey(tabId)]: response.candidates });
      }
      if (active) {
        activeTabs.add(tabId);
      } else {
        activeTabs.delete(tabId);
      }
      await updateContextMenuState(tabId);
      return active;
    } catch {
      if (!isCurrentEpoch()) return activeTabs.has(tabId);
      activeTabs.delete(tabId);
      await refreshContextMenuForActiveTab(tabId);
      return false;
    }
  }

  async function injectContentScript(tabId: number): Promise<ToggleResult> {
    if (activeTabs.has(tabId)) {
      return { ok: true, enabled: true };
    }
    const existing = pendingEnable.get(tabId);
    if (existing) return existing;
    const operation = injectContentScriptImpl(tabId);
    pendingEnable.set(tabId, operation);
    try {
      return await operation;
    } finally {
      if (pendingEnable.get(tabId) === operation) pendingEnable.delete(tabId);
    }
  }

  async function injectContentScriptImpl(tabId: number): Promise<ToggleResult> {
    pending.add(tabId);
    const stateEpoch = tabStateEpoch.get(tabId) ?? 0;
    const isCurrentEpoch = (): boolean => (tabStateEpoch.get(tabId) ?? 0) === stateEpoch;
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['/content-scripts/reader.js'],
      });
      await browser.scripting.insertCSS({
        target: { tabId },
        files: ['/content-scripts/reader.css'],
      });
      readerStyles.add(tabId);
      if (!isCurrentEpoch()) {
        await removeReaderStyles(tabId);
        return { ok: false, enabled: false, error: 'unknown' };
      }
      const probe = (await browser.tabs.sendMessage(tabId, { type: 'BG_PROBE' } satisfies RuntimeMessage)) as
        { injected?: boolean } | undefined;
      if (probe?.injected !== true || !isCurrentEpoch()) {
        return { ok: false, enabled: false, error: 'no-content' };
      }
      const token = crypto.randomUUID();
      sessionTokens.set(tabId, token);
      activationPending.add(tabId);
      void (
        browser.tabs.sendMessage(tabId, {
          type: 'BG_SET_SESSION',
          token,
        } satisfies RuntimeMessage) as Promise<{ ready?: boolean } | undefined>
      )
        .then((response) => {
          if (!isCurrentEpoch() || sessionTokens.get(tabId) !== token) return;
          if (response?.ready === true) activeTabs.add(tabId);
          else activeTabs.delete(tabId);
          void updateContextMenuState(tabId);
          void refreshContextMenuForActiveTab(tabId);
        })
        .catch(() => {
          if (!isCurrentEpoch() || sessionTokens.get(tabId) !== token) return;
          activeTabs.delete(tabId);
          void updateContextMenuState(tabId);
          void refreshContextMenuForActiveTab(tabId);
        })
        .finally(() => {
          if (sessionTokens.get(tabId) === token) activationPending.delete(tabId);
        });
      return { ok: true, enabled: true };
    } catch (err) {
      console.error('[Just Read It] failed to inject content script', err);
      return { ok: false, enabled: false, error: 'restricted' };
    } finally {
      pending.delete(tabId);
    }
  }

  async function handleReadingModeState(enabled: boolean): Promise<ToggleResult> {
    const tabId = await getActiveTabId();
    if (tabId == null) {
      return { ok: false, enabled: false, error: 'no-tab' };
    }

    return withTabLock(tabId, async () => {
      return updateReadingModeState(tabId, enabled);
    });
  }

  async function disableReadingModeForActiveTab(): Promise<ToggleResult> {
    const tabId = await getActiveTabId();
    if (tabId == null) return { ok: false, enabled: false, error: 'no-tab' };
    return disableReadingMode(tabId);
  }

  async function disableReadingMode(tabId: number): Promise<ToggleResult> {
    // Disable must not wait behind a slow injection/readiness operation. Make
    // that operation stale and resolve its waiter before tearing down the tab.
    // The tabStateEpoch bump always runs so an in-flight isTabActive probe cannot
    // resurrect the reader state that is being removed here.
    tabStateEpoch.set(tabId, (tabStateEpoch.get(tabId) ?? 0) + 1);
    if (pending.has(tabId) || activationPending.has(tabId)) {
      sessionTokens.delete(tabId);
      const waiter = readinessWaiters.get(tabId);
      readinessWaiters.delete(tabId);
      waiter?.resolve(false);
    }
    return updateReadingModeState(tabId, false);
  }

  async function openReadingPage(url: string): Promise<{ ok: boolean }> {
    try {
      const page = new URL(url);
      if (page.protocol !== 'http:' && page.protocol !== 'https:') return { ok: false };
      const tab = await browser.tabs.create({ url: page.href, active: true });
      if (tab.id != null) pendingAutoEnable.add(tab.id);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async function openHomePage(): Promise<{ ok: boolean }> {
    try {
      await browser.tabs.create({ url: browser.runtime.getURL('/home.html'), active: true });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async function updateReadingModeState(tabId: number, enabled: boolean): Promise<ToggleResult> {
    if (enabled) {
      const result = await injectContentScript(tabId);
      await updateContextMenuState(tabId);
      return result;
    }
    if (!activeTabs.has(tabId) && !pending.has(tabId)) return { ok: true, enabled: false };
    try {
      await Promise.race([
        browser.tabs.sendMessage(tabId, { type: 'BG_TEARDOWN' } satisfies RuntimeMessage),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    } catch (err) {
      console.log('[Just Read It] unable to send message:', err);
    }
    activeTabs.delete(tabId);
    pending.delete(tabId);
    pendingEnable.delete(tabId);
    sessionTokens.delete(tabId);
    clearContentCandidates(tabId);
    await removeReaderStyles(tabId);
    stopSpeech(tabId);
    await updateContextMenuState(tabId);
    await refreshContextMenuForActiveTab(tabId);
    return { ok: true, enabled: false };
  }

  async function removeReaderStyles(tabId: number): Promise<void> {
    if (!readerStyles.delete(tabId)) return;
    try {
      await browser.scripting.removeCSS({
        target: { tabId },
        files: ['/content-scripts/reader.css'],
      });
    } catch {
      // Navigation or a restricted page may make cleanup unavailable.
    }
  }

  // withTabLock uses promises to serialise and lock operations on a tabId
  async function withTabLock<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const previous = tabLocks.get(tabId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    tabLocks.set(
      tabId,
      previous.then(() => current),
    );
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (tabLocks.get(tabId) === current) tabLocks.delete(tabId);
    }
  }

  function stopSpeech(tabId: number | null): void {
    if (tabId !== null && speechTabId !== tabId) return;
    speechGeneration++;
    speechTabId = null;
    if (!extensionTtsAvailable) return;
    browser.tts.stop();
  }

  async function getTtsStatus(): Promise<{ backend: 'extension' | 'web' | 'none' }> {
    if (!extensionTtsAvailable) {
      return { backend: navigator.userAgent.includes('Firefox') ? 'web' : 'none' };
    }
    try {
      return { backend: (await browser.tts.getVoices()).length > 0 ? 'extension' : 'none' };
    } catch {
      return { backend: 'none' };
    }
  }

  function speak(text: string, rate: number, voiceURI: string | null, requestId: number, tabId: number | null): void {
    if (!extensionTtsAvailable || tabId === null) return;
    stopSpeech(null);
    speechTabId = tabId;
    const generation = speechGeneration;
    void browser.tts
      .speak(text, {
        rate: Math.max(0.1, Math.min(10, rate)),
        voiceName: voiceURI ?? undefined,
        desiredEventTypes: ['word', 'end', 'error'],
        onEvent: (event) => {
          if (generation !== speechGeneration || speechTabId !== tabId) return;
          if (event.type === 'word') {
            void browser.tabs
              .sendMessage(tabId, {
                type: 'BG_TTS_EVENT',
                requestId,
                event: 'word',
                charIndex: event.charIndex,
              } satisfies RuntimeMessage)
              .catch(() => {});
            return;
          }
          if (event.type !== 'end' && event.type !== 'error') return;
          speechTabId = null;
          void browser.tabs
            .sendMessage(tabId, {
              type: 'BG_TTS_EVENT',
              requestId,
              event: event.type,
              error: event.errorMessage,
            } satisfies RuntimeMessage)
            .catch(() => {});
        },
      })
      .catch((err) => {
        if (generation !== speechGeneration || speechTabId !== tabId) return;
        speechTabId = null;
        void browser.tabs
          .sendMessage(tabId, {
            type: 'BG_TTS_EVENT',
            requestId,
            event: 'error',
            error: String(err),
          } satisfies RuntimeMessage)
          .catch(() => {});
      });
  }
});
