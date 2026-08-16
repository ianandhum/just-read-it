import type { ContentCandidateInfo, JriSettings, RuntimeMessage } from '../../types';
import { watchUrlChanges } from '../../history_watch';

declare global {
  interface Window {
    __jriActive?: boolean;
  }
}

const SPA_SETTLE_MS = 300;
const SPA_MAX_RETRIES = 10;

export interface ReaderLifecycleContext {
  get tornDown(): boolean;
  setTornDown(value: boolean): void;
  get readerEnabled(): boolean;
  setReaderEnabled(value: boolean): void;
  get activationGeneration(): number;
  incrementActivationGeneration(): void;
  get activationTimer(): ReturnType<typeof setTimeout> | null;
  setActivationTimer(timer: ReturnType<typeof setTimeout> | null): void;
  get activationTransition(): Promise<void>;
  setActivationTransition(transition: Promise<void>): void;
  get unwatchUrl(): (() => void) | null;
  setUnwatchUrl(unwatch: (() => void) | null): void;
  get sessionToken(): string | null;
  setSessionToken(token: string): void;
  isReaderReady(): boolean;
  activate(): Promise<number>;
  teardownSession(
    preserveControls?: boolean,
    onUnwrapProgress?: (processed: number, total: number) => void,
    keepUiVisible?: boolean,
  ): Promise<void>;
  deactivateSession(keepUiVisible?: boolean): Promise<void>;
  flushSave(): void;
  pauseTimeTracking(): void;
  resumeTimeTracking(): void;
  pauseGuidedPlayback(): void;
  resumeGuidedPlayback(): void;
  stopSpeech(): void;
  isReadingAloud(): boolean;
  updateWakeLock(): Promise<void>;
  releaseWakeLock(): Promise<void>;
  applySettings(settings: Partial<JriSettings>): void;
  setStatus(status: string): void;
  reportState(enabled: boolean): void;
  resetPage(): void;
  contentCandidates(): ContentCandidateInfo[];
  handleRuntimeMessage(message: RuntimeMessage): void;
  setWindowActive(active: boolean): void;
}

export function createReaderLifecycle(context: ReaderLifecycleContext): {
  cleanup(): Promise<void>;
  deactivate(): Promise<void>;
  handleUrlChange(url: string): void;
  install(): void;
} {
  function scheduleActivate(url: string, retriesLeft: number): void {
    if (!context.readerEnabled) return;
    const currentTimer = context.activationTimer;
    if (currentTimer) clearTimeout(currentTimer);
    context.setActivationTimer(
      setTimeout(async () => {
        context.setActivationTimer(null);
        if (context.tornDown || !context.readerEnabled || location.href !== url) return;
        const transition = context.activationTransition
          .catch(() => {})
          .then(async () => {
            if (context.tornDown || !context.readerEnabled || location.href !== url) return;
            context.setStatus('Preparing new page');
            await context.teardownSession(true, undefined, true);
            if (context.tornDown || !context.readerEnabled || location.href !== url) return;
            const total = await context.activate();
            if (total === 0 && retriesLeft > 0) {
              context.incrementActivationGeneration();
              scheduleActivate(url, retriesLeft - 1);
            }
          });
        context.setActivationTransition(transition);
        await transition;
      }, SPA_SETTLE_MS),
    );
  }

  function handleUrlChange(url: string): void {
    if (context.tornDown || !context.readerEnabled) return;
    console.log(`[Just Read It] url changed: ${url}`);
    context.incrementActivationGeneration();
    const timer = context.activationTimer;
    if (timer) {
      clearTimeout(timer);
      context.setActivationTimer(null);
    }
    context.flushSave();
    context.setActivationTransition(
      context.activationTransition
        .catch(() => {})
        .then(async () => {
          if (context.tornDown || !context.readerEnabled || location.href !== url) return;
          context.setStatus('Loading new page');
          // SPA navigation replaces the wrapped content, but the controls
          // and status host should remain visible throughout the transition.
          await context.teardownSession(true, undefined, true);
          if (!context.tornDown && context.readerEnabled && location.href === url) scheduleActivate(url, SPA_MAX_RETRIES);
        }),
    );
  }

  async function cleanup(): Promise<void> {
    context.reportState(false);
    context.setTornDown(true);
    context.setReaderEnabled(false);
    context.incrementActivationGeneration();
    const timer = context.activationTimer;
    if (timer) {
      clearTimeout(timer);
      context.setActivationTimer(null);
    }
    context.unwatchUrl?.();
    context.setUnwatchUrl(null);
    browser.storage.onChanged.removeListener(onStorageChanged);
    browser.runtime.onMessage.removeListener(onRuntimeMessage);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    context.flushSave();
    await context.teardownSession();
    await context.releaseWakeLock();
    window.__jriActive = false;
    console.log('[Just Read It] torn down');
  }

  async function deactivate(): Promise<void> {
    context.reportState(false);
    context.setReaderEnabled(false);
    context.incrementActivationGeneration();
    const timer = context.activationTimer;
    if (timer) {
      clearTimeout(timer);
      context.setActivationTimer(null);
    }
    // Disable immediately. Generation and readerEnabled checks make an
    // in-flight activation stale while keeping wrapped spans for re-enable.
    context.flushSave();
    await context.deactivateSession();
    await context.releaseWakeLock();
  }

  const onPageHide = (event: PageTransitionEvent): void => {
    if (!context.readerEnabled) return;
    context.pauseTimeTracking();
    context.pauseGuidedPlayback();
    context.flushSave();
    // Guided reading pauses with the page, but active narration may continue
    // while Firefox backgrounds the tab or locks the device.
    if (context.isReadingAloud()) return;
    context.stopSpeech();
    if (event.persisted) {
      context.incrementActivationGeneration();
      context.setActivationTransition(context.activationTransition.catch(() => {}).then(() => context.teardownSession()));
    } else {
      void cleanup();
    }
  };

  const onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted && !context.tornDown && context.readerEnabled) {
      context.setActivationTransition(context.activationTransition.catch(() => {}).then(() => context.activate().then(() => undefined)));
    }
  };

  const onStorageChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string): void => {
    if (areaName !== 'local' && areaName !== 'sync') return;
    const change = changes['jri:settings'];
    if (change?.newValue) context.applySettings(change.newValue as Partial<JriSettings>);
  };

  const onVisibilityChange = (): void => {
    if (!context.readerEnabled) return;
    if (document.visibilityState === 'visible') {
      context.resumeTimeTracking();
      context.resumeGuidedPlayback();
      void context.updateWakeLock();
    } else {
      context.pauseTimeTracking();
      context.pauseGuidedPlayback();
      context.flushSave();
      if (!context.isReadingAloud()) context.stopSpeech();
      void context.releaseWakeLock();
    }
  };

  const onRuntimeMessage = (message: unknown): unknown => {
    const msg = message as RuntimeMessage;
    if (msg.type === 'BG_PROBE') {
      return Promise.resolve({ injected: true });
    }
    if (msg.type === 'BG_PING_STATE') {
      return Promise.resolve({
        active: !context.tornDown && context.readerEnabled && context.isReaderReady(),
        candidates: context.contentCandidates(),
      });
    }
    if (msg.type === 'BG_SET_SESSION') {
      context.setTornDown(false);
      context.setReaderEnabled(true);
      context.setWindowActive(true);
      context.setSessionToken(msg.token);
      // A disabled reader may still have its wrapped DOM, so activation must
      // be queued behind teardown and resume the existing wrapper cheaply.
      const transition = context.activationTransition.catch(() => {}).then(() => context.activate());
      context.setActivationTransition(transition.then(() => undefined));
      return transition
        .then((total) => {
          const ready = total > 0 && context.isReaderReady();
          context.reportState(ready);
          if (!ready) context.setStatus('Unable to restore reading progress.');
          return { ready };
        })
        .catch(() => {
          context.setStatus('Unable to restore reading progress.');
          context.reportState(false);
          return { ready: false };
        });
    }
    if (msg.type === 'BG_TEARDOWN') {
      return deactivate().then(() => ({ ok: true }));
    }
    context.handleRuntimeMessage(msg);
    return undefined;
  };

  function install(): void {
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          if (!context.readerEnabled) return;
          const transition = new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
            .then(() => context.activate())
            .then(() => undefined);
          context.setActivationTransition(transition);
        },
        { once: true },
      );
    } else if (context.readerEnabled) {
      const transition = new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        .then(() => context.activate())
        .then(() => undefined);
      context.setActivationTransition(transition);
    }
    context.setUnwatchUrl(watchUrlChanges(handleUrlChange));
    browser.storage.onChanged.addListener(onStorageChanged);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    browser.runtime.onMessage.addListener(onRuntimeMessage);
  }

  return { cleanup, deactivate, handleUrlChange, install };
}
